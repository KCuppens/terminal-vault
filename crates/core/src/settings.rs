use std::fs;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::vault::write_atomic;

#[derive(Debug, Error)]
pub enum SettingsError {
    #[error("{0}")]
    Invalid(String),
    #[error("settings file is corrupt: {0}")]
    Corrupt(String),
    #[error("io error: {0}")]
    Io(#[from] io::Error),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CursorStyle {
    Block,
    Bar,
    Underline,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Bell {
    Visual,
    Sound,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    System,
    Dark,
    Light,
}

/// App preferences. Stored as plain JSON next to the vault, so they can be read while the
/// vault is locked. Nothing secret belongs here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// Minutes idle before locking. 0 = never. 1..=240.
    pub auto_lock_minutes: u32,
    pub lock_on_minimize: bool,
    /// Seconds before a copied public key is cleared from the clipboard. 0 = off.
    pub clipboard_clear_seconds: u32,
    pub font_family: String,
    /// 8..=32.
    pub font_size: u32,
    /// 100..=100000.
    pub scrollback: u32,
    pub cursor_style: CursorStyle,
    pub bell: Bell,
    pub theme: Theme,
    /// Percent: 80..=150.
    pub ui_scale: u32,
}

const MAX_AUTO_LOCK_MINUTES: u32 = 240;
const MAX_CLIPBOARD_CLEAR_SECONDS: u32 = 3600;
const MAX_FONT_FAMILY_LEN: usize = 200;

impl Default for Settings {
    fn default() -> Self {
        Self {
            auto_lock_minutes: 15,
            lock_on_minimize: true,
            clipboard_clear_seconds: 30,
            font_family: r#""Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace"#.into(),
            font_size: 14,
            scrollback: 10_000,
            cursor_style: CursorStyle::Block,
            bell: Bell::Visual,
            theme: Theme::Dark,
            ui_scale: 100,
        }
    }
}

fn check_range(name: &str, value: u32, min: u32, max: u32) -> Result<(), SettingsError> {
    if (min..=max).contains(&value) {
        Ok(())
    } else {
        Err(SettingsError::Invalid(format!(
            "{name} must be between {min} and {max}"
        )))
    }
}

impl Settings {
    pub fn validate(&self) -> Result<(), SettingsError> {
        if self.auto_lock_minutes != 0 {
            check_range(
                "auto-lock minutes",
                self.auto_lock_minutes,
                1,
                MAX_AUTO_LOCK_MINUTES,
            )?;
        }
        check_range(
            "clipboard clear seconds",
            self.clipboard_clear_seconds,
            0,
            MAX_CLIPBOARD_CLEAR_SECONDS,
        )?;
        check_range("font size", self.font_size, 8, 32)?;
        check_range("scrollback", self.scrollback, 100, 100_000)?;
        check_range("ui scale", self.ui_scale, 80, 150)?;
        let family = self.font_family.trim();
        if family.is_empty() {
            return Err(SettingsError::Invalid(
                "font family must not be empty".into(),
            ));
        }
        if family.len() > MAX_FONT_FAMILY_LEN || family.chars().any(char::is_control) {
            return Err(SettingsError::Invalid(format!(
                "font family must be plain text of at most {MAX_FONT_FAMILY_LEN} characters"
            )));
        }
        Ok(())
    }

    /// Defaults when the file does not exist. A file that exists but cannot be read or
    /// does not hold valid settings is an error, never silently replaced.
    pub fn load(path: impl AsRef<Path>) -> Result<Self, SettingsError> {
        let bytes = match fs::read(path.as_ref()) {
            Ok(b) => b,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(e) => return Err(e.into()),
        };
        let settings: Self =
            serde_json::from_slice(&bytes).map_err(|e| SettingsError::Corrupt(e.to_string()))?;
        settings
            .validate()
            .map_err(|e| SettingsError::Corrupt(e.to_string()))?;
        Ok(settings)
    }

    /// Validates, then replaces the file atomically.
    pub fn save(&self, path: impl AsRef<Path>) -> Result<(), SettingsError> {
        self.validate()?;
        let json =
            serde_json::to_vec_pretty(self).map_err(|e| SettingsError::Corrupt(e.to_string()))?;
        write_atomic(path.as_ref(), &json)?;
        Ok(())
    }
}
