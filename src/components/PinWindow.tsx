import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import "prismjs/themes/prism-tomorrow.css";
import { detectCode } from "../utils/codeDetect";
import { highlightCode, prismLanguageClass } from "../utils/highlight";
import { decodePinContent } from "../utils/pinContent";

const MIN_SCALE = 0.3;
const MAX_SCALE = 3.0;
const MIN_OPACITY = 0.2;
const MAX_OPACITY = 1.0;
/** 滚轮停止后延迟多久再同步 Tauri 物理窗口尺寸 */
const SYNC_DEBOUNCE_MS = 300;
/** 拖动触发阈值（像素），避免单击误触 */
const DRAG_THRESHOLD_PX = 4;
/** 双击判定窗口（毫秒），此时间内不启动拖动 */
const DOUBLE_CLICK_MS = 200;

export default function PinWindow() {
  const content = useMemo(() => decodePinContent(), []);
  const detection = useMemo(() => detectCode(content), [content]);

  const [opacity, setOpacity] = useState(1);
  const [baseSize, setBaseSize] = useState({ width: 480, height: 360 });
  const [copyHint, setCopyHint] = useState<string | null>(null);

  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewScaleRef = useRef(1);
  const baseSizeRef = useRef(baseSize);
  const contentRef = useRef<HTMLDivElement>(null);
  const isSyncingRef = useRef(false);
  const dragStartedRef = useRef(false);
  const dragPendingRef = useRef<{
    x: number;
    y: number;
    timer: ReturnType<typeof setTimeout> | null;
  } | null>(null);

  useEffect(() => {
    baseSizeRef.current = baseSize;
  }, [baseSize]);

  const applyPreviewScale = useCallback((scale: number) => {
    previewScaleRef.current = scale;
    if (contentRef.current) {
      contentRef.current.style.transform = `scale(${scale})`;
    }
  }, []);

  const highlightedHtml = useMemo(() => {
    if (!detection.isCode) return null;
    return highlightCode(content, detection.language);
  }, [content, detection]);

  const syncWindowSize = useCallback(async () => {
    if (isSyncingRef.current) return;

    const scale = previewScaleRef.current;
    if (Math.abs(scale - 1) < 0.001) return;

    const { width, height } = baseSizeRef.current;
    const nextWidth = Math.round(width * scale);
    const nextHeight = Math.round(height * scale);

    isSyncingRef.current = true;
    try {
      const win = getCurrentWindow();
      await win.setSize(new LogicalSize(nextWidth, nextHeight));

      const nextBaseSize = { width: nextWidth, height: nextHeight };
      baseSizeRef.current = nextBaseSize;
      setBaseSize(nextBaseSize);
      applyPreviewScale(1);
    } catch (err) {
      console.error("PinCopy: failed to sync window size", err);
    } finally {
      isSyncingRef.current = false;
    }
  }, [applyPreviewScale]);

  const scheduleSizeSync = useCallback(() => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      void syncWindowSize();
    }, SYNC_DEBOUNCE_MS);
  }, [syncWindowSize]);

  const handleWheel = useCallback(
    (event: React.WheelEvent) => {
      if (event.altKey || event.ctrlKey) {
        event.preventDefault();
        const delta = event.deltaY > 0 ? -0.05 : 0.05;
        setOpacity((prev) => {
          const next = Math.min(
            MAX_OPACITY,
            Math.max(MIN_OPACITY, prev + delta),
          );
          return next;
        });
        return;
      }

      if (event.shiftKey) {
        event.preventDefault();
        const factor = event.deltaY > 0 ? 0.92 : 1.08;
        const next = Math.min(
          MAX_SCALE,
          Math.max(MIN_SCALE, previewScaleRef.current * factor),
        );
        applyPreviewScale(next);
        scheduleSizeSync();
      }
    },
    [scheduleSizeSync, applyPreviewScale],
  );

  const handleClose = useCallback(async () => {
    try {
      await getCurrentWindow().close();
    } catch (err) {
      console.error("PinCopy: close failed", err);
    }
  }, []);

  const showCopyHint = useCallback((message: string) => {
    setCopyHint(message);
    if (copyHintTimerRef.current) clearTimeout(copyHintTimerRef.current);
    copyHintTimerRef.current = setTimeout(() => setCopyHint(null), 1200);
  }, []);

  const handleCopyAll = useCallback(async () => {
    try {
      await writeText(content);
      showCopyHint("已复制");
    } catch (err) {
      console.error("PinCopy: copy failed", err);
      showCopyHint("复制失败");
    }
  }, [content, showCopyHint]);

  const cancelPendingDrag = useCallback(() => {
    const pending = dragPendingRef.current;
    if (pending?.timer) clearTimeout(pending.timer);
    dragPendingRef.current = null;
  }, []);

  const startWindowDrag = useCallback(() => {
    if (dragStartedRef.current) return;
    dragStartedRef.current = true;
    cancelPendingDrag();
    void getCurrentWindow().startDragging().catch((err) => {
      dragStartedRef.current = false;
      console.error("PinCopy: startDragging failed", err);
    });
  }, [cancelPendingDrag]);

  const handleCardMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (event.button !== 0 || event.detail < 2) return;
      cancelPendingDrag();
      void handleClose();
    },
    [handleClose, cancelPendingDrag],
  );

  const handleDragMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (event.button !== 0) return;
      event.stopPropagation();

      if (event.detail >= 2) {
        cancelPendingDrag();
        void handleClose();
        return;
      }

      cancelPendingDrag();
      const timer = setTimeout(() => {
        if (dragPendingRef.current) {
          dragPendingRef.current.timer = null;
          startWindowDrag();
        }
      }, DOUBLE_CLICK_MS);

      dragPendingRef.current = {
        x: event.clientX,
        y: event.clientY,
        timer,
      };
    },
    [handleClose, cancelPendingDrag, startWindowDrag],
  );

  const cardClassName = detection.isCode
    ? "border-slate-700/60 bg-[#1d1f21]"
    : "border-slate-600/40 bg-slate-900/90 backdrop-blur-sm";

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const pending = dragPendingRef.current;
      if (!pending?.timer) return;

      const dx = event.clientX - pending.x;
      const dy = event.clientY - pending.y;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

      startWindowDrag();
    };

    const onMouseUp = () => {
      cancelPendingDrag();
      dragStartedRef.current = false;
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      cancelPendingDrag();
      dragStartedRef.current = false;
    };
  }, [startWindowDrag, cancelPendingDrag]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        void handleClose();
        return;
      }

      if (event.key === "c" && event.ctrlKey && event.shiftKey) {
        event.preventDefault();
        void handleCopyAll();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleClose, handleCopyAll]);

  useEffect(() => {
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      if (copyHintTimerRef.current) clearTimeout(copyHintTimerRef.current);
    };
  }, []);

  if (!content) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-transparent p-4 text-sm text-slate-400">
        无内容
      </div>
    );
  }

  return (
    <div
      className="pin-window-root h-full w-full overflow-hidden bg-transparent"
      onWheelCapture={handleWheel}
      style={{ opacity }}
    >
      <div
        ref={contentRef}
        className="pin-content h-full w-full origin-top-left"
        style={{ transform: "scale(1)" }}
      >
        <div
          className={`pin-card flex h-full w-full flex-col overflow-hidden rounded-lg border shadow-2xl ${cardClassName}`}
          onMouseDown={handleCardMouseDown}
        >
          <div className="pin-toolbar shrink-0">
            <div
              className="pin-drag-handle"
              onMouseDown={handleDragMouseDown}
              aria-label="拖动窗口"
            />
            <button
              type="button"
              className="pin-copy-btn"
              onClick={(event) => {
                event.stopPropagation();
                void handleCopyAll();
              }}
              title="复制全部 (Ctrl+Shift+C)"
            >
              复制
            </button>
            {copyHint ? (
              <span className="pin-copy-hint" aria-live="polite">
                {copyHint}
              </span>
            ) : null}
          </div>
          {detection.isCode ? (
            <pre
              className={`pin-code-block language-${detection.language} m-0 min-h-0 flex-1 overflow-auto select-text p-4 pt-2 text-[13px] leading-relaxed`}
            >
              <code
                className={prismLanguageClass(detection.language)}
                dangerouslySetInnerHTML={{ __html: highlightedHtml ?? content }}
              />
            </pre>
          ) : (
            <div className="pin-text-block min-h-0 flex-1 overflow-auto select-text p-5 pt-3 text-[15px] leading-7 text-slate-100">
              <p className="m-0 whitespace-pre-wrap break-words">{content}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
