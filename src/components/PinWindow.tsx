import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import prismDarkUrl from "prismjs/themes/prism-tomorrow.css?url";
import prismLightUrl from "prismjs/themes/prism.css?url";
import { useTheme } from "../hooks/useTheme";
import { detectCode } from "../utils/codeDetect";
import { highlightCode, prismLanguageClass } from "../utils/highlight";
import { tryFormatJson } from "../utils/formatJson";
import { decodePinContent } from "../utils/pinContent";

const PRISM_THEME_LINK_ID = "pincopy-prism-theme";

const MIN_SCALE = 0.3;
const MAX_SCALE = 3.0;
const MIN_OPACITY = 0.2;
const MAX_OPACITY = 1.0;
/** 滚轮停止后最终对齐窗口尺寸 */
const SYNC_DEBOUNCE_MS = 120;
/** 缩放过程中渐进提交物理尺寸，避免 transform 累积过大导致裁切与结束跳变 */
const INCREMENTAL_SYNC_MS = 80;
/** 累积预览缩放超过此阈值时触发渐进提交 */
const INCREMENTAL_SCALE_THRESHOLD = 0.12;
/** 指数缩放灵敏度（合并同一帧内多次滚轮 delta） */
const ZOOM_SENSITIVITY = 0.0012;
/** 按住并移动超过此距离才启动窗口拖动，避免单击触发 startDragging 后丢失 mouseup 导致「粘滞」跟随 */
const DRAG_THRESHOLD_PX = 5;

function initialDisplayContent(): string {
  const raw = decodePinContent();
  return tryFormatJson(raw) ?? raw;
}

export default function PinWindow() {
  const resolvedTheme = useTheme();
  const [displayContent] = useState(initialDisplayContent);
  const detection = useMemo(() => detectCode(displayContent), [displayContent]);

  const [opacity, setOpacity] = useState(1);
  const [copyHint, setCopyHint] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const incrementalSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewScaleRef = useRef(1);
  const baseSizeRef = useRef({ width: 480, height: 360 });
  const contentRef = useRef<HTMLDivElement>(null);
  const isSyncingRef = useRef(false);
  const zoomRafRef = useRef<number | null>(null);
  const pendingZoomDeltaRef = useRef(0);
  const clampScale = useCallback((scale: number) => {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
  }, []);

  const applyPreviewScale = useCallback((scale: number) => {
    previewScaleRef.current = scale;
    const el = contentRef.current;
    if (el) {
      el.style.transform = `scale3d(${scale}, ${scale}, 1)`;
    }
  }, []);

  const commitPreviewScale = useCallback(async () => {
    if (isSyncingRef.current) return;

    const scale = previewScaleRef.current;
    if (Math.abs(scale - 1) < 0.02) return;

    const { width, height } = baseSizeRef.current;
    const nextWidth = Math.round(width * scale);
    const nextHeight = Math.round(height * scale);

    isSyncingRef.current = true;
    try {
      await getCurrentWindow().setSize(new LogicalSize(nextWidth, nextHeight));
      baseSizeRef.current = { width: nextWidth, height: nextHeight };
      requestAnimationFrame(() => applyPreviewScale(1));
    } catch (err) {
      console.error("PinCopy: failed to sync window size", err);
    } finally {
      isSyncingRef.current = false;
    }
  }, [applyPreviewScale]);

  const scheduleFinalSync = useCallback(() => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      void commitPreviewScale();
    }, SYNC_DEBOUNCE_MS);
  }, [commitPreviewScale]);

  const scheduleIncrementalSync = useCallback(() => {
    if (incrementalSyncTimerRef.current) return;
    incrementalSyncTimerRef.current = setTimeout(() => {
      incrementalSyncTimerRef.current = null;
      if (Math.abs(previewScaleRef.current - 1) >= INCREMENTAL_SCALE_THRESHOLD) {
        void commitPreviewScale();
      }
    }, INCREMENTAL_SYNC_MS);
  }, [commitPreviewScale]);

  const flushZoomFrame = useCallback(() => {
    zoomRafRef.current = null;

    const delta = pendingZoomDeltaRef.current;
    pendingZoomDeltaRef.current = 0;
    if (Math.abs(delta) < 0.01) return;

    const factor = Math.exp(-delta * ZOOM_SENSITIVITY);
    const next = clampScale(previewScaleRef.current * factor);
    applyPreviewScale(next);
    scheduleIncrementalSync();
    scheduleFinalSync();
  }, [applyPreviewScale, clampScale, scheduleFinalSync, scheduleIncrementalSync]);

  const queueZoomDelta = useCallback(
    (deltaY: number) => {
      pendingZoomDeltaRef.current += deltaY;
      if (zoomRafRef.current === null) {
        zoomRafRef.current = requestAnimationFrame(flushZoomFrame);
      }
    },
    [flushZoomFrame],
  );

  const highlightedHtml = useMemo(() => {
    if (!detection.isCode) return null;
    return highlightCode(displayContent, detection.language);
  }, [displayContent, detection]);

  useEffect(() => {
    document.documentElement.classList.add("pin-window");
    return () => document.documentElement.classList.remove("pin-window");
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const onWheel = (event: WheelEvent) => {
      if (event.altKey) {
        event.preventDefault();
        const delta = event.deltaY > 0 ? -0.05 : 0.05;
        setOpacity((prev) =>
          Math.min(MAX_OPACITY, Math.max(MIN_OPACITY, prev + delta)),
        );
        return;
      }

      if (event.shiftKey) {
        event.preventDefault();
        queueZoomDelta(event.deltaY);
      }
    };

    root.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => root.removeEventListener("wheel", onWheel, { capture: true });
  }, [queueZoomDelta]);

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
      await writeText(displayContent);
      showCopyHint("已复制");
    } catch (err) {
      console.error("PinCopy: copy failed", err);
      showCopyHint("复制失败");
    }
  }, [displayContent, showCopyHint]);

  const handleDragPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.stopPropagation();

      const handle = event.currentTarget;
      const startX = event.clientX;
      const startY = event.clientY;
      let dragStarted = false;

      const cleanup = () => {
        handle.removeEventListener("pointermove", onPointerMove);
        handle.removeEventListener("pointerup", onPointerUp);
        handle.removeEventListener("pointercancel", onPointerUp);
        if (handle.hasPointerCapture(event.pointerId)) {
          handle.releasePointerCapture(event.pointerId);
        }
      };

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (dragStarted || (moveEvent.buttons & 1) === 0) return;

        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

        dragStarted = true;
        void getCurrentWindow().startDragging().catch((err) => {
          dragStarted = false;
          console.error("PinCopy: startDragging failed", err);
        });
      };

      const onPointerUp = () => {
        cleanup();
      };

      handle.setPointerCapture(event.pointerId);
      handle.addEventListener("pointermove", onPointerMove);
      handle.addEventListener("pointerup", onPointerUp);
      handle.addEventListener("pointercancel", onPointerUp);
    },
    [],
  );

  const cardClassName = detection.isCode
    ? "pin-card--code"
    : "pin-card--text";

  useEffect(() => {
    let link = document.getElementById(
      PRISM_THEME_LINK_ID,
    ) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = PRISM_THEME_LINK_ID;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.href = resolvedTheme === "dark" ? prismDarkUrl : prismLightUrl;
  }, [resolvedTheme]);

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
      if (incrementalSyncTimerRef.current) {
        clearTimeout(incrementalSyncTimerRef.current);
      }
      if (copyHintTimerRef.current) clearTimeout(copyHintTimerRef.current);
      if (zoomRafRef.current !== null) cancelAnimationFrame(zoomRafRef.current);
    };
  }, []);

  if (!displayContent) {
    return (
      <div className="pin-empty flex h-full w-full items-center justify-center bg-transparent p-4 text-sm">
        无内容
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="pin-window-root h-full w-full bg-transparent"
    >
      <div
        ref={contentRef}
        className="pin-content h-full w-full origin-top-left"
      >
        <div
          className={`pin-card flex h-full w-full flex-col overflow-hidden ${cardClassName}`}
          style={{ opacity }}
        >
          <div className="pin-toolbar shrink-0">
            <div
              className="pin-drag-handle"
              onPointerDown={handleDragPointerDown}
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
                dangerouslySetInnerHTML={{ __html: highlightedHtml ?? displayContent }}
              />
            </pre>
          ) : (
            <div className="pin-text-block min-h-0 flex-1 overflow-auto select-text p-5 pt-3 text-[15px] leading-7">
              <p className="m-0 whitespace-pre-wrap break-words">{displayContent}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
