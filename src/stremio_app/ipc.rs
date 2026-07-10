use serde::{Deserialize, Serialize};
use serde_json::{self, json};
use std::cell::RefCell;

use crate::stremio_app::constants::SHELL_COMPAT_VERSION;
use crate::stremio_app::gpu_video_processing;

pub type Channel = RefCell<Option<(flume::Sender<String>, flume::Receiver<String>)>>;
pub type WebChannel = RefCell<Option<(flume::Sender<String>, flume::Receiver<WebMessage>)>>;

#[derive(Debug, Clone)]
pub struct WebMessage {
    pub message: String,
    pub source: String,
    pub top_level_source: String,
}

impl WebMessage {
    pub fn internal(message: String) -> Self {
        Self {
            message,
            source: String::new(),
            top_level_source: String::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RPCRequest {
    pub id: u64,
    pub args: Option<Vec<serde_json::Value>>,
}

impl RPCRequest {
    pub fn is_handshake(&self) -> bool {
        self.id == 0
    }
    pub fn get_method(&self) -> Option<&str> {
        self.args
            .as_ref()
            .and_then(|args| args.first())
            .and_then(|arg| arg.as_str())
    }
    pub fn get_params(&self) -> Option<&serde_json::Value> {
        self.args
            .as_ref()
            .and_then(|args| if args.len() > 1 { Some(&args[1]) } else { None })
    }
}
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RPCResponseDataTransport {
    pub properties: Vec<Vec<String>>,
    pub signals: Vec<String>,
    pub methods: Vec<Vec<String>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RPCResponseData {
    pub transport: RPCResponseDataTransport,
}

#[derive(Default, Serialize, Deserialize, Debug, Clone)]
pub struct RPCResponse {
    pub id: u64,
    pub object: String,
    #[serde(rename = "type")]
    pub response_type: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<RPCResponseData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<serde_json::Value>,
}

impl RPCResponse {
    pub fn get_handshake() -> String {
        let resp = RPCResponse {
            id: 0,
            object: "transport".to_string(),
            response_type: 3,
            data: Some(RPCResponseData {
                transport: RPCResponseDataTransport {
                    properties: vec![
                        vec![],
                        vec![
                            "".to_string(),
                            "shellVersion".to_string(),
                            "".to_string(),
                            SHELL_COMPAT_VERSION.to_string(),
                        ],
                        vec![
                            "".to_string(),
                            "gpuVideoProcessing".to_string(),
                            "".to_string(),
                            gpu_video_processing::gpu_video_processing_supported().to_string(),
                        ],
                    ],
                    signals: vec![],
                    methods: vec![vec!["onEvent".to_string(), "".to_string()]],
                },
            }),
            ..Default::default()
        };
        serde_json::to_string(&resp).expect("Cannot build response")
    }
    pub fn response_message(msg: Option<serde_json::Value>) -> String {
        let resp = RPCResponse {
            id: 1,
            object: "transport".to_string(),
            response_type: 1,
            args: msg,
            ..Default::default()
        };
        serde_json::to_string(&resp).expect("Cannot build response")
    }
    pub fn visibility_change(visible: bool, visibility: u32, is_full_screen: bool) -> String {
        Self::response_message(Some(json!(["win-visibility-changed" ,{
            "visible": visible,
            "visibility": visibility,
            "isFullscreen": is_full_screen
        }])))
    }
    pub fn state_change(state: u32) -> String {
        Self::response_message(Some(json!(["win-state-changed" ,{
            "state": state,
        }])))
    }
    pub fn open_media(url: String) -> String {
        Self::response_message(Some(json!(["open-media", url])))
    }
    pub fn discord_status(connected: bool) -> String {
        Self::response_message(Some(json!(["discord-status", {
            "connected": connected,
        }])))
    }
    pub fn media_key(action: &str) -> String {
        Self::response_message(Some(json!(["media-key", action])))
    }
}

#[cfg(test)]
mod tests {
    use super::RPCResponse;
    use crate::stremio_app::constants::SHELL_COMPAT_VERSION;

    #[test]
    fn handshake_reports_the_pinned_shell_compatibility_version() {
        let handshake: RPCResponse = serde_json::from_str(&RPCResponse::get_handshake()).unwrap();
        let properties = &handshake.data.unwrap().transport.properties;
        let shell_version = properties
            .iter()
            .find(|property| property.get(1).map(String::as_str) == Some("shellVersion"))
            .unwrap();

        assert_eq!(
            shell_version.get(3).map(String::as_str),
            Some(SHELL_COMPAT_VERSION)
        );
    }
}
