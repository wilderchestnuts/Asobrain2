'use client';

/**
 * A standalone look at the board, without a server or a database.
 *
 * `npm run dev`, then open /board-preview. It generates a real board from the
 * real engine and wires up real legal-move highlighting, so what you see here
 * is what the game will look like.
 */

import { useMemo, useState } from 'react';

import { Board } from '@/components/board/Board';
import { generateBoard } from '@/game/board';
import { boardForOptions, SCENARIOS } from '@/game/scenarios';
import { Rng } from '@/game/rng';
import { DEFAULT_OPTIONS } from '@/game/setup';
import type { EdgeId, VertexId } from '@/game/hex';
import { edgeVertices, vertexEdges } from '@/game/hex';
import type { GameOptions, Knight, RoadPiece, Settlement } from '@/game/types';
import { surface } from '@/lib/theme';

const PLAYERS = [
  { id: 'p0', color: 'red' },
  { id: 'p1', color: 'blue' },
  { id: 'p2', color: 'orange' },
];

type Mode = 'settlement' | 'city' | 'road' | 'ship' | 'knight';

export default function BoardPreviewPage() {
  const [scenario, setScenario] = useState('random');
  const [seed, setSeed] = useState('preview');
  const [mode, setMode] = useState<Mode>('settlement');

  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [roads, setRoads] = useState<RoadPiece[]>([]);
  const [knights, setKnights] = useState<Knight[]>([]);

  const board = useMemo(() => {
    const options: GameOptions = {
      ...DEFAULT_OPTIONS,
      seed,
      scenario,
      goldHexCount: scenario === 'random' ? 2 : DEFAULT_OPTIONS.goldHexCount,
      expansions: { seafarers: scenario !== 'random', citiesAndKnights: true },
    };
    const rng = new Rng(seed, 0);
    return scenario === 'random'
      ? generateBoard(options, rng)
      : boardForOptions(options, rng);
  }, [scenario, seed]);

  const taken = useMemo(
    () => ({
      vertices: new Set(settlements.map((s) => s.vertex)),
      edges: new Set(roads.map((r) => r.edge)),
    }),
    [settlements, roads],
  );

  // Not the real rules — just enough to exercise the tap targets and ghosts.
  const highlightVertices = useMemo<VertexId[]>(() => {
    if (mode === 'city') return settlements.filter((s) => s.kind === 'settlement').map((s) => s.vertex);
    if (mode === 'road' || mode === 'ship') return [];
    return board.landVertices.filter((v) => {
      if (taken.vertices.has(v)) return false;
      return !vertexEdges(v).some((e) =>
        edgeVertices(e).some((n) => n !== v && taken.vertices.has(n)),
      );
    });
  }, [board, mode, settlements, taken]);

  const highlightEdges = useMemo<EdgeId[]>(() => {
    if (mode === 'road') return board.roadEdges.filter((e) => !taken.edges.has(e));
    if (mode === 'ship') return board.shipEdges.filter((e) => !taken.edges.has(e));
    return [];
  }, [board, mode, taken]);

  const owner = PLAYERS[settlements.length % PLAYERS.length].id;

  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        background: surface('board-bg'),
        color: surface('chrome-ink'),
      }}
    >
      <header
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
          padding: `max(8px, env(safe-area-inset-top)) 12px 8px`,
          background: surface('chrome'),
          borderBottom: `1px solid ${surface('chrome-edge')}`,
        }}
      >
        <strong style={{ marginRight: 4 }}>Board preview</strong>

        <select
          value={scenario}
          onChange={(e) => {
            setScenario(e.target.value);
            setSettlements([]);
            setRoads([]);
            setKnights([]);
          }}
          style={selectStyle}
        >
          <option value="random">Random island</option>
          {Object.entries(SCENARIOS)
            .filter(([id]) => id !== 'random')
            .map(([id, s]) => (
              <option key={id} value={id}>
                {s.name}
              </option>
            ))}
        </select>

        {(['settlement', 'city', 'road', 'ship', 'knight'] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            style={{
              ...chipStyle,
              background: mode === m ? surface('highlight') : surface('chrome'),
              fontWeight: mode === m ? 600 : 400,
            }}
          >
            {m}
          </button>
        ))}

        <button
          type="button"
          style={chipStyle}
          onClick={() => setSeed(Math.random().toString(36).slice(2, 8))}
        >
          New board
        </button>
        <button
          type="button"
          style={chipStyle}
          onClick={() => {
            setSettlements([]);
            setRoads([]);
            setKnights([]);
          }}
        >
          Clear
        </button>
      </header>

      <div style={{ flex: 1, minHeight: 0 }}>
        <Board
          board={board}
          players={PLAYERS}
          settlements={settlements}
          roads={roads}
          knights={knights}
          highlightVertices={highlightVertices}
          highlightEdges={highlightEdges}
          vertexGhost={mode === 'city' ? 'city' : mode === 'knight' ? 'knight' : 'settlement'}
          edgeGhost={mode === 'ship' ? 'ship' : 'road'}
          onVertexTap={(vertex) => {
            if (mode === 'city') {
              setSettlements((prev) =>
                prev.map((s) =>
                  s.vertex === vertex ? { ...s, kind: 'city', wall: true } : s,
                ),
              );
            } else if (mode === 'knight') {
              setKnights((prev) => [
                ...prev,
                {
                  id: `k${prev.length}`,
                  vertex,
                  owner,
                  rank: ((prev.length % 3) + 1) as Knight['rank'],
                  active: prev.length % 2 === 0,
                  usedThisTurn: false,
                },
              ]);
            } else {
              setSettlements((prev) => [
                ...prev,
                { vertex, owner, kind: 'settlement' },
              ]);
            }
          }}
          onEdgeTap={(edge) =>
            setRoads((prev) => [
              ...prev,
              { edge, owner, kind: mode === 'ship' ? 'ship' : 'road' },
            ])
          }
        />
      </div>

      <footer
        style={{
          padding: `6px 12px max(6px, env(safe-area-inset-bottom))`,
          fontSize: 13,
          opacity: 0.75,
          background: surface('chrome'),
          borderTop: `1px solid ${surface('chrome-edge')}`,
        }}
      >
        Tap a marker to select, tap it again to place. Drag to pan, pinch to
        zoom, double-tap to fit.
      </footer>
    </main>
  );
}

const chipStyle: React.CSSProperties = {
  minHeight: 44,
  padding: '0 14px',
  borderRadius: 12,
  border: `1px solid ${surface('chrome-edge')}`,
  background: surface('chrome'),
  color: 'inherit',
  fontSize: 15,
  touchAction: 'manipulation',
};

const selectStyle: React.CSSProperties = {
  ...chipStyle,
  paddingRight: 8,
};
