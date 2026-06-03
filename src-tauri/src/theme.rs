//! 外观主题偏好：持久化、托盘菜单同步、向前端广播

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

const SETTINGS_FILE: &str = "settings.json";
const EVENT_THEME_CHANGED: &str = "theme-changed";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemePreference {
    System,
    Light,
    Dark,
}

impl ThemePreference {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::Light => "light",
            Self::Dark => "dark",
        }
    }

    pub fn menu_label(self) -> &'static str {
        match self {
            Self::System => "跟随系统",
            Self::Light => "浅色模式",
            Self::Dark => "深色模式",
        }
    }
}

#[derive(Serialize, Deserialize)]
struct SettingsFile {
    theme: ThemePreference,
}

fn settings_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join(SETTINGS_FILE))
}

/// 从应用数据目录读取主题偏好，缺省为跟随系统
pub fn load_theme_preference(app: &AppHandle) -> ThemePreference {
    let Some(path) = settings_path(app) else {
        return ThemePreference::System;
    };
    let Ok(data) = std::fs::read_to_string(path) else {
        return ThemePreference::System;
    };
    serde_json::from_str::<SettingsFile>(&data)
        .map(|s| s.theme)
        .unwrap_or(ThemePreference::System)
}

fn save_theme_preference(app: &AppHandle, theme: ThemePreference) -> Result<(), String> {
    let path = settings_path(app).ok_or("无法解析应用数据目录")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let settings = SettingsFile { theme };
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

/// 保存偏好并向所有 Webview 广播
pub fn apply_theme_preference(app: &AppHandle, theme: ThemePreference) -> Result<(), String> {
    save_theme_preference(app, theme)?;
    app.emit(
        EVENT_THEME_CHANGED,
        serde_json::json!({ "preference": theme.as_str() }),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_theme_preference(app: AppHandle) -> String {
    load_theme_preference(&app).as_str().to_string()
}
