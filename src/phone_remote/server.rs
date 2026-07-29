use super::{
    assets::RemoteAssets,
    auth::AuthStore,
    model::{PhoneRemoteError, RemoteCommand, RemotePlaybackState, MAX_REMOTE_MESSAGE_BYTES},
};
use axum::{
    body::{Body, Bytes},
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, DefaultBodyLimit, State,
    },
    http::{
        header::{
            CACHE_CONTROL, CONTENT_SECURITY_POLICY, CONTENT_TYPE, COOKIE, HOST, ORIGIN,
            REFERRER_POLICY, SET_COOKIE, X_CONTENT_TYPE_OPTIONS, X_FRAME_OPTIONS,
        },
        HeaderMap, HeaderValue, StatusCode,
    },
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use std::{
    future::IntoFuture,
    net::SocketAddr,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex, RwLock,
    },
    time::{Duration, Instant},
};
use tokio::sync::watch;

const SESSION_COOKIE: &str = "jstremio_remote_session";
const MAX_CLIENTS: usize = 4;
pub(crate) const EXTENSION_HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(15);

pub(crate) struct SharedState {
    pub auth: Mutex<AuthStore>,
    pub playback: watch::Sender<RemotePlaybackState>,
    pub player: RwLock<Option<flume::Sender<String>>>,
    pub heartbeat: Mutex<Instant>,
    pub connected_clients: AtomicUsize,
    pub auth_generation: watch::Sender<u64>,
}

impl SharedState {
    pub fn new() -> Arc<Self> {
        let (playback, _) = watch::channel(RemotePlaybackState::default());
        Arc::new(Self {
            auth: Mutex::new(AuthStore::default()),
            playback,
            player: RwLock::new(None),
            heartbeat: Mutex::new(Instant::now()),
            connected_clients: AtomicUsize::new(0),
            auth_generation: watch::channel(1).0,
        })
    }

    pub fn revoke_all(&self) {
        if let Ok(mut auth) = self.auth.lock() {
            auth.revoke_all();
        }
        let next = self.auth_generation.borrow().saturating_add(1);
        self.auth_generation.send_replace(next);
    }

    fn dispatch(&self, command: &RemoteCommand) -> Result<(), PhoneRemoteError> {
        let playback = self.playback.borrow().clone();
        let message = command.player_message(&playback)?;
        self.player
            .read()
            .map_err(|_| PhoneRemoteError::PlayerUnavailable)?
            .as_ref()
            .ok_or(PhoneRemoteError::PlayerUnavailable)?
            .send(message)
            .map_err(|_| PhoneRemoteError::PlayerUnavailable)
    }
}

#[derive(Clone)]
struct AppState {
    shared: Arc<SharedState>,
    assets: RemoteAssets,
    expected_host: Arc<str>,
    expected_origin: Arc<str>,
    shutdown: watch::Sender<bool>,
}

pub(crate) async fn serve(
    listener: tokio::net::TcpListener,
    shared: Arc<SharedState>,
    assets: RemoteAssets,
    expected_host: String,
    expected_origin: String,
    shutdown: watch::Sender<bool>,
) {
    let state = AppState {
        shared,
        assets,
        expected_host: Arc::from(expected_host),
        expected_origin: Arc::from(expected_origin),
        shutdown: shutdown.clone(),
    };
    let router = router(state.clone());
    tokio::spawn(extension_watchdog(state.clone()));
    let graceful_shutdown = shutdown.subscribe();
    let shutdown_deadline = shutdown.subscribe();
    let server = axum::serve(
        listener,
        router.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(wait_for_shutdown(graceful_shutdown))
    .into_future();
    tokio::pin!(server);
    let result = tokio::select! {
        result = &mut server => Some(result),
        _ = wait_for_shutdown(shutdown_deadline) => {
            tokio::time::timeout(Duration::from_secs(3), &mut server).await.ok()
        }
    };
    if let Some(Err(error)) = result {
        eprintln!("Phone Remote server stopped unexpectedly: {error}");
    }
    state.shared.revoke_all();
}

fn router(state: AppState) -> Router {
    Router::new()
        .route("/", get(index))
        .route("/app.js", get(javascript))
        .route("/styles.css", get(styles))
        .route("/api/pair", post(pair))
        .route("/ws", get(websocket))
        .fallback(not_found)
        .layer(DefaultBodyLimit::max(MAX_REMOTE_MESSAGE_BYTES))
        .layer(middleware::from_fn(timeout_request))
        .with_state(state)
}

async fn timeout_request(request: axum::extract::Request, next: Next) -> Response {
    tokio::time::timeout(Duration::from_secs(10), next.run(request))
        .await
        .unwrap_or_else(|_| StatusCode::REQUEST_TIMEOUT.into_response())
}

async fn wait_for_shutdown(mut shutdown: watch::Receiver<bool>) {
    while !*shutdown.borrow() {
        if shutdown.changed().await.is_err() {
            break;
        }
    }
}

async fn index(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !valid_host(&headers, &state) {
        return secured(StatusCode::MISDIRECTED_REQUEST.into_response(), &state);
    }
    asset_response(
        &state,
        state.assets.html.clone(),
        "text/html; charset=utf-8",
    )
}

async fn javascript(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !valid_host(&headers, &state) {
        return secured(StatusCode::MISDIRECTED_REQUEST.into_response(), &state);
    }
    asset_response(
        &state,
        state.assets.javascript.clone(),
        "text/javascript; charset=utf-8",
    )
}

async fn styles(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !valid_host(&headers, &state) {
        return secured(StatusCode::MISDIRECTED_REQUEST.into_response(), &state);
    }
    asset_response(&state, state.assets.css.clone(), "text/css; charset=utf-8")
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PairRequest {
    token: String,
}

async fn pair(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(request): Json<PairRequest>,
) -> Response {
    if !valid_host(&headers, &state) || !valid_origin(&headers, &state) {
        return secured(StatusCode::FORBIDDEN.into_response(), &state);
    }
    if request.token.len() > 128 || !request.token.bytes().all(is_token_byte) {
        return secured(StatusCode::FORBIDDEN.into_response(), &state);
    }
    let session = state
        .shared
        .auth
        .lock()
        .ok()
        .and_then(|mut auth| auth.exchange_pairing(&request.token, peer.ip()));
    let Some(session) = session else {
        return secured(StatusCode::FORBIDDEN.into_response(), &state);
    };
    let mut response = Json(json!({ "ok": true })).into_response();
    if let Ok(value) = HeaderValue::from_str(&format!(
        "{SESSION_COOKIE}={session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800"
    )) {
        response.headers_mut().insert(SET_COOKIE, value);
    }
    secured(response, &state)
}

async fn websocket(
    State(state): State<AppState>,
    headers: HeaderMap,
    websocket: WebSocketUpgrade,
) -> Response {
    if !valid_host(&headers, &state) || !valid_origin(&headers, &state) {
        return secured(StatusCode::FORBIDDEN.into_response(), &state);
    }
    let Some(session) = session_cookie(&headers) else {
        return secured(StatusCode::UNAUTHORIZED.into_response(), &state);
    };
    let authenticated = state
        .shared
        .auth
        .lock()
        .map(|mut auth| auth.validate_session(&session, false))
        .unwrap_or(false);
    if !authenticated {
        return secured(StatusCode::UNAUTHORIZED.into_response(), &state);
    }
    let Some(permit) = ClientPermit::acquire(state.shared.clone()) else {
        return secured(StatusCode::SERVICE_UNAVAILABLE.into_response(), &state);
    };
    let socket_state = state.clone();
    let response = websocket
        .max_message_size(MAX_REMOTE_MESSAGE_BYTES)
        .max_frame_size(MAX_REMOTE_MESSAGE_BYTES)
        .write_buffer_size(1_024)
        .max_write_buffer_size(16 * 1_024)
        .on_upgrade(move |socket| socket_loop(socket, socket_state, session, permit))
        .into_response();
    secured(response, &state)
}

async fn socket_loop(
    mut socket: WebSocket,
    state: AppState,
    session: String,
    _permit: ClientPermit,
) {
    let mut playback = state.shared.playback.subscribe();
    let mut shutdown = state.shutdown.subscribe();
    let mut revocations = state.shared.auth_generation.subscribe();
    let mut heartbeat = tokio::time::interval(Duration::from_secs(15));
    let mut last_received = Instant::now();

    let initial_state = playback.borrow().clone();
    if send_state(&mut socket, &initial_state).await.is_err() {
        return;
    }

    loop {
        tokio::select! {
            changed = playback.changed() => {
                if changed.is_err() { break; }
                let state_update = playback.borrow().clone();
                if send_state(&mut socket, &state_update).await.is_err() {
                    break;
                }
            }
            message = socket.recv() => {
                let Some(Ok(message)) = message else { break; };
                last_received = Instant::now();
                match message {
                    Message::Text(text) => {
                        let allowed = state.shared.auth.lock()
                            .map(|mut auth| auth.validate_session(&session, true))
                            .unwrap_or(false);
                        if !allowed {
                            let _ = send_error(&mut socket, None, "rate_limited_or_expired").await;
                            break;
                        }
                        let command = serde_json::from_str::<RemoteCommand>(text.as_str());
                        let Ok(command) = command else {
                            if send_error(&mut socket, None, "invalid_command").await.is_err() { break; }
                            continue;
                        };
                        let request_id = command.request_id();
                        match state.shared.dispatch(&command) {
                            Ok(()) => {
                                if socket.send(Message::Text(json!({"type":"ack","requestId":request_id}).to_string().into())).await.is_err() { break; }
                            }
                            Err(error) => {
                                if send_error(&mut socket, Some(request_id), error.code()).await.is_err() { break; }
                            }
                        }
                    }
                    Message::Ping(payload) => {
                        if socket.send(Message::Pong(payload)).await.is_err() { break; }
                    }
                    Message::Pong(_) => {}
                    Message::Close(_) | Message::Binary(_) => break,
                }
            }
            _ = heartbeat.tick() => {
                let session_active = state.shared.auth.lock()
                    .map(|mut auth| auth.validate_session(&session, false))
                    .unwrap_or(false);
                if !session_active
                    || last_received.elapsed() > Duration::from_secs(45)
                {
                    break;
                }
                if socket.send(Message::Ping(Bytes::new())).await.is_err() { break; }
            }
            changed = shutdown.changed() => {
                if changed.is_err() || *shutdown.borrow() { break; }
            }
            changed = revocations.changed() => {
                if changed.is_err() { break; }
                break;
            }
        }
    }
    let _ = socket.send(Message::Close(None)).await;
}

async fn send_state(
    socket: &mut WebSocket,
    playback: &RemotePlaybackState,
) -> Result<(), axum::Error> {
    let message = serde_json::to_string(&json!({ "type": "state", "state": playback }))
        .unwrap_or_else(|_| r#"{"type":"state","state":{"active":false}}"#.to_string());
    socket.send(Message::Text(message.into())).await
}

async fn send_error(
    socket: &mut WebSocket,
    request_id: Option<u64>,
    code: &str,
) -> Result<(), axum::Error> {
    socket
        .send(Message::Text(
            json!({ "type": "error", "requestId": request_id, "code": code })
                .to_string()
                .into(),
        ))
        .await
}

async fn not_found(State(state): State<AppState>) -> Response {
    secured(StatusCode::NOT_FOUND.into_response(), &state)
}

async fn extension_watchdog(state: AppState) {
    let mut timer = tokio::time::interval(Duration::from_secs(5));
    loop {
        timer.tick().await;
        let stale = state
            .shared
            .heartbeat
            .lock()
            .map(|heartbeat| heartbeat.elapsed() > EXTENSION_HEARTBEAT_TIMEOUT)
            .unwrap_or(true);
        if stale {
            let _ = state.shutdown.send(true);
            break;
        }
        if *state.shutdown.borrow() {
            break;
        }
    }
}

fn asset_response(state: &AppState, bytes: Arc<[u8]>, content_type: &'static str) -> Response {
    let mut response = Response::new(Body::from(bytes.to_vec()));
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static(content_type));
    secured(response, state)
}

fn secured(mut response: Response, state: &AppState) -> Response {
    let headers = response.headers_mut();
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    headers.insert(X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    headers.insert(X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    let websocket_origin = state.expected_origin.replacen("http://", "ws://", 1);
    let policy = format!(
        "default-src 'self'; connect-src 'self' {websocket_origin}; img-src 'self' data:; script-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
    );
    if let Ok(value) = HeaderValue::from_str(&policy) {
        headers.insert(CONTENT_SECURITY_POLICY, value);
    }
    response
}

fn valid_host(headers: &HeaderMap, state: &AppState) -> bool {
    let mut values = headers.get_all(HOST).iter();
    matches!(
        (values.next(), values.next()),
        (Some(value), None) if value.to_str().ok() == Some(state.expected_host.as_ref())
    )
}

fn valid_origin(headers: &HeaderMap, state: &AppState) -> bool {
    let mut values = headers.get_all(ORIGIN).iter();
    matches!(
        (values.next(), values.next()),
        (Some(value), None) if value.to_str().ok() == Some(state.expected_origin.as_ref())
    )
}

fn session_cookie(headers: &HeaderMap) -> Option<String> {
    let raw = headers.get(COOKIE)?.to_str().ok()?;
    raw.split(';').find_map(|part| {
        let (name, value) = part.trim().split_once('=')?;
        (name == SESSION_COOKIE && value.len() <= 128 && value.bytes().all(is_token_byte))
            .then(|| value.to_string())
    })
}

fn is_token_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_')
}

struct ClientPermit(Arc<SharedState>);

impl ClientPermit {
    fn acquire(shared: Arc<SharedState>) -> Option<Self> {
        shared
            .connected_clients
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |clients| {
                (clients < MAX_CLIENTS).then_some(clients + 1)
            })
            .ok()?;
        Some(Self(shared))
    }
}

impl Drop for ClientPermit {
    fn drop(&mut self) {
        self.0.connected_clients.fetch_sub(1, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::{router, AppState, RemoteAssets, SharedState};
    use axum::{
        body::{to_bytes, Body},
        extract::ConnectInfo,
        http::{header, Request, StatusCode},
    };
    use std::{net::SocketAddr, sync::Arc};
    use tokio::sync::watch;
    use tower::ServiceExt;

    fn app() -> axum::Router {
        let (shutdown, _) = watch::channel(false);
        router(AppState {
            shared: SharedState::new(),
            assets: RemoteAssets {
                html: Arc::from(b"html".as_slice()),
                javascript: Arc::from(b"js".as_slice()),
                css: Arc::from(b"css".as_slice()),
            },
            expected_host: Arc::from("192.168.1.5:1234"),
            expected_origin: Arc::from("http://192.168.1.5:1234"),
            shutdown,
        })
    }

    #[tokio::test]
    async fn fixed_assets_require_exact_host_and_send_security_headers() {
        let response = app()
            .oneshot(
                Request::builder()
                    .uri("/")
                    .header(header::HOST, "192.168.1.5:1234")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::X_FRAME_OPTIONS], "DENY");
        assert_eq!(
            to_bytes(response.into_body(), 16).await.unwrap().as_ref(),
            b"html"
        );

        let response = app()
            .oneshot(
                Request::builder()
                    .uri("/")
                    .header(header::HOST, "evil.invalid")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::MISDIRECTED_REQUEST);
    }

    #[tokio::test]
    async fn pairing_rejects_wrong_origin_and_oversized_bodies() {
        let mut request = Request::builder()
            .method("POST")
            .uri("/api/pair")
            .header(header::HOST, "192.168.1.5:1234")
            .header(header::ORIGIN, "http://evil.invalid")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(r#"{"token":"wrong"}"#))
            .unwrap();
        request.extensions_mut().insert(ConnectInfo(
            "192.168.1.10:54321".parse::<SocketAddr>().unwrap(),
        ));
        let response = app().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert!(response
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none());

        let mut request = Request::builder()
            .method("POST")
            .uri("/api/pair")
            .header(header::HOST, "192.168.1.5:1234")
            .header(header::ORIGIN, "http://192.168.1.5:1234")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(vec![b'x'; 4 * 1024 + 1]))
            .unwrap();
        request.extensions_mut().insert(ConnectInfo(
            "192.168.1.10:54321".parse::<SocketAddr>().unwrap(),
        ));
        let response = app().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    }
}
