mod assets;
mod auth;
mod model;
mod server;

pub use model::{
    PairingCode, PhoneRemoteError, PhoneRemoteStatus, RemoteInterface, RemotePlaybackState,
    StartPhoneRemoteRequest, StartPhoneRemoteResult,
};

use assets::RemoteAssets;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::Utc;
use local_ip_address::list_afinet_netifas;
use qrcode::{render::svg, QrCode};
use server::SharedState;
use std::{
    collections::HashSet,
    net::{IpAddr, SocketAddr, TcpListener},
    path::PathBuf,
    sync::{atomic::Ordering, Arc, Mutex},
    thread::{self, JoinHandle},
    time::Instant,
};
use tokio::{runtime::Builder, sync::watch};

struct ServerControl {
    shutdown: watch::Sender<bool>,
    thread: JoinHandle<()>,
    interface_ip: IpAddr,
    origin: String,
    started_at: chrono::DateTime<Utc>,
}

pub struct PhoneRemoteService {
    asset_directory: PathBuf,
    shared: Arc<SharedState>,
    server: Mutex<Option<ServerControl>>,
}

impl PhoneRemoteService {
    pub fn new(asset_directory: PathBuf) -> Self {
        Self {
            asset_directory,
            shared: SharedState::new(),
            server: Mutex::new(None),
        }
    }

    pub fn attach_player(&self, sender: flume::Sender<String>) {
        if let Ok(mut player) = self.shared.player.write() {
            *player = Some(sender);
        }
    }

    pub fn available_interfaces(&self) -> Result<Vec<RemoteInterface>, PhoneRemoteError> {
        available_interfaces()
    }

    pub fn start(
        &self,
        request: StartPhoneRemoteRequest,
    ) -> Result<StartPhoneRemoteResult, PhoneRemoteError> {
        self.reap_finished();
        let mut server = self
            .server
            .lock()
            .map_err(|_| PhoneRemoteError::StartFailed)?;
        if server.is_some() {
            return Err(PhoneRemoteError::AlreadyRunning);
        }
        if !available_interfaces()?
            .iter()
            .any(|interface| interface.address == request.interface_ip)
        {
            return Err(PhoneRemoteError::InvalidInterface);
        }

        let assets = RemoteAssets::load(&self.asset_directory)?;
        let listener = TcpListener::bind(SocketAddr::new(request.interface_ip, 0))
            .map_err(|_| PhoneRemoteError::StartFailed)?;
        listener
            .set_nonblocking(true)
            .map_err(|_| PhoneRemoteError::StartFailed)?;
        let address = listener
            .local_addr()
            .map_err(|_| PhoneRemoteError::StartFailed)?;
        let expected_host = address.to_string();
        let origin = format!("http://{expected_host}");
        let runtime = Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|_| PhoneRemoteError::StartFailed)?;
        let (shutdown, _) = watch::channel(false);
        self.shared.revoke_all();
        if let Ok(mut heartbeat) = self.shared.heartbeat.lock() {
            *heartbeat = Instant::now();
        }
        let pairing = self.create_pairing(&origin)?;
        let shared = self.shared.clone();
        let shutdown_for_thread = shutdown.clone();
        let origin_for_thread = origin.clone();
        let thread = thread::Builder::new()
            .name("jstremio-phone-remote".into())
            .spawn(move || {
                runtime.block_on(async move {
                    let listener = match tokio::net::TcpListener::from_std(listener) {
                        Ok(listener) => listener,
                        Err(error) => {
                            eprintln!("Phone Remote could not attach its listener: {error}");
                            return;
                        }
                    };
                    server::serve(
                        listener,
                        shared,
                        assets,
                        expected_host,
                        origin_for_thread,
                        shutdown_for_thread,
                    )
                    .await;
                });
            });
        let thread = match thread {
            Ok(thread) => thread,
            Err(_) => {
                self.shared.revoke_all();
                return Err(PhoneRemoteError::StartFailed);
            }
        };
        let started_at = Utc::now();
        *server = Some(ServerControl {
            shutdown,
            thread,
            interface_ip: request.interface_ip,
            origin: origin.clone(),
            started_at,
        });
        drop(server);
        Ok(StartPhoneRemoteResult {
            status: self.status(),
            pairing,
        })
    }

    pub fn status(&self) -> PhoneRemoteStatus {
        self.reap_finished();
        let Ok(server) = self.server.lock() else {
            return PhoneRemoteStatus::stopped();
        };
        let Some(server) = server.as_ref() else {
            return PhoneRemoteStatus::stopped();
        };
        let paired_sessions = self
            .shared
            .auth
            .lock()
            .map(|mut auth| auth.session_count())
            .unwrap_or(0);
        PhoneRemoteStatus {
            running: true,
            interface_ip: Some(server.interface_ip),
            origin: Some(server.origin.clone()),
            connected_clients: self.shared.connected_clients.load(Ordering::SeqCst),
            paired_sessions,
            started_at: Some(server.started_at),
        }
    }

    pub fn new_pairing_code(&self) -> Result<PairingCode, PhoneRemoteError> {
        self.reap_finished();
        let origin = self
            .server
            .lock()
            .map_err(|_| PhoneRemoteError::NotRunning)?
            .as_ref()
            .map(|server| server.origin.clone())
            .ok_or(PhoneRemoteError::NotRunning)?;
        self.create_pairing(&origin)
    }

    pub fn update_state(&self, state: RemotePlaybackState) -> Result<(), PhoneRemoteError> {
        state.validate()?;
        let current = self.shared.playback.borrow();
        if state.publisher_id == current.publisher_id && state.revision < current.revision {
            return Ok(());
        }
        drop(current);
        self.shared.playback.send_replace(state);
        Ok(())
    }

    pub fn heartbeat(&self) {
        if let Ok(mut heartbeat) = self.shared.heartbeat.lock() {
            *heartbeat = Instant::now();
        }
    }

    pub fn disconnect_all(&self) -> PhoneRemoteStatus {
        self.shared.revoke_all();
        self.status()
    }

    pub fn stop(&self) -> PhoneRemoteStatus {
        let control = self.server.lock().ok().and_then(|mut server| server.take());
        if let Some(control) = control {
            let _ = control.shutdown.send(true);
            if control.thread.thread().id() != thread::current().id() {
                let _ = control.thread.join();
            }
        }
        self.shared.revoke_all();
        PhoneRemoteStatus::stopped()
    }

    fn create_pairing(&self, origin: &str) -> Result<PairingCode, PhoneRemoteError> {
        let (secret, expires_at) = self
            .shared
            .auth
            .lock()
            .map_err(|_| PhoneRemoteError::StartFailed)?
            .new_pairing();
        let url = format!("{origin}/#pair={secret}");
        let svg = QrCode::new(url.as_bytes())
            .map_err(|_| PhoneRemoteError::StartFailed)?
            .render::<svg::Color>()
            .min_dimensions(320, 320)
            .build();
        Ok(PairingCode {
            url,
            qr_data_url: format!(
                "data:image/svg+xml;base64,{}",
                STANDARD.encode(svg.as_bytes())
            ),
            expires_at,
        })
    }

    fn reap_finished(&self) {
        let control = self.server.lock().ok().and_then(|mut server| {
            server
                .as_ref()
                .is_some_and(|control| control.thread.is_finished())
                .then(|| server.take())
                .flatten()
        });
        if let Some(control) = control {
            let _ = control.thread.join();
            self.shared.revoke_all();
        }
    }
}

impl Drop for PhoneRemoteService {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

fn available_interfaces() -> Result<Vec<RemoteInterface>, PhoneRemoteError> {
    let interfaces = list_afinet_netifas().map_err(|_| PhoneRemoteError::InvalidInterface)?;
    let mut seen = HashSet::new();
    let mut result = interfaces
        .into_iter()
        .filter(|(_, address)| is_allowed_interface(*address))
        .filter(|(_, address)| seen.insert(*address))
        .map(|(name, address)| RemoteInterface { name, address })
        .collect::<Vec<_>>();
    result.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.address.to_string().cmp(&right.address.to_string()))
    });
    Ok(result)
}

fn is_allowed_interface(address: IpAddr) -> bool {
    matches!(address, IpAddr::V4(address) if address.is_private() && !address.is_loopback())
}

#[cfg(test)]
mod tests {
    use super::is_allowed_interface;
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

    #[test]
    fn only_private_ipv4_interfaces_are_exposed() {
        assert!(is_allowed_interface(IpAddr::V4(Ipv4Addr::new(
            192, 168, 1, 2
        ))));
        assert!(is_allowed_interface(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 2))));
        assert!(!is_allowed_interface(IpAddr::V4(Ipv4Addr::LOCALHOST)));
        assert!(!is_allowed_interface(IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))));
        assert!(!is_allowed_interface(IpAddr::V6(Ipv6Addr::LOCALHOST)));
    }
}
