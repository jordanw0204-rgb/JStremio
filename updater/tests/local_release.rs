use jstremio_updater::{check_and_stage, verify_installer};
use semver::Version;
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    thread,
};
use tempfile::tempdir;

#[test]
fn stages_a_verified_installer_from_a_local_release_endpoint() {
    let mut installer = vec![0_u8; 1024 * 1024];
    installer[0..2].copy_from_slice(b"MZ");
    installer[2048..2061].copy_from_slice(b"JSTREMIO-TEST");
    let digest = format!("{:x}", Sha256::digest(&installer));
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let base = format!("http://{address}");
    let release_json = serde_json::json!({
        "tag_name": "v1.3.0",
        "html_url": format!("{base}/release"),
        "body": "Local integration release",
        "draft": false,
        "prerelease": false,
        "assets": [{
            "name": "JStremioSetup-v1.3.0_x64-unsigned.exe",
            "browser_download_url": format!("{base}/setup.exe"),
            "size": installer.len(),
            "digest": format!("sha256:{digest}")
        }]
    })
    .to_string()
    .into_bytes();

    let server = thread::spawn(move || {
        for _ in 0..3 {
            let (mut stream, _) = listener.accept().unwrap();
            let request = read_request(&mut stream);
            if request.starts_with("GET /latest ") {
                respond(&mut stream, "application/json", &release_json);
            } else if request.starts_with("GET /setup.exe ") {
                respond(&mut stream, "application/octet-stream", &installer);
            } else {
                stream
                    .write_all(
                        b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                    )
                    .unwrap();
            }
        }
    });

    let directory = tempdir().unwrap();
    let staged = check_and_stage(
        &format!("{base}/latest"),
        &Version::parse("1.2.0").unwrap(),
        directory.path(),
        true,
    )
    .unwrap()
    .expect("a newer release should be staged");
    assert_eq!(staged.selected.version, Version::parse("1.3.0").unwrap());
    verify_installer(
        &staged.installer_path,
        staged.selected.size,
        &staged.selected.sha256,
    )
    .unwrap();

    let cached = check_and_stage(
        &format!("{base}/latest"),
        &Version::parse("1.2.0").unwrap(),
        directory.path(),
        true,
    )
    .unwrap()
    .expect("the verified cached installer should be reused");
    assert_eq!(cached.installer_path, staged.installer_path);
    server.join().unwrap();
}

fn read_request(stream: &mut TcpStream) -> String {
    let mut request = Vec::new();
    let mut buffer = [0_u8; 1024];
    loop {
        let read = stream.read(&mut buffer).unwrap();
        if read == 0 {
            break;
        }
        request.extend_from_slice(&buffer[..read]);
        if request.windows(4).any(|value| value == b"\r\n\r\n") {
            break;
        }
    }
    String::from_utf8_lossy(&request).into_owned()
}

fn respond(stream: &mut TcpStream, content_type: &str, body: &[u8]) {
    write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .unwrap();
    stream.write_all(body).unwrap();
}
