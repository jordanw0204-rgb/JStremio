use std::{fs, io, os::windows::process::CommandExt, path::PathBuf, process::Command};
use winapi::um::winbase::CREATE_BREAKAWAY_FROM_JOB;

const UPDATER_EXE: &str = "JStremioUpdater.exe";

#[derive(Clone, Debug)]
pub struct UpdateLaunch {
    pub updates_directory: PathBuf,
    pub shutdown_command: String,
}

impl UpdateLaunch {
    pub fn start(&self) -> io::Result<()> {
        let app_exe = std::env::current_exe()?;
        let install_directory = app_exe.parent().ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                "JStremio install directory is unavailable",
            )
        })?;
        let installed_updater = install_directory.join(UPDATER_EXE);

        // Portable packages deliberately omit the updater. Automatic replacement is only
        // enabled for the per-user installer, where the install boundary is known and safe.
        if !installed_updater.is_file() {
            return Ok(());
        }

        let helpers = self.updates_directory.join("helpers");
        fs::create_dir_all(&helpers)?;
        let staged_updater =
            helpers.join(format!("JStremioUpdater-{}.exe", env!("CARGO_PKG_VERSION")));
        if !staged_updater.is_file() {
            let temporary = helpers.join(format!(
                ".JStremioUpdater-{}-{}.tmp",
                env!("CARGO_PKG_VERSION"),
                std::process::id()
            ));
            fs::copy(&installed_updater, &temporary)?;
            match fs::rename(&temporary, &staged_updater) {
                Ok(()) => {}
                Err(error) if staged_updater.is_file() => {
                    let _ = fs::remove_file(&temporary);
                    let _ = error;
                }
                Err(error) => {
                    let _ = fs::remove_file(&temporary);
                    return Err(error);
                }
            }
        }

        Command::new(staged_updater)
            .arg("--current-version")
            .arg(env!("CARGO_PKG_VERSION"))
            .arg("--app-exe")
            .arg(app_exe)
            .arg("--parent-pid")
            .arg(std::process::id().to_string())
            .arg("--shutdown-command")
            .arg(&self.shutdown_command)
            .arg("--updates-dir")
            .arg(&self.updates_directory)
            .creation_flags(CREATE_BREAKAWAY_FROM_JOB)
            .spawn()?;
        Ok(())
    }
}
