//! 双击 Ctrl 全局热键（两次 Ctrl 轻按间隔内触发贴图）
//!
//! 识别逻辑：第一次 Ctrl **抬起**后进入待命，在窗口期内再次 **按下** Ctrl 触发。
//! 相比「连续两次 KeyPress」，可避免长按连发误触，并减少组合键后的误判。

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rdev::{Event, EventType, Key};
use tauri::AppHandle;

use crate::{dispatch_pin_shortcut, log_line};

/// 第一次 Ctrl 抬起后，允许多久内按下第二次
const DOUBLE_CTRL_WINDOW: Duration = Duration::from_millis(500);

#[derive(Clone, Copy, PartialEq, Eq)]
enum CtrlPhase {
    Idle,
    /// 第一次 Ctrl 已按下，尚未抬起
    Held,
    /// 第一次 Ctrl 已干净抬起，等待第二次按下
    Armed { released_at: Instant },
}

#[derive(Default)]
struct CtrlTapState {
    phase: CtrlPhase,
    /// 当前 Ctrl 按住期间或 Armed 等待期间，是否按过非修饰键（如 C、V）
    combo_break: bool,
    /// 本次已在第二次按下时触发过，忽略紧随其后的 KeyRelease，避免误进入 Armed
    suppress_arm_on_release: bool,
}

impl Default for CtrlPhase {
    fn default() -> Self {
        CtrlPhase::Idle
    }
}

fn is_ctrl_key(key: Key) -> bool {
    matches!(key, Key::ControlLeft | Key::ControlRight)
}

/// 修饰键单独按下不应打断双击 Ctrl（Shift / Alt 等）
fn is_modifier_key(key: Key) -> bool {
    matches!(
        key,
        Key::ControlLeft
            | Key::ControlRight
            | Key::ShiftLeft
            | Key::ShiftRight
            | Key::Alt
            | Key::AltGr
            | Key::MetaLeft
            | Key::MetaRight
            | Key::CapsLock
            | Key::NumLock
            | Key::ScrollLock
    )
}

fn reset_state(state: &mut CtrlTapState) {
    state.phase = CtrlPhase::Idle;
    state.combo_break = false;
    state.suppress_arm_on_release = false;
}

fn expire_armed_state(state: &mut CtrlTapState, now: Instant) {
    if let CtrlPhase::Armed { released_at } = state.phase {
        if now.duration_since(released_at) > DOUBLE_CTRL_WINDOW {
            reset_state(state);
        }
    }
}

fn on_key_event(app: &AppHandle, state: &Mutex<CtrlTapState>, event: Event) {
    let now = Instant::now();
    let mut guard = state.lock().expect("CtrlTapState lock poisoned");
    expire_armed_state(&mut guard, now);

    match event.event_type {
        EventType::KeyPress(key) if is_ctrl_key(key) => {
            match guard.phase {
                CtrlPhase::Armed { released_at } if !guard.combo_break => {
                    if now.duration_since(released_at) <= DOUBLE_CTRL_WINDOW {
                        guard.suppress_arm_on_release = true;
                        guard.phase = CtrlPhase::Held;
                        guard.combo_break = false;
                        drop(guard);
                        dispatch_pin_shortcut(app);
                        return;
                    }
                    guard.phase = CtrlPhase::Held;
                    guard.combo_break = false;
                }
                CtrlPhase::Idle | CtrlPhase::Armed { .. } => {
                    guard.phase = CtrlPhase::Held;
                    guard.combo_break = false;
                }
                CtrlPhase::Held => {
                    // 长按连发 KeyPress：忽略，避免旧逻辑下二次 KeyPress 误触发
                }
            }
        }
        EventType::KeyRelease(key) if is_ctrl_key(key) => {
            if guard.suppress_arm_on_release {
                guard.suppress_arm_on_release = false;
                reset_state(&mut guard);
                return;
            }

            match guard.phase {
                CtrlPhase::Held if !guard.combo_break => {
                    guard.phase = CtrlPhase::Armed {
                        released_at: now,
                    };
                    guard.combo_break = false;
                }
                _ => {
                    reset_state(&mut guard);
                }
            }
        }
        EventType::KeyPress(key) if !is_modifier_key(key) => {
            if matches!(guard.phase, CtrlPhase::Held | CtrlPhase::Armed { .. }) {
                guard.combo_break = true;
            }
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
