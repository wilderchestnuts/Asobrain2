'use client';

/**
 * Pan / pinch-zoom for the board, built on Pointer Events only.
 *
 * Design notes that matter on iPad:
 *
 *  - The SVG deliberately does **not** capture pointers. Capturing would
 *    retarget `pointerup` to the root and the vertex/edge hit circles would
 *    never see a tap. Instead the move/up listeners live on `window` while a
 *    gesture is in flight, which covers the finger leaving the element without
 *    stealing events from children.
 *  - `moved` is only reset on the next `pointerdown`, so a tap handler running
 *    during `pointerup` can still ask `consumedByGesture()` and bail out after
 *    a pan.
 *  - Double-tap-to-fit ignores taps that land on a `data-tap-target`, because
 *    two taps on the same spot is exactly the tap-to-confirm gesture.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';

export interface ViewTransform {
  /** Screen-space translation in CSS pixels. */
  x: number;
  y: number;
  /** CSS pixels per board-world unit. */
  k: number;
}

export interface BoardGestureOptions {
  /** Zoom bounds, relative to the fitted scale. */
  minZoom?: number;
  maxZoom?: number;
}

export interface BoardGestures {
  transform: ViewTransform;
  /** Attach to the <svg>. */
  ref: RefObject<SVGSVGElement | null>;
  onPointerDown: (e: ReactPointerEvent) => void;
  /** True while the current pointer sequence panned or pinched. */
  consumedByGesture: () => boolean;
  /** Current zoom relative to the fitted scale. */
  zoom: number;
  reset: () => void;
  zoomBy: (factor: number) => void;
}

const TAP_SLOP_PX = 9;
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_SLOP_PX = 44;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const isTapTarget = (t: EventTarget | null): boolean =>
  t instanceof Element && t.closest('[data-tap-target]') !== null;

export function useBoardGestures(
  fit: ViewTransform,
  { minZoom = 0.6, maxZoom = 3 }: BoardGestureOptions = {},
): BoardGestures {
  const ref = useRef<SVGSVGElement | null>(null);
  const [transform, setTransform] = useState<ViewTransform>(fit);

  const tRef = useRef(transform);
  const fitRef = useRef(fit);
  const apply = useCallback((t: ViewTransform) => {
    tRef.current = t;
    setTransform(t);
  }, []);

  // Re-fit whenever the layout changes: rotating the iPad should show the whole
  // board again rather than a stale corner of it.
  useEffect(() => {
    fitRef.current = fit;
    apply(fit);
  }, [fit, apply]);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pan = useRef<{ id: number; x: number; y: number; t: ViewTransform } | null>(null);
  const pinch = useRef<{ d: number; mx: number; my: number; t: ViewTransform } | null>(
    null,
  );
  const moved = useRef(false);
  const tap = useRef<{ x: number; y: number; at: number; onTarget: boolean } | null>(null);
  const lastTap = useRef<{ x: number; y: number; at: number } | null>(null);
  const [active, setActive] = useState(false);

  const reset = useCallback(() => apply(fitRef.current), [apply]);

  const zoomBy = useCallback(
    (factor: number) => {
      const el = ref.current;
      const t = tRef.current;
      const f = fitRef.current;
      const k = clamp(t.k * factor, f.k * minZoom, f.k * maxZoom);
      const r = el?.getBoundingClientRect();
      const cx = r ? r.width / 2 : 0;
      const cy = r ? r.height / 2 : 0;
      const wx = (cx - t.x) / t.k;
      const wy = (cy - t.y) / t.k;
      apply({ k, x: cx - wx * k, y: cy - wy * k });
    },
    [apply, maxZoom, minZoom],
  );

  const beginPinch = useCallback(() => {
    const pts = [...pointers.current.values()];
    if (pts.length < 2) return;
    const [a, b] = pts;
    pinch.current = {
      d: Math.hypot(b.x - a.x, b.y - a.y) || 1,
      mx: (a.x + b.x) / 2,
      my: (a.y + b.y) / 2,
      t: tRef.current,
    };
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const pts = pointers.current;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved.current = false;
      if (pts.size === 1) {
        pinch.current = null;
        pan.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: tRef.current };
        tap.current = {
          x: e.clientX,
          y: e.clientY,
          at: e.timeStamp,
          onTarget: isTapTarget(e.target),
        };
      } else if (pts.size === 2) {
        pan.current = null;
        tap.current = null;
        beginPinch();
      }
      setActive(true);
    },
    [beginPinch],
  );

  useEffect(() => {
    if (!active) return;

    const onMove = (e: PointerEvent) => {
      const pts = pointers.current;
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (e.cancelable) e.preventDefault(); // stops Safari rubber-banding the page

      const p = pinch.current;
      if (pts.size >= 2 && p) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const f = fitRef.current;
        const k = clamp((p.t.k * d) / p.d, f.k * minZoom, f.k * maxZoom);
        // Keep the world point that was under the initial midpoint pinned to
        // the current midpoint, so the zoom tracks the fingers.
        const wx = (p.mx - p.t.x) / p.t.k;
        const wy = (p.my - p.t.y) / p.t.k;
        apply({ k, x: mx - wx * k, y: my - wy * k });
        moved.current = true;
        return;
      }

      const q = pan.current;
      if (!q || q.id !== e.pointerId) return;
      const dx = e.clientX - q.x;
      const dy = e.clientY - q.y;
      if (!moved.current && Math.hypot(dx, dy) <= TAP_SLOP_PX) return;
      moved.current = true;
      apply({ k: q.t.k, x: q.t.x + dx, y: q.t.y + dy });
    };

    const onUp = (e: PointerEvent) => {
      const pts = pointers.current;
      if (!pts.delete(e.pointerId)) return;

      if (pts.size === 1) {
        // Dropping from two fingers to one: rebase the pan, and never let the
        // tail of a pinch be read as a tap.
        const [[id, pt]] = [...pts.entries()];
        pan.current = { id, x: pt.x, y: pt.y, t: tRef.current };
        pinch.current = null;
        moved.current = true;
        return;
      }
      if (pts.size > 1) {
        beginPinch();
        return;
      }

      const c = tap.current;
      if (c && !moved.current && !c.onTarget && e.timeStamp - c.at < 500) {
        const prev = lastTap.current;
        if (
          prev &&
          e.timeStamp - prev.at < DOUBLE_TAP_MS &&
          Math.hypot(c.x - prev.x, c.y - prev.y) < DOUBLE_TAP_SLOP_PX
        ) {
          reset();
          lastTap.current = null;
        } else {
          lastTap.current = { x: c.x, y: c.y, at: e.timeStamp };
        }
      }
      pan.current = null;
      pinch.current = null;
      tap.current = null;
      setActive(false);
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [active, apply, beginPinch, maxZoom, minZoom, reset]);

  // Older iOS Safari still fires its own pinch gestures even with
  // touch-action:none, and they zoom the whole page.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const block = (e: Event) => e.preventDefault();
    const names = ['gesturestart', 'gesturechange', 'gestureend'];
    for (const n of names) el.addEventListener(n, block, { passive: false });
    return () => {
      for (const n of names) el.removeEventListener(n, block);
    };
  }, []);

  const consumedByGesture = useCallback(
    () => moved.current || pointers.current.size > 1,
    [],
  );

  const zoom = useMemo(
    () => (fit.k > 0 ? transform.k / fit.k : 1),
    [transform.k, fit.k],
  );

  return { transform, ref, onPointerDown, consumedByGesture, zoom, reset, zoomBy };
}
