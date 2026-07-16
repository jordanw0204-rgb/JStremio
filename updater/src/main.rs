#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use anyhow::{bail, Context, Result};
use clap::Parser;
use jstremio_updater::{check_and_stage, RELEASE_API_URL};
use semver::Version;
use std::{
    ffi::OsStr,
    fs::{self, OpenOptions},
    io::Write,
    os::windows::{ffi::OsStrExt, process::CommandExt},
    path::{Path, PathBuf},
    process::Command,
};
use winapi::{
    shared::minwindef::FALSE,
    um::{
        handleapi::CloseHandle,
        processthreadsapi::OpenProcess,
        synchapi::WaitForSingleObject,
        winbase::{CREATE_BREAKAWAY_FROM_JOB, WAIT_OBJECT_0},
        winnt::SYNCHRONIZE,
        winuser::{
            MessageBoxW, IDYES, MB_DEFBUTTON1, MB_ICONERROR, MB_ICONINFORMATION, MB_OK,
            MB_SETFOREGROUND, MB_TOPMOST, MB_YESNO,
        },
    },
};

#[derive(Debug, Parser)]
#[command(version, about = "JStremio's background update helper")]
struct Args {
    #[arg(long)]
    current_version: Version,
    #[arg(long)]
    app_exe: PathBuf,
    #[arg(long)]
    parent_pid: u32,
    #[arg(long)]
    shutdown_command: String,
    #[arg(long)]
    updates_dir: PathBuf,
    #[arg(long, default_value = RELEASE_API_URL, hide = true)]
    api_url: String,
    #[arg(long, hide = true)]
    allow_loopback_test: bool,
    #[arg(long, hide = true)]
    stage_only: bool,
    #[arg(long, hide = true)]
    assume_yes: bool,
}

fn main() {
    let args = Args::parse();
    if let Err(error) = run(&args) {
        write_log(
            &args.updates_dir,
            &format!("update check failed: {error:#}"),
        );
    }
}

fn run(args: &Args) -> Result<()> {
    fs::create_dir_all(&args.updates_dir).context("could not create the updater data directory")?;
    let Some(staged) = check_and_stage(
        &args.api_url,
        &args.current_version,
        &args.updates_dir,
        args.allow_loopback_test,
    )?
    else {
        return Ok(());
    };
    write_log(
        &args.updates_dir,
        &format!(
            "JStremio {} is staged and verified",
            staged.selected.version
        ),
    );
    if args.stage_only {
        return Ok(());
    }

    let prompt = format!(
        "JStremio {} is ready to install.\n\nUpdate now? JStremio will briefly close and reopen.\n\nYour Stremio account, addons, custom plugins, and JStremio settings will be kept.",
        staged.selected.version
    );
    if !args.assume_yes
        && message_box(
            &prompt,
            "Update JStremio",
            MB_YESNO | MB_ICONINFORMATION | MB_DEFBUTTON1,
        ) != IDYES
    {
        write_log(&args.updates_dir, "update postponed by the user");
        return Ok(());
    }

    if let Err(error) = install_update(args, &staged.installer_path) {
        write_log(
            &args.updates_dir,
            &format!("update installation failed: {error:#}"),
        );
        message_box(
            "JStremio could not start the update. Your current installation was left unchanged. Please try again on the next launch.",
            "JStremio Update",
            MB_OK | MB_ICONERROR,
        );
    }
    Ok(())
}

fn install_update(args: &Args, installer: &Path) -> Result<()> {
    if !args.app_exe.is_file() || !installer.is_file() {
        bail!("application or staged installer is missing");
    }
    let status = Command::new(&args.app_exe)
        .arg(&args.shutdown_command)
        .status()
        .context("could not request a clean JStremio shutdown")?;
    if !status.success() {
        bail!("JStremio rejected the update shutdown request");
    }
    wait_for_process_exit(args.parent_pid, 60_000)?;

    let install_log = args.updates_dir.join("installer.log");
    Command::new(installer)
        .arg("/SILENT")
        .arg("/SP-")
        .arg("/NORESTART")
        .arg("/CLOSEAPPLICATIONS")
        .arg("/JSTREMIOUPDATE=1")
        .arg(format!("/LOG={}", install_log.display()))
        .creation_flags(CREATE_BREAKAWAY_FROM_JOB)
        .spawn()
        .context("could not launch the verified JStremio installer")?;
    Ok(())
}

fn wait_for_process_exit(pid: u32, timeout_ms: u32) -> Result<()> {
    unsafe {
        let process = OpenProcess(SYNCHRONIZE, FALSE, pid);
        if process.is_null() {
            return Ok(());
        }
        let result = WaitForSingleObject(process, timeout_ms);
        CloseHandle(process);
        if result != WAIT_OBJECT_0 {
            bail!("JStremio did not close in time");
        }
    }
    Ok(())
}

fn message_box(message: &str, title: &str, flags: u32) -> i32 {
    let message = wide(message);
    let title = wide(title);
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            message.as_ptr(),
            title.as_ptr(),
            flags | MB_SETFOREGROUND | MB_TOPMOST,
        )
    }
}

fn wide(value: &str) -> Vec<u16> {
    OsStr::new(value).encode_wide().chain(Some(0)).collect()
}

fn write_log(directory: &Path, message: &str) {
    let _ = fs::create_dir_all(directory);
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(directory.join("updater.log"))
    {
        let _ = writeln!(file, "{message}");
    }
}
