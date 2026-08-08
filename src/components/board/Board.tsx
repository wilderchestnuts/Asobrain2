'use client';

/**
 * The board.
 *
 * Inline SVG, no canvas, no libraries. Three things drive the design, all of
 * them because this is played on an iPad:
 *
 *  1. **Hit targets are invisible circles far larger than the drawn piece.**
 *     You aim at a settlement spot the size of a fingertip, not at the 12px
 *     house that eventually appears there.
 *  2. **Tap to select, tap again to confirm.** A single mis-tap in Catan can
 *     cost the game, and there is no hover to preview with. The first tap
 *     shows a ghost and a badge; only the second commits.
 *  3. **Nothing depends on hover.** Anything reachable only by hover is
 *     unreachable here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import {
  edgeAngle,
  edgeToPixel,
  hexToPixel,
  hexKey,
  vertexToPixel,
  type EdgeId,
  type VertexId,
} from '@/game/hex';
import type {
  Board as BoardModel,
  Knight,
  RoadPiece,
  Settlement,
} from '@/game/types';
import { boardThemeCss, playerStyles, surface } from '@/lib/theme';
import { useBoardGestures, type ViewTransform } from '@/lib/useBoardGestures';

import { EdgeSpot } from './EdgeSpot';
import { Hex } from './Hex';
import { NumberToken } from './NumberToken';
import { Building, EdgePiece, KnightPiece } from './Piece';
import { Pirate } from './Pirate';
import { Port } from './Port';
import { Robber } from './Robber';
import { VertexSpot } from './VertexSpot';

/** One hex radius in board-world units. Screen size comes from the fit. */
const HEX_SIZE = 60;
/** Apple's minimum comfortable touch target, in CSS pixels. */
const MIN_TAP_PX = 44;
const PADDING = HEX_SIZE * 0.9;

export interface BoardProps {
  board: BoardModel;
  settlements?: readonly Settlement[];
  roads?: readonly RoadPiece[];
  knights?: readonly Knight[];
  players?: readonly { id: string; color?: string }[];

  /** Vertices the current player may build on right now. */
  highlightVertices?: readonly VertexId[];
  /** Edges the current player may build on right now. */
  highlightEdges?: readonly EdgeId[];
  /** What a confirmed edge tap would place, so the ghost matches. */
  edgeGhost?: 'road' | 'ship';
  /** What a confirmed vertex tap would place. */
  vertexGhost?: 'settlement' | 'city' | 'knight';

  /** Fired only after the second, confirming tap. */
  onVertexTap?: (vertex: VertexId) => void;
  onEdgeTap?: (edge: EdgeId) => void;
  onHexTap?: (coord: { q: number; r: number }) => void;

  /** Hexes the player may move the robber or pirate to. */
  highlightHexes?: readonly { q: number; r: number }[];
  /** Cities & Knights: how far the barbarians have come, 0..attacksAt. */
  barbarianPosition?: number;
  barbarianAttacksAt?: number;
  /**
   * The spot awaiting confirmation, lifted out of the board so the screen can
   * offer a full-width confirm button. Tapping a small floating badge is
   * genuinely hard on a phone; a bar at the bottom is not.
   */
  onPendingChange?: (pending: Pending) => void;
  className?: string;
}

export type Pending =
  | { kind: 'vertex'; id: VertexId }
  | { kind: 'edge'; id: EdgeId }
  | { kind: 'hex'; id: string; coord: { q: number; r: number } }
  | null;

export function Board({
  board,
  settlements = [],
  roads = [],
  knights = [],
  players,
  highlightVertices = [],
  highlightEdges = [],
  highlightHexes = [],
  edgeGhost = 'road',
  vertexGhost = 'settlement',
  onVertexTap,
  onEdgeTap,
  onHexTap,
  onPendingChange,
  barbarianPosition,
  barbarianAttacksAt = 7,
  className,
}: BoardProps) {
  const [pending, setPendingState] = useState<Pending>(null);
  const setPending = useCallback(
    (next: Pending) => {
      setPendingState(next);
      onPendingChange?.(next);
    },
    [onPendingChange],
  );
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 1024, h: 768 });

  // Re-fit on resize *and* on orientation change: rotating the iPad must show
  // the whole board again rather than a stale corner of it.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const bounds = useMemo(() => boundsOf(board), [board]);

  const fit = useMemo<ViewTransform>(() => {
    const k = Math.min(size.w / bounds.width, size.h / bounds.height);
    return {
      k,
      x: size.w / 2 - (bounds.minX + bounds.width / 2) * k,
      y: size.h / 2 - (bounds.minY + bounds.height / 2) * k,
    };
  }, [bounds, size]);

  const gestures = useBoardGestures(fit);
  const { transform, consumedByGesture } = gestures;

  /**
   * Taps are resolved to the *nearest* legal spot rather than by hit-testing
   * overlapping circles.
   *
   * A finger-sized target is about 55 board units across when zoomed out, but
   * neighbouring road spots are only 52 apart — so the circles overlapped and
   * whichever happened to be painted last swallowed the tap. That made roads
   * effectively unplaceable on a phone: each tap selected a different edge, so
   * the confirming tap never matched the first. Shrinking the circles instead
   * would have made them too small to hit at all.
   */
  const hitRadius = MIN_TAP_PX / 2 / Math.max(transform.k, 0.001);
  /** How far from a spot a tap still counts, in board units. */
  const grabRadius = Math.max(hitRadius, HEX_SIZE * 0.5);

  const pickNearest = useCallback(
    (e: ReactPointerEvent): NonNullable<Pending> | null => {
      const el = gestures.ref.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const wx = (e.clientX - r.left - transform.x) / transform.k;
      const wy = (e.clientY - r.top - transform.y) / transform.k;

      let best: NonNullable<Pending> | null = null;
      let bestD = Infinity;
      const consider = (
        px: number,
        py: number,
        candidate: NonNullable<Pending>,
      ) => {
        const d = Math.hypot(px - wx, py - wy);
        if (d < bestD) {
          bestD = d;
          best = candidate;
        }
      };

      for (const v of highlightVertices) {
        const p = vertexToPixel(v, HEX_SIZE);
        consider(p.x, p.y, { kind: 'vertex', id: v });
      }
      for (const edge of highlightEdges) {
        const p = edgeToPixel(edge, HEX_SIZE);
        consider(p.x, p.y, { kind: 'edge', id: edge });
      }
      for (const coord of highlightHexes) {
        const p = hexToPixel(coord, HEX_SIZE);
        consider(p.x, p.y, { kind: 'hex', id: hexKey(coord), coord });
      }

      return bestD <= grabRadius ? best : null;
    },
    [
      gestures.ref,
      transform,
      highlightVertices,
      highlightEdges,
      highlightHexes,
      grabRadius,
    ],
  );

  const onSurfaceTap = useCallback(
    (e: ReactPointerEvent) => {
      if (consumedByGesture()) return;
      const next = pickNearest(e);
      if (!next) {
        setPending(null); // tapping open water cancels
        return;
      }
      const same = pending && pending.kind === next.kind && pending.id === next.id;
      if (!same) {
        setPending(next);
        return;
      }
      setPending(null);
      if (next.kind === 'vertex') onVertexTap?.(next.id);
      else if (next.kind === 'edge') onEdgeTap?.(next.id);
      else onHexTap?.(next.coord);
    },
    [
      consumedByGesture,
      pickNearest,
      pending,
      setPending,
      onVertexTap,
      onEdgeTap,
      onHexTap,
    ],
  );

  // A selection that is no longer legal must not linger.
  useEffect(() => {
    if (!pending) return;
    const stillLegal =
      (pending.kind === 'vertex' && highlightVertices.includes(pending.id)) ||
      (pending.kind === 'edge' && highlightEdges.includes(pending.id)) ||
      (pending.kind === 'hex' &&
        highlightHexes.some((h) => hexKey(h) === pending.id));
    if (!stillLegal) setPending(null);
  }, [pending, highlightVertices, highlightEdges, highlightHexes]);

  const styles = useMemo(() => playerStyles(players), [players]);
  const styleFor = (owner: string) => styles[owner] ?? playerStyles([{ id: owner }])[owner];

  const robberPt = hexToPixel(board.robber, HEX_SIZE);
  const piratePt = board.pirate ? hexToPixel(board.pirate, HEX_SIZE) : null;

  return (
    <div
      ref={wrapRef}
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        // Safari would otherwise pan the page, zoom the document, flash a grey
        // tap highlight and pop a callout on long-press. All four are wrong here.
        touchAction: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none',
        WebkitTapHighlightColor: 'transparent',
        WebkitTouchCallout: 'none',
        overscrollBehavior: 'none',
        background: surface('board-bg'),
      }}
    >
      <style>{boardThemeCss()}</style>
      <style>{PULSE_CSS}</style>

      <svg
        ref={gestures.ref}
        width="100%"
        height="100%"
        onPointerDown={gestures.onPointerDown}
        onPointerUp={onSurfaceTap}
        style={{ display: 'block', touchAction: 'none' }}
      >
        <g
          transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}
        >
          {/* --- terrain --- */}
          {board.hexes.map((hex) => (
            <Hex
              key={hexKey(hex.coord)}
              coord={hex.coord}
              terrain={hex.terrain}
              size={HEX_SIZE}
            />
          ))}

          {/* --- ports --- */}
          {board.ports.map((port, i) => (
            <Port key={`port-${i}`} port={port} size={HEX_SIZE} />
          ))}

          {/* --- number tokens --- */}
          {board.hexes.map((hex) => {
            if (hex.number === undefined) return null;
            const p = hexToPixel(hex.coord, HEX_SIZE);
            return (
              <NumberToken
                key={`n-${hexKey(hex.coord)}`}
                x={p.x}
                y={p.y}
                size={HEX_SIZE}
                value={hex.number}
                muted={hexKey(hex.coord) === hexKey(board.robber)}
              />
            );
          })}

          {/* --- roads and ships, under the buildings --- */}
          {roads.map((road) => {
            const p = edgeToPixel(road.edge, HEX_SIZE);
            return (
              <EdgePiece
                key={`r-${road.edge}`}
                x={p.x}
                y={p.y}
                angle={edgeAngle(road.edge, HEX_SIZE)}
                kind={road.kind}
                style={styleFor(road.owner)}
                size={HEX_SIZE}
              />
            );
          })}

          {/* --- knights --- */}
          {knights.map((knight) => {
            const p = vertexToPixel(knight.vertex, HEX_SIZE);
            return (
              <KnightPiece
                key={`k-${knight.id}`}
                x={p.x}
                y={p.y}
                rank={knight.rank}
                active={knight.active}
                style={styleFor(knight.owner)}
                size={HEX_SIZE}
              />
            );
          })}

          {/* --- settlements and cities --- */}
          {settlements.map((s) => {
            const p = vertexToPixel(s.vertex, HEX_SIZE);
            return (
              <Building
                key={`s-${s.vertex}`}
                x={p.x}
                y={p.y}
                kind={s.kind}
                wall={s.wall}
                metropolis={s.metropolis}
                style={styleFor(s.owner)}
                size={HEX_SIZE}
              />
            );
          })}

          {/* --- barbarian approach, out in the water --- */}
          {barbarianPosition !== undefined && (
            <BarbarianTrack
              bounds={bounds}
              position={barbarianPosition}
              attacksAt={barbarianAttacksAt}
            />
          )}

          {/* --- robber and pirate --- */}
          <Robber x={robberPt.x} y={robberPt.y} size={HEX_SIZE} />
          {piratePt && (
            <Pirate x={piratePt.x} y={piratePt.y} size={HEX_SIZE} />
          )}

          {/* --- ghost preview of the pending selection --- */}
          {pending?.kind === 'vertex' &&
            (vertexGhost === 'knight' ? (
              <KnightPiece
                x={vertexToPixel(pending.id, HEX_SIZE).x}
                y={vertexToPixel(pending.id, HEX_SIZE).y}
                rank={1}
                active={false}
                style={styleFor('me')}
                size={HEX_SIZE}
                ghost
              />
            ) : (
              <Building
                x={vertexToPixel(pending.id, HEX_SIZE).x}
                y={vertexToPixel(pending.id, HEX_SIZE).y}
                kind={vertexGhost}
                style={styleFor('me')}
                size={HEX_SIZE}
                ghost
              />
            ))}
          {pending?.kind === 'edge' && (
            <EdgePiece
              x={edgeToPixel(pending.id, HEX_SIZE).x}
              y={edgeToPixel(pending.id, HEX_SIZE).y}
              angle={edgeAngle(pending.id, HEX_SIZE)}
              kind={edgeGhost}
              style={styleFor('me')}
              size={HEX_SIZE}
              ghost
            />
          )}

          {/* --- hit targets, always on top so nothing can steal the tap --- */}
          {highlightEdges.map((edge) => {
            const p = edgeToPixel(edge, HEX_SIZE);
            return (
              <EdgeSpot
                key={`he-${edge}`}
                x={p.x}
                y={p.y}
                size={HEX_SIZE}
                angle={edgeAngle(edge, HEX_SIZE)}
                pending={pending?.kind === 'edge' && pending.id === edge}
                label={`Build ${edgeGhost}`}
              />
            );
          })}

          {highlightVertices.map((vertex) => {
            const p = vertexToPixel(vertex, HEX_SIZE);
            return (
              <VertexSpot
                key={`hv-${vertex}`}
                x={p.x}
                y={p.y}
                size={HEX_SIZE}
                pending={pending?.kind === 'vertex' && pending.id === vertex}
                label={`Build ${vertexGhost}`}
              />
            );
          })}

          {highlightHexes.map((coord) => {
            const p = hexToPixel(coord, HEX_SIZE);
            const key = hexKey(coord);
            return (
              <VertexSpot
                key={`hh-${key}`}
                x={p.x}
                y={p.y}
                size={HEX_SIZE}
                pending={pending?.kind === 'hex' && pending.id === key}
                label="Move the robber here"
              />
            );
          })}
        </g>
      </svg>

      <ZoomControls
        onIn={() => gestures.zoomBy(1.3)}
        onOut={() => gestures.zoomBy(1 / 1.3)}
        onReset={gestures.reset}
      />
    </div>
  );
}

/**
 * Explicit zoom buttons alongside the pinch gesture. Pinching is discoverable
 * for most people but not everyone, and the buttons cost nothing.
 */
function ZoomControls({
  onIn,
  onOut,
  onReset,
}: {
  onIn: () => void;
  onOut: () => void;
  onReset: () => void;
}) {
  const btn: React.CSSProperties = {
    width: 44,
    height: 44,
    borderRadius: 12,
    border: `1px solid ${surface('chrome-edge')}`,
    background: surface('chrome'),
    color: surface('chrome-ink'),
    fontSize: 20,
    lineHeight: '1',
    display: 'grid',
    placeItems: 'center',
    touchAction: 'manipulation',
  };
  return (
    <div
      style={{
        position: 'absolute',
        // Clear of the home indicator in landscape and portrait alike.
        right: 'max(12px, env(safe-area-inset-right))',
        bottom: 'max(12px, env(safe-area-inset-bottom))',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <button type="button" style={btn} onClick={onIn} aria-label="Zoom in">
        +
      </button>
      <button type="button" style={btn} onClick={onOut} aria-label="Zoom out">
        −
      </button>
      <button
        type="button"
        style={{ ...btn, fontSize: 13 }}
        onClick={onReset}
        aria-label="Fit board to screen"
      >
        fit
      </button>
    </div>
  );
}

/**
 * The barbarians' approach, drawn along the top of the sea.
 *
 * A number in the corner does not convey "they are nearly here"; a ship
 * visibly closing on the island does. The track runs from open water to the
 * coast, one step per barbarian roll.
 */
function BarbarianTrack({
  bounds,
  position,
  attacksAt,
}: {
  bounds: { minX: number; minY: number; width: number; height: number };
  position: number;
  attacksAt: number;
}) {
  const steps = Math.max(1, attacksAt);
  const clamped = Math.min(Math.max(position, 0), steps);
  const y = bounds.minY + HEX_SIZE * 0.55;
  const x0 = bounds.minX + bounds.width * 0.16;
  const x1 = bounds.minX + bounds.width * 0.84;
  const at = (i: number) => x0 + ((x1 - x0) * i) / steps;
  const imminent = clamped >= steps - 1;

  return (
    <g pointerEvents="none">
      <line
        x1={x0}
        y1={y}
        x2={x1}
        y2={y}
        stroke={surface('ink-soft')}
        strokeWidth={HEX_SIZE * 0.035}
        strokeDasharray={`${HEX_SIZE * 0.1} ${HEX_SIZE * 0.1}`}
      />
      {Array.from({ length: steps + 1 }, (_, i) => (
        <circle
          key={i}
          cx={at(i)}
          cy={y}
          r={HEX_SIZE * (i === steps ? 0.11 : 0.07)}
          fill={
            i === steps
              ? surface('token-hot')
              : i <= clamped
                ? surface('ink-soft')
                : surface('token-bg')
          }
          stroke={surface('ink-soft')}
          strokeWidth={HEX_SIZE * 0.018}
        />
      ))}

      <text
        x={x0}
        y={y - HEX_SIZE * 0.26}
        textAnchor="start"
        fontSize={HEX_SIZE * 0.2}
        fontWeight={600}
        fill={surface('ink-soft')}
      >
        Barbarians
      </text>
      <text
        x={x1}
        y={y - HEX_SIZE * 0.26}
        textAnchor="end"
        fontSize={HEX_SIZE * 0.2}
        fontWeight={700}
        fill={imminent ? surface('token-hot') : surface('ink-soft')}
      >
        {clamped >= steps
          ? 'Attacking!'
          : `attack in ${steps - clamped} roll${steps - clamped === 1 ? '' : 's'}`}
      </text>

      {/* The ship itself, sitting on the current step. */}
      <g transform={`translate(${at(clamped)} ${y})`}>
        <path
          d={`M${-HEX_SIZE * 0.24} ${-HEX_SIZE * 0.04} L${HEX_SIZE * 0.24} ${
            -HEX_SIZE * 0.04
          } L${HEX_SIZE * 0.16} ${HEX_SIZE * 0.13} Q0 ${HEX_SIZE * 0.19} ${
            -HEX_SIZE * 0.16
          } ${HEX_SIZE * 0.13} Z`}
          fill={imminent ? surface('token-hot') : surface('robber')}
          stroke={surface('robber-rim')}
          strokeWidth={HEX_SIZE * 0.02}
        />
        <path
          d={`M0 ${-HEX_SIZE * 0.06} L0 ${-HEX_SIZE * 0.3} L${HEX_SIZE * 0.17} ${
            -HEX_SIZE * 0.16
          } Z`}
          fill={imminent ? surface('token-hot') : surface('robber')}
          stroke={surface('robber-rim')}
          strokeWidth={HEX_SIZE * 0.02}
        />
      </g>
    </g>
  );
}

/** World-space extent of the board, padded so nothing touches the edge. */
function boundsOf(board: BoardModel) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const hex of board.hexes) {
    const c = hexToPixel(hex.coord, HEX_SIZE);
    minX = Math.min(minX, c.x - HEX_SIZE);
    maxX = Math.max(maxX, c.x + HEX_SIZE);
    minY = Math.min(minY, c.y - HEX_SIZE);
    maxY = Math.max(maxY, c.y + HEX_SIZE);
  }
  if (!Number.isFinite(minX)) {
    minX = -HEX_SIZE;
    minY = -HEX_SIZE;
    maxX = HEX_SIZE;
    maxY = HEX_SIZE;
  }

  return {
    minX: minX - PADDING,
    minY: minY - PADDING,
    width: maxX - minX + PADDING * 2,
    height: maxY - minY + PADDING * 2,
  };
}

/** Respect prefers-reduced-motion: the pulse is a nicety, not information. */
const PULSE_CSS = `
@keyframes asb-pulse{0%,100%{opacity:.18;transform:scale(.92)}50%{opacity:.42;transform:scale(1.08)}}
.asb-pulse{animation:asb-pulse 1.8s ease-in-out infinite;transform-origin:center}
@media (prefers-reduced-motion:reduce){.asb-pulse{animation:none;opacity:.32}}
`;
