//! First-launch desktop integration.
//!
//! Installs a platform-appropriate desktop entry/app bundle/shortcut so the
//! user can launch Bullarchy GUI without opening a terminal.
//! Runs once, guarded by a marker file at:
//!   ~/.config/bullarchy-gui/.desktop_installed

use std::path::PathBuf;
use std::fs;

// ── Embedded SVG icon ─────────────────────────────────────────────────────────

const ICON_SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="48" fill="#04060f"/>
  <rect width="256" height="256" rx="48" fill="url(#bg)"/>
  <defs>
    <radialGradient id="bg" cx="30%" cy="20%" r="80%">
      <stop offset="0%" stop-color="#1a3a6e" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="#04060f"/>
    </radialGradient>
  </defs>
  <!-- Stars -->
  <circle cx="40"  cy="30"  r="1.2" fill="#6db8ff" opacity="0.8"/>
  <circle cx="200" cy="50"  r="1"   fill="#e8f0ff" opacity="0.6"/>
  <circle cx="220" cy="20"  r="1.5" fill="#6db8ff" opacity="0.7"/>
  <circle cx="80"  cy="60"  r="1"   fill="#e8f0ff" opacity="0.5"/>
  <circle cx="170" cy="35"  r="1.2" fill="#6db8ff" opacity="0.9"/>
  <circle cx="30"  cy="80"  r="1"   fill="#e8f0ff" opacity="0.4"/>
  <circle cx="230" cy="100" r="1.3" fill="#6db8ff" opacity="0.6"/>
  <!-- B letterform -->
  <text x="128" y="172" font-family="monospace" font-size="140" font-weight="bold"
        text-anchor="middle" fill="none"
        stroke="url(#glow)" stroke-width="2">B</text>
  <text x="128" y="172" font-family="monospace" font-size="140" font-weight="bold"
        text-anchor="middle" fill="url(#letter)">B</text>
  <defs>
    <linearGradient id="letter" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#6db8ff"/>
      <stop offset="100%" stop-color="#2557a7"/>
    </linearGradient>
    <linearGradient id="glow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#4a9eff" stop-opacity="0.8"/>
      <stop offset="100%" stop-color="#1a3a6e" stop-opacity="0.4"/>
    </linearGradient>
  </defs>
</svg>"##;

// ── Marker ────────────────────────────────────────────────────────────────────

fn marker_path() -> Option<PathBuf> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()?;
    Some(PathBuf::from(home)
        .join(".config")
        .join("bullarchy-gui")
        .join(".desktop_installed"))
}

fn already_installed() -> bool {
    marker_path().map_or(false, |p| p.exists())
}

fn write_marker() {
    if let Some(p) = marker_path() {
        if let Some(parent) = p.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(p, "1");
    }
}

// ── Public entry point ────────────────────────────────────────────────────────

pub fn install_if_first_launch() {
    if already_installed() { return; }

    let result = {
        #[cfg(target_os = "linux")]
        { install_linux() }
        #[cfg(target_os = "macos")]
        { install_macos() }
        #[cfg(target_os = "windows")]
        { install_windows() }
        #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
        { Ok(()) }
    };

    match result {
        Ok(()) => {
            write_marker();
            println!("Desktop icon installed.");
        }
        Err(e) => {
            eprintln!("Could not install desktop icon: {e}");
        }
    }
}

// ── Linux (.desktop + XDG icon) ───────────────────────────────────────────────

#[cfg(target_os = "linux")]
fn install_linux() -> Result<(), Box<dyn std::error::Error>> {
    let home = std::env::var("HOME")?;
    let home = PathBuf::from(home);

    // Write icon
    let icon_dir = home.join(".local/share/icons/hicolor/scalable/apps");
    fs::create_dir_all(&icon_dir)?;
    let icon_path = icon_dir.join("bullarchy-gui.svg");
    fs::write(&icon_path, ICON_SVG)?;

    // Resolve binary path
    let bin = which_bullarchy_gui();

    // Write .desktop entry
    let apps_dir = home.join(".local/share/applications");
    fs::create_dir_all(&apps_dir)?;

    let desktop = format!(
        "[Desktop Entry]\n\
         Version=1.0\n\
         Type=Application\n\
         Name=Bullarchy GUI\n\
         Comment=Bullang project toolchain — graphical interface\n\
         Exec={bin}\n\
         Icon=bullarchy-gui\n\
         Terminal=false\n\
         Categories=Development;\n\
         StartupWMClass=bullarchy-gui\n"
    );

    fs::write(apps_dir.join("bullarchy-gui.desktop"), desktop)?;

    // Refresh desktop database (best-effort)
    let _ = std::process::Command::new("update-desktop-database")
        .arg(apps_dir.to_str().unwrap_or(""))
        .status();

    Ok(())
}

// ── macOS (.app bundle) ───────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn install_macos() -> Result<(), Box<dyn std::error::Error>> {
    let home = std::env::var("HOME")?;
    let app  = PathBuf::from(&home).join("Applications/Bullarchy GUI.app");

    let contents   = app.join("Contents");
    let macos_dir  = contents.join("MacOS");
    let resources  = contents.join("Resources");

    fs::create_dir_all(&macos_dir)?;
    fs::create_dir_all(&resources)?;

    // Info.plist
    let plist = r##"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>             <string>Bullarchy GUI</string>
  <key>CFBundleIdentifier</key>       <string>com.mysidequests.bullarchy-gui</string>
  <key>CFBundleVersion</key>          <string>1.0.0</string>
  <key>CFBundleExecutable</key>       <string>bullarchy-gui-launcher</string>
  <key>CFBundleIconFile</key>         <string>icon</string>
  <key>CFBundlePackageType</key>      <string>APPL</string>
  <key>LSUIElement</key>              <false/>
  <key>NSHighResolutionCapable</key>  <true/>
</dict>
</plist>"##;
    fs::write(contents.join("Info.plist"), plist)?;

    // SVG icon (macOS won't use it natively but keeps it for future icns conversion)
    fs::write(resources.join("icon.svg"), ICON_SVG)?;

    // Launcher script
    let bin = which_bullarchy_gui();
    let launcher = format!(
        "#!/bin/sh\nexec \"{bin}\"\n"
    );
    let launcher_path = macos_dir.join("bullarchy-gui-launcher");
    fs::write(&launcher_path, launcher)?;

    // Make executable
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&launcher_path, fs::Permissions::from_mode(0o755))?;
    }

    Ok(())
}

// ── Windows (.lnk shortcut via PowerShell) ────────────────────────────────────

#[cfg(target_os = "windows")]
fn install_windows() -> Result<(), Box<dyn std::error::Error>> {
    let userprofile = std::env::var("USERPROFILE")?;
    let desktop     = PathBuf::from(&userprofile).join("Desktop");

    // Write icon SVG to AppData
    let icon_dir = PathBuf::from(&userprofile)
        .join("AppData\\Roaming\\bullarchy-gui");
    fs::create_dir_all(&icon_dir)?;
    let icon_path = icon_dir.join("icon.svg");
    fs::write(&icon_path, ICON_SVG)?;

    let bin       = which_bullarchy_gui();
    let shortcut  = desktop.join("Bullarchy GUI.lnk");

    // PowerShell one-liner to create a proper .lnk
    let ps = format!(
        r#"$s=(New-Object -COM WScript.Shell).CreateShortcut('{lnk}');$s.TargetPath='{bin}';$s.Description='Bullang project toolchain';$s.Save()"#,
        lnk = shortcut.to_string_lossy().replace('\'', "''"),
        bin = bin.replace('\'', "''"),
    );

    std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &ps])
        .status()?;

    Ok(())
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Find the bullarchy-gui binary. Tries `which`/`where` first, falls back to
/// the current executable path.
fn which_bullarchy_gui() -> String {
    // Try which (Unix) / where (Windows)
    #[cfg(unix)]
    let cmd = "which";
    #[cfg(windows)]
    let cmd = "where";

    if let Ok(out) = std::process::Command::new(cmd).arg("bullarchy-gui").output() {
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !s.is_empty() { return s; }
    }

    // Fall back to current executable
    std::env::current_exe()
        .ok()
        .and_then(|p| p.to_str().map(String::from))
        .unwrap_or_else(|| "bullarchy-gui".to_string())
}
