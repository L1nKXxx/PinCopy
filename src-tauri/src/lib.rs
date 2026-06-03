//! PinCopy 核心后端：全局热键、剪贴板读取、动态贴图窗口创建

#[cfg(desktop)]
mod hotkey;

mod theme;

use mouse_position::mouse_position::Mouse;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    webview::Color,
    AppHandle, Manager, WebviewUrl, WebviewWindowBuilder,
};
use theme::{ThemePreference, load_theme_preference};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_clipboard_manager::ClipboardExt;

/// 贴图窗口默认逻辑尺寸（与前端初始尺寸保持一致）
const PIN_WINDOW_WIDTH: f64 = 480.0;
const PIN_WINDOW_HEIGHT: f64 = 360.0;

const TRAY_ID: &str = "main-tray";
const MENU_PIN_ID: &str = "pin_now";
const MENU_AUTOSTART_ID: &str = "autostart";
const MENU_QUIT_ID: &str = "quit";
const MENU_THEME_SYSTEM_ID: &str = "theme_system";
const MENU_THEME_LIGHT_ID: &str = "theme_light";
const MENU_THEME_DARK_ID: &str = "theme_dark";

/// 写入日志到 %APPDATA%/com.pincopy.desktop/pincopy.log（release 无控制台时便于排查）
pub(crate) fn log_line(app: &AppHandle, message: &str) {
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("pincopy.log");
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let line = format!("[{ts}] {message}\n");
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .and_then(|mut f| std::io::Write::write_all(&mut f, line.as_bytes()));
}

/// 读取当前鼠标在屏幕上的物理像素坐标
fn get_cursor_physical_position() -> (i32, i32) {
    match Mouse::get_mouse_position() {
        Mouse::Position { x, y } => (x, y),
        Mouse::Error => (200, 200),
    }
}

/// 根据物理坐标查找所在显示器，用于多屏 DPI 适配
fn monitor_at_point(app: &tauri::AppHandle, x: i32, y: i32) -> Option<tauri::Monitor> {
    app.available_monitors().ok()?.into_iter().find(|m| {
        let pos = m.position();
        let size = m.size();
        x >= pos.x && x < pos.x + size.width as i32 && y >= pos.y && y < pos.y + size.height as i32
    })
}

/// 动态创建无边框置顶透明贴图窗口；内容经 initialization_script 注入（避免超长 URL）
fn create_pin_window(app: &tauri::AppHandle, text: &str) -> Result<(), Box<dyn std::error::Error>> {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_secs();
    let label = format!("pin_{timestamp}");

    let theme_pref = load_theme_preference(app);
    let init_script = format!(
        "window.__PINCOPY_CONTENT__ = {};\nwindow.__PINCOPY_THEME_PREFERENCE__ = {};",
        serde_json::to_string(text)?,
        serde_json::to_string(theme_pref.as_str())?
    );

    let (cursor_x, cursor_y) = get_cursor_physical_position();
    let scale_factor = monitor_at_point(app, cursor_x, cursor_y)
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);

    let logical_x = (cursor_x as f64 / scale_factor) - PIN_WINDOW_WIDTH / 2.0;
    let logical_y = (cursor_y as f64 / scale_factor) - PIN_WINDOW_HEIGHT / 2.0;

    WebviewWindowBuilder::new(app, &label, WebviewUrl::App("/pin".into()))
        .title("PinCopy")
        .initialization_script(init_script)
        .decorations(false)
        .always_on_top(true)
        .transparent(true)
        .background_color(Color(0, 0, 0, 0))
        .shadow(false)
        .skip_taskbar(true)
        .resizable(true)
        .visible(true)
        .inner_size(PIN_WINDOW_WIDTH, PIN_WINDOW_HEIGHT)
        .position(logical_x, logical_y)
        .build()?;

    log_line(app, &format!("pin window created: {label} ({} chars)", text.len()));
    Ok(())
}

/// 双击 Ctrl 触发：读取剪贴板文本并创建贴图
fn handle_pin_shortcut(app: &tauri::AppHandle) {
    log_line(app, "pin shortcut triggered");

    let text = match app.clipboard().read_text() {
        Ok(content) if !content.trim().is_empty() => content,
        Ok(_) => {
            log_line(app, "clipboard has no text content");
            return;
        }
        Err(err) => {
            log_line(app, &format!("failed to read clipboard: {err}"));
            return;
        }
    };

    if let Err(err) = create_pin_window(app, &text) {
        log_line(app, &format!("failed to create pin window: {err}"));
    }
}

/// 热键回调可能在非主线程触发，窗口创建必须切回主线程
pub(crate) fn dispatch_pin_shortcut(app: &tauri::AppHandle) {
    let app = app.clone();
    let app_for_handler = app.clone();
    if let Err(err) = app.run_on_main_thread(move || {
        handle_pin_shortcut(&app_for_handler);
    }) {
        log_line(&app, &format!("failed to dispatch pin shortcut: {err}"));
    }
}

#[cfg(windows)]
fn ensure_single_instance() -> bool {
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
    use windows_sys::Win32::System::Threading::CreateMutexW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONINFORMATION, MB_OK};

    let wide: Vec<u16> = "Global\\com.pincopy.desktop.single_instance"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let _handle = CreateMutexW(null_mut(), 1, wide.as_ptr());
        if GetLastError() == ERROR_ALREADY_EXISTS {
            let msg: Vec<u16> = "PinCopy 已在运行。\n请先退出托盘中的旧实例（含 debug 版或开机自启），再启动本程序。"
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect();
            let title: Vec<u16> = "PinCopy"
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect();
            MessageBoxW(
                null_mut(),
                msg.as_ptr(),
                title.as_ptr(),
                MB_OK | MB_ICONINFORMATION,
            );
            return false;
        }
    }
    true
}

#[cfg(not(windows))]
fn ensure_single_instance() -> bool {
    true
}

/// 同步托盘「外观」子菜单的勾选状态
fn sync_theme_menu_checks(
    current: ThemePreference,
    system: &CheckMenuItem<tauri::Wry>,
    light: &CheckMenuItem<tauri::Wry>,
    dark: &CheckMenuItem<tauri::Wry>,
) {
    let _ = system.set_checked(current == ThemePreference::System);
    let _ = light.set_checked(current == ThemePreference::Light);
    let _ = dark.set_checked(current == ThemePreference::Dark);
}

/// 创建系统托盘：立即贴图、开机自启、外观主题、退出
#[cfg(desktop)]
fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);
    let theme_pref = load_theme_preference(app);

    let pin_item = MenuItem::with_id(app, MENU_PIN_ID, "立即贴图 (双击 Ctrl)", true, None::<&str>)?;
    let autostart_item = CheckMenuItem::with_id(
        app,
        MENU_AUTOSTART_ID,
        "开机自启",
        true,
        autostart_enabled,
        None::<&str>,
    )?;

    let theme_system_item = CheckMenuItem::with_id(
        app,
        MENU_THEME_SYSTEM_ID,
        ThemePreference::System.menu_label(),
        true,
        theme_pref == ThemePreference::System,
        None::<&str>,
    )?;
    let theme_light_item = CheckMenuItem::with_id(
        app,
        MENU_THEME_LIGHT_ID,
        ThemePreference::Light.menu_label(),
        true,
        theme_pref == ThemePreference::Light,
        None::<&str>,
    )?;
    let theme_dark_item = CheckMenuItem::with_id(
        app,
        MENU_THEME_DARK_ID,
        ThemePreference::Dark.menu_label(),
        true,
        theme_pref == ThemePreference::Dark,
        None::<&str>,
    )?;
    let theme_submenu = Submenu::with_id_and_items(
        app,
        "theme_submenu",
        "外观",
        true,
        &[&theme_system_item, &theme_light_item, &theme_dark_item],
    )?;

    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, MENU_QUIT_ID, "退出", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &pin_item,
            &autostart_item,
            &theme_submenu,
            &separator,
            &quit_item,
        ],
    )?;

    let icon = app
        .default_window_icon()
        .cloned()
        .expect("PinCopy: missing app icon in tauri.conf.json");

    let autostart_for_handler = autostart_item.clone();
    let theme_system_for_handler = theme_system_item.clone();
    let theme_light_for_handler = theme_light_item.clone();
    let theme_dark_for_handler = theme_dark_item.clone();

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("PinCopy · 双击 Ctrl 贴图")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            MENU_PIN_ID => dispatch_pin_shortcut(app),
            MENU_AUTOSTART_ID => {
                let manager = app.autolaunch();
                match manager.is_enabled() {
                    Ok(true) => {
                        if let Err(err) = manager.disable() {
                            log_line(app, &format!("failed to disable autostart: {err}"));
                        }
                        if let Err(err) = autostart_for_handler.set_checked(false) {
                            log_line(app, &format!("failed to update autostart menu: {err}"));
                        }
                    }
                    Ok(false) => {
                        if let Err(err) = manager.enable() {
                            log_line(app, &format!("failed to enable autostart: {err}"));
                        } else if let Ok(exe) = std::env::current_exe() {
                            log_line(app, &format!("autostart enabled: {}", exe.display()));
                        }
                        if let Err(err) = autostart_for_handler.set_checked(true) {
                            log_line(app, &format!("failed to update autostart menu: {err}"));
                        }
                    }
                    Err(err) => log_line(app, &format!("failed to read autostart state: {err}")),
                }
            }
            MENU_THEME_SYSTEM_ID => {
                if let Err(err) =
                    theme::apply_theme_preference(app, ThemePreference::System)
                {
                    log_line(app, &format!("failed to set theme: {err}"));
                }
                sync_theme_menu_checks(
                    ThemePreference::System,
                    &theme_system_for_handler,
                    &theme_light_for_handler,
                    &theme_dark_for_handler,
                );
            }
            MENU_THEME_LIGHT_ID => {
                if let Err(err) = theme::apply_theme_preference(app, ThemePreference::Light) {
                    log_line(app, &format!("failed to set theme: {err}"));
                }
                sync_theme_menu_checks(
                    ThemePreference::Light,
                    &theme_system_for_handler,
                    &theme_light_for_handler,
                    &theme_dark_for_handler,
                );
            }
            MENU_THEME_DARK_ID => {
                if let Err(err) = theme::apply_theme_preference(app, ThemePreference::Dark) {
                    log_line(app, &format!("failed to set theme: {err}"));
                }
                sync_theme_menu_checks(
                    ThemePreference::Dark,
                    &theme_system_for_handler,
                    &theme_light_for_handler,
                    &theme_dark_for_handler,
                );
            }
            MENU_QUIT_ID => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if !ensure_single_instance() {
        return;
    }

    #[cfg(desktop)]
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(not(desktop))]
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init());

    builder
        .invoke_handler(tauri::generate_handler![theme::get_theme_preference])
        .setup(|app| {
            #[cfg(desktop)]
            {
                let handle = app.handle().clone();
                if let Ok(exe) = std::env::current_exe() {
                    log_line(&handle, &format!("started: {}", exe.display()));
                }

                setup_tray(&handle)?;
                hotkey::start_double_ctrl_listener(handle);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running PinCopy");
}
