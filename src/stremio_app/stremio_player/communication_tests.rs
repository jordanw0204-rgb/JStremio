use crate::stremio_app::stremio_player::communication::{
    BoolProp, CmdVal, FpProp, InMsg, InMsgArgs, InMsgFn, MpvCmd, PlayerEnded, PlayerProprChange,
    PropKey, PropVal, StrProp,
};
use libmpv2::{events::PropertyData, mpv_end_file_reason};

use serde_test::{assert_tokens, Token};

#[test]
fn propr_change_tokens() {
    let prop = "test-prop";
    let tokens: [Token; 6] = [
        Token::Struct {
            name: "PlayerProprChange",
            len: 2,
        },
        Token::Str("name"),
        Token::None,
        Token::Str("data"),
        Token::None,
        Token::StructEnd,
    ];

    fn tokens_by_type(tokens: &[Token; 6], name: &'static str, val: PropertyData, token: Token) {
        let mut typed_tokens = *tokens;
        typed_tokens[2] = Token::Str(name);
        typed_tokens[4] = token;
        assert_tokens(
            &PlayerProprChange::from_name_value(name.to_string(), val),
            &typed_tokens,
        );
    }
    tokens_by_type(&tokens, prop, PropertyData::Flag(true), Token::Bool(true));
    tokens_by_type(&tokens, prop, PropertyData::Int64(1), Token::F64(1.0));
    tokens_by_type(&tokens, prop, PropertyData::Double(1.0), Token::F64(1.0));
    tokens_by_type(&tokens, prop, PropertyData::OsdStr("ok"), Token::Str("ok"));
    tokens_by_type(&tokens, prop, PropertyData::Str("ok"), Token::Str("ok"));

    // JSON response
    tokens_by_type(
        &tokens,
        "track-list",
        PropertyData::Str(r#""ok""#),
        Token::Str("ok"),
    );
    tokens_by_type(
        &tokens,
        "video-params",
        PropertyData::Str(r#""ok""#),
        Token::Str("ok"),
    );
    tokens_by_type(
        &tokens,
        "metadata",
        PropertyData::Str(r#""ok""#),
        Token::Str("ok"),
    );
    assert_eq!(
        serde_json::to_value(PlayerProprChange::from_json_value(
            "audio-device-list",
            serde_json::json!([{"name": "auto", "description": "Autoselect device"}]),
        ))
        .unwrap(),
        serde_json::json!({
            "name": "audio-device-list",
            "data": [{"name": "auto", "description": "Autoselect device"}]
        })
    );
}

#[test]
fn ended_tokens() {
    let error_tokens: [Token; 12] = [
        Token::Struct {
            name: "PlayerEnded",
            len: 2,
        },
        Token::Str("reason"),
        Token::Str("error"),
        Token::Str("error"),
        Token::Some,
        Token::Struct {
            name: "PlayerEndedError",
            len: 2,
        },
        Token::Str("message"),
        Token::Str("Unknown error"),
        Token::Str("critical"),
        Token::Bool(false),
        Token::StructEnd,
        Token::StructEnd,
    ];
    let tokens: [Token; 4] = [
        Token::Struct {
            name: "PlayerEnded",
            len: 1,
        },
        Token::Str("reason"),
        Token::Str("quit"),
        Token::StructEnd,
    ];
    assert_tokens(
        &PlayerEnded::from_end_reason(mpv_end_file_reason::Error),
        &error_tokens,
    );
    assert_tokens(
        &PlayerEnded::from_end_reason(mpv_end_file_reason::Quit),
        &tokens,
    );
    let eof_tokens: [Token; 4] = [
        Token::Struct {
            name: "PlayerEnded",
            len: 1,
        },
        Token::Str("reason"),
        Token::Str("eof"),
        Token::StructEnd,
    ];
    assert_tokens(
        &PlayerEnded::from_end_reason(mpv_end_file_reason::Eof),
        &eof_tokens,
    );
    let stop_tokens: [Token; 4] = [
        Token::Struct {
            name: "PlayerEnded",
            len: 1,
        },
        Token::Str("reason"),
        Token::Str("stop"),
        Token::StructEnd,
    ];
    assert_tokens(
        &PlayerEnded::from_end_reason(mpv_end_file_reason::Stop),
        &stop_tokens,
    );
}

#[test]
fn ob_propr_tokens() {
    assert_tokens(
        &InMsg(
            InMsgFn::MpvObserveProp,
            InMsgArgs::ObProp(PropKey::Bool(BoolProp::Pause)),
        ),
        &[
            Token::TupleStruct {
                name: "InMsg",
                len: 2,
            },
            Token::Str("mpv-observe-prop"),
            Token::Str("pause"),
            Token::TupleStructEnd,
        ],
    );
    let mute: InMsg = serde_json::from_str(r#"["mpv-observe-prop","mute"]"#).unwrap();
    assert_eq!(
        mute,
        InMsg(
            InMsgFn::MpvObserveProp,
            InMsgArgs::ObProp(PropKey::Bool(BoolProp::Mute)),
        )
    );
}

#[test]
fn set_propr_tokens() {
    assert_tokens(
        &InMsg(
            InMsgFn::MpvSetProp,
            InMsgArgs::StProp(PropKey::Bool(BoolProp::Pause), PropVal::Bool(true)),
        ),
        &[
            Token::TupleStruct {
                name: "InMsg",
                len: 2,
            },
            Token::Str("mpv-set-prop"),
            Token::Tuple { len: 2 },
            Token::Str("pause"),
            Token::Bool(true),
            Token::TupleEnd,
            Token::TupleStructEnd,
        ],
    );
}

#[test]
fn set_gpu_video_processing_tokens() {
    assert_tokens(
        &InMsg(InMsgFn::MpvSetGpuVideoProcessing, InMsgArgs::Flag(true)),
        &[
            Token::TupleStruct {
                name: "InMsg",
                len: 2,
            },
            Token::Str("mpv-set-gpu-video-processing"),
            Token::Bool(true),
            Token::TupleStructEnd,
        ],
    );
}

#[test]
fn audio_device_property_tokens() {
    assert_tokens(
        &InMsg(InMsgFn::MpvGetAudioDeviceList, InMsgArgs::Flag(true)),
        &[
            Token::TupleStruct {
                name: "InMsg",
                len: 2,
            },
            Token::Str("mpv-get-audio-device-list"),
            Token::Bool(true),
            Token::TupleStructEnd,
        ],
    );
    assert_tokens(
        &InMsg(
            InMsgFn::MpvSetProp,
            InMsgArgs::StProp(
                PropKey::Str(StrProp::AudioDevice),
                PropVal::Str("wasapi/{device-id}".to_string()),
            ),
        ),
        &[
            Token::TupleStruct {
                name: "InMsg",
                len: 2,
            },
            Token::Str("mpv-set-prop"),
            Token::Tuple { len: 2 },
            Token::Str("audio-device"),
            Token::Str("wasapi/{device-id}"),
            Token::TupleEnd,
            Token::TupleStructEnd,
        ],
    );
}

#[test]
fn caption_style_property_tokens() {
    assert_tokens(
        &InMsg(
            InMsgFn::MpvSetProp,
            InMsgArgs::StProp(
                PropKey::Str(StrProp::SubFont),
                PropVal::Str("Segoe UI".to_string()),
            ),
        ),
        &[
            Token::TupleStruct {
                name: "InMsg",
                len: 2,
            },
            Token::Str("mpv-set-prop"),
            Token::Tuple { len: 2 },
            Token::Str("sub-font"),
            Token::Str("Segoe UI"),
            Token::TupleEnd,
            Token::TupleStructEnd,
        ],
    );
    assert_tokens(
        &InMsg(
            InMsgFn::MpvSetProp,
            InMsgArgs::StProp(PropKey::Fp(FpProp::SubFontSize), PropVal::Num(52.0)),
        ),
        &[
            Token::TupleStruct {
                name: "InMsg",
                len: 2,
            },
            Token::Str("mpv-set-prop"),
            Token::Tuple { len: 2 },
            Token::Str("sub-font-size"),
            Token::F64(52.0),
            Token::TupleEnd,
            Token::TupleStructEnd,
        ],
    );
    assert_tokens(
        &InMsg(
            InMsgFn::MpvSetProp,
            InMsgArgs::StProp(PropKey::Bool(BoolProp::SubBold), PropVal::Bool(true)),
        ),
        &[
            Token::TupleStruct {
                name: "InMsg",
                len: 2,
            },
            Token::Str("mpv-set-prop"),
            Token::Tuple { len: 2 },
            Token::Str("sub-bold"),
            Token::Bool(true),
            Token::TupleEnd,
            Token::TupleStructEnd,
        ],
    );
}

#[test]
fn recover_playback_tokens() {
    assert_tokens(
        &InMsg(InMsgFn::MpvRecoverPlayback, InMsgArgs::Flag(true)),
        &[
            Token::TupleStruct {
                name: "InMsg",
                len: 2,
            },
            Token::Str("mpv-recover-playback"),
            Token::Bool(true),
            Token::TupleStructEnd,
        ],
    );
}

#[test]
fn command_stop_tokens() {
    assert_tokens(
        &InMsg(
            InMsgFn::MpvCommand,
            InMsgArgs::Cmd(CmdVal::Single((MpvCmd::Stop,))),
        ),
        &[
            Token::TupleStruct {
                name: "InMsg",
                len: 2,
            },
            Token::Str("mpv-command"),
            Token::Tuple { len: 1 },
            Token::Str("stop"),
            Token::TupleEnd,
            Token::TupleStructEnd,
        ],
    );
}

#[test]
fn command_loadfile_tokens() {
    assert_tokens(
        &InMsg(
            InMsgFn::MpvCommand,
            InMsgArgs::Cmd(CmdVal::Double(MpvCmd::Loadfile, "some_file".to_string())),
        ),
        &[
            Token::TupleStruct {
                name: "InMsg",
                len: 2,
            },
            Token::Str("mpv-command"),
            Token::Tuple { len: 2 },
            Token::Str("loadfile"),
            Token::Str("some_file"),
            Token::TupleEnd,
            Token::TupleStructEnd,
        ],
    );
}
#[test]
fn command_screenshot_to_file_tokens() {
    assert_tokens(
        &InMsg(
            InMsgFn::MpvCommand,
            InMsgArgs::Cmd(CmdVal::Tripple(
                MpvCmd::ScreenshotToFile,
                "C:\\JStremio\\frame.jpg".to_string(),
                "video".to_string(),
            )),
        ),
        &[
            Token::TupleStruct {
                name: "InMsg",
                len: 2,
            },
            Token::Str("mpv-command"),
            Token::Tuple { len: 3 },
            Token::Str("screenshot-to-file"),
            Token::Str("C:\\JStremio\\frame.jpg"),
            Token::Str("video"),
            Token::TupleEnd,
            Token::TupleStructEnd,
        ],
    );
}
