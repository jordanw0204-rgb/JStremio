fn main() {
    let mut resource = winres::WindowsResource::new();
    resource.set_icon("../images/jstremio.ico");
    resource.set("FileDescription", "JStremio Update Helper");
    resource.set("ProductName", "JStremio");
    resource.set("OriginalFilename", "JStremioUpdater.exe");
    resource
        .compile()
        .expect("failed to compile updater resources");
}
