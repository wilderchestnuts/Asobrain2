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
  // The fitted view already shows the whole board, so zooming out past it only
  // shrinks the pieces and strands the board in a sea of background. 1 is the
  // floor; a little slack above it would just invite the same problem.
  { minZoom = 1, maxZoom = 2.8 }: BoardGestureOptions = {},
): BoardGestures {
  const ref = useRef<SVGSVGElement | null>(null);
  const [transform, setTransform] = useState<ViewTransform>(fit);

  const tRef = useRef(transform);
  const fitRef = useRef(fit);
  const frame = useRef<number | null>(null);

  /**
   * Keep the board anchored.
   *
   * At the fitted scale it is centred and cannot move. Zoomed in, panning is
   * bounded by how much of the board is actually off-screen, so it can never be
   * flung into empty space and lost — which is most of what "erratic" means on
   * a phone, where a pinch always drags a little too.
   */
  const constrain = useCallback((t: ViewTransform): ViewTransform => {
    const f = fitRef.current;
    const el = ref.current;
    const r = el?.getBoundingClientRect();
    if (!r || f.k <= 0) return t;

    const scale = t.k / f.k;
    // Slack is the extra board size the zoom created, in screen pixels.
    const slackX = Math.max(0, (r.width * scale - r.width) / 2);
    const slackY = Math.max(0, (r.height * scale - r.height) / 2);
    const centreX = f.x * scale + (r.width * (1 - scale)) / 2;
    const centreY = f.y * scale + (r.height * (1 - scale)) / 2;

    return {
      k: t.k,
      x: clamp(t.x, centreX - slackX, centreX + slackX),
      y: clamp(t.y, centreY - slackY, centreY + slackY),
    };
  }, []);

  /**
   * Commit at most one transform per animation frame. Pointer events arrive
   * far faster than the screen refreshes, and re-rendering the whole board on
   * every one of them is what makes a pinch feel like it is stuttering.
   */
  const apply = useCallback(
    (t: ViewTransform) => {
      const next = constrain(t);
      tRef.current = next;
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        setTransform(tRef.current);
      });
    },
    [constrain],
  );

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  // Re-fit whenever the layout changes: rotating the iPad should show the whole
  // board again rather than a stale corner of it.
  useEffect(() => {
    fitRef.current = fit;
    tRef.current = fit;
    setTransform(fit);
  }, [fit]);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pan = useRef<{ id: number; x: number; y: number; t: ViewTransform } | null>(null);
  const pinch = useRef<{ d: number; mx: number; my: number; t: ViewTransform } | null>(
    null,
  );
  const moved = useRef(false);
  const tap = useRef<{ x: number; y: number; at: number; onTarget: boolean } | null>(null);
  const lastTap = useRef<{ x: number; y: number; at: number } | null>(null);
  const [active, setActive] = useState(false);

  const reset = useCallback(() => {
    tRef.current = fitRef.current;
    setTransform(fitRef.current);
  }, []);

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

      // No double-tap-to-fit: placing is tap-then-tap-again on the same spot,
      // which is the identical gesture. The Fit button does the job without
      // ever fighting a placement.
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
