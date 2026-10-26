use tempfile::TempDir;
use tvcore::settings::{Bell, CursorStyle, Theme};
use tvcore::{Settings, SettingsError};

#[test]
fn defaults_match_the_documented_values() {
    let s = Settings::default();
    assert_eq!(s.auto_lock_minutes, 15);
    assert!(s.lock_on_minimize);
    assert_eq!(s.clipboard_clear_seconds, 30);
    assert_eq!(s.font_size, 14);
    assert_eq!(s.scrollback, 10_000);
    assert_eq!(s.cursor_style, CursorStyle::Block);
    assert_eq!(s.bell, Bell::Visual);
    assert_eq!(s.theme, Theme::Dark);
    assert_eq!(s.ui_scale, 100);
    s.validate().unwrap();
}

#[test]
fn missing_file_loads_defaults() {
    let dir = TempDir::new().unwrap();
    let s = Settings::load(dir.path().join("settings.json")).unwrap();
    assert_eq!(s, Settings::default());
}

#[test]
fn save_then_load_roundtrips() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("settings.json");
    let s = Settings {
        auto_lock_minutes: 0,
        lock_on_minimize: false,
        clipboard_clear_seconds: 0,
        font_family: "Fira Code".into(),
        font_size: 18,
        scrollback: 500,
        cursor_style: CursorStyle::Underline,
        bell: Bell::None,
        theme: Theme::Light,
        ui_scale: 125,
    };
    s.save(&path).unwrap();
    assert_eq!(Settings::load(&path).unwrap(), s);
    let json: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(json["cursor_style"], "underline");
    assert_eq!(json["bell"], "none");
    assert_eq!(json["theme"], "light");
    let leftovers: Vec<_> = std::fs::read_dir(dir.path()).unwrap().collect();
    assert_eq!(leftovers.len(), 1, "no temp files left behind");
}

#[test]
fn ranges_are_enforced_at_the_edges() {
    let ok = |f: fn(&mut Settings)| {
        let mut s = Settings::default();
        f(&mut s);
        s.validate().is_ok()
    };
    assert!(ok(|s| s.auto_lock_minutes = 0));
    assert!(ok(|s| s.auto_lock_minutes = 1));
    assert!(ok(|s| s.auto_lock_minutes = 240));
    assert!(!ok(|s| s.auto_lock_minutes = 241));
    assert!(ok(|s| s.font_size = 8));
    assert!(ok(|s| s.font_size = 32));
    assert!(!ok(|s| s.font_size = 7));
    assert!(!ok(|s| s.font_size = 33));
    assert!(ok(|s| s.scrollback = 100));
    assert!(ok(|s| s.scrollback = 100_000));
    assert!(!ok(|s| s.scrollback = 99));
    assert!(!ok(|s| s.scrollback = 100_001));
    assert!(ok(|s| s.ui_scale = 80));
    assert!(ok(|s| s.ui_scale = 150));
    assert!(!ok(|s| s.ui_scale = 79));
    assert!(!ok(|s| s.ui_scale = 151));
    assert!(!ok(|s| s.clipboard_clear_seconds = 3601));
    assert!(!ok(|s| s.font_family = "  ".into()));
    assert!(!ok(|s| s.font_family = "a\nb".into()));
    assert!(!ok(|s| s.font_family = "x".repeat(201)));
}

#[test]
fn invalid_settings_are_not_written() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("settings.json");
    let s = Settings {
        font_size: 99,
        ..Settings::default()
    };
    let err = s.save(&path).unwrap_err();
    assert!(matches!(err, SettingsError::Invalid(_)));
    assert_eq!(err.to_string(), "font size must be between 8 and 32");
    assert!(!path.exists());
}

#[test]
fn corrupt_or_out_of_range_files_are_errors_not_defaults() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("settings.json");
    std::fs::write(&path, "{ not json").unwrap();
    assert!(matches!(
        Settings::load(&path),
        Err(SettingsError::Corrupt(_))
    ));
    std::fs::write(&path, r#"{"theme":"neon"}"#).unwrap();
    assert!(matches!(
        Settings::load(&path),
        Err(SettingsError::Corrupt(_))
    ));
    std::fs::write(&path, r#"{"font_size":500}"#).unwrap();
    assert!(matches!(
        Settings::load(&path),
        Err(SettingsError::Corrupt(_))
    ));
}

#[test]
fn partial_files_fill_in_defaults_and_unknown_keys_are_ignored() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("settings.json");
    std::fs::write(&path, r#"{"font_size":20,"from_the_future":true}"#).unwrap();
    let s = Settings::load(&path).unwrap();
    assert_eq!(s.font_size, 20);
    assert_eq!(s.scrollback, 10_000);
}

#[test]
fn save_replaces_a_corrupt_file() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("settings.json");
    std::fs::write(&path, "garbage").unwrap();
    Settings::default().save(&path).unwrap();
    assert_eq!(Settings::load(&path).unwrap(), Settings::default());
}
