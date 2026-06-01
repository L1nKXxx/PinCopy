//! 双击 Ctrl 全局热键（两次 Ctrl 轻按间隔内触发贴图）

use std::sync::{Arc, Mutex};
use std::time::Instant;

use rdev::{Event, EventType, Key};
use tauri::AppHandle;

use crate::{dispatch_pin_shortcut, log_line};

/// 两次 Ctrl 轻按的最大间隔
const DOUBLE_CTRL_MS: u128 = 400;

#[derive(Default)]
struct CtrlTapState {
    last_press: Option<Instant>,
    /// 自上次 Ctrl 按下后是否按过其它键（如 Ctrl+C 不应误触发）
    combo_since_last: bool,
}

fn is_ctrl_key(key: Key) -> bool {
    matches!(key, Key::ControlLeft | Key::ControlRight)
}

fn on_key_event(app: &AppHandle, state: &Mutex<CtrlTapState>, event: Event) {
    match event.event_type {
        EventType::KeyPress(key) if is_ctrl_key(key) => {
            let now = Instant::now();
            let mut guard = state.lock().expect("CtrlTapState lock poisoned");

            if let Some(last) = guard.last_press {
                if !guard.combo_since_last
                    && now.duration_since(last).as_millis() <= DOUBLE_CTRL_MS
                {
                    guard.last_press = None;
                    guard.combo_since_last = false;
                    dispatch_pin_shortcut(app);
                    return;
                }
            }

            guard.last_press = Some(now);
            guard.combo_since_last = false;
        }
        EventType::KeyPress(_) => {
            let mut guard = state.lock().expect("CtrlTapState lock poisoned");
            guard.combo_since_last = true;
        }
        _ => {}
    }
}

/// 在后台线程监听全局键盘，识别双击 Ctrl
#[cfg(desktop)]
pub fn start_double_ctrl_listener(app: AppHandle) {
    let state = Arc::new(Mutex::new(CtrlTapState::default()));

    std::thread::spawn(move || {
        log_line(&app, "double Ctrl listener started");
        let app_for_events = app.clone();
        if let Err(err) = rdev::listen(move |event| {
            on_key_event(&app_for_events, &state, event);
        }) {
            log_line(&app, &format!("double Ctrl listener failed: {err:?}"));
        }
    });
}
