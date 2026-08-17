'use client';

/**
 * The game screen.
 *
 * It knows no rules. `legalActions` runs client-side against the redacted state
 * and tells it exactly what this player may do right now; every tap turns into
 * an action posted to the server, which is the only authority. That means the
 * screen can never disagree with the engine about what is legal, and a new rule
 * shows up here without this file changing.
 *
 * Layout is built for an iPad in landscape: the board fills the middle, a thin
 * player strip sits on top, and the hand plus action bar sit within thumb reach
 * at the bottom. Anything the rules are waiting on takes over as a sheet that
 * cannot be dismissed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Board, type Pending } from '@/components/board/Board';
import { KnightPiece } from '@/components/board/Piece';
import { DiceTray, PlaybackOverlay } from '@/components/game/Playback';
import { useTurnPlayback } from '@/hooks/useTurnPlayback';
import {
  Button,
  Card,
  CARD_LABEL,
  Sheet,
  TAP,
  Toast,
  TrackMeter,
  panel,
} from '@/components/game/parts';
import type { ClientAction, UseGame } from '@/hooks/useGame';
import { allLegalActions } from '@/game/reducer';
import { ALL_TRADEABLES, count as handCount, totalCards } from '@/game/hand';
import { discardCountFor } from '@/game/legal';
import type { EdgeId, VertexId } from '@/game/hex';
import { hexKey, parseHexKey, vertexHexes } from '@/game/hex';
import { progressTargets, type ProgressTargets } from '@/game/rules/citiesKnights';
import type { GameAction } from '@/game/actions';
import type {
  GameState,
  ImprovementTrack,
  Player,
  Tradeable,
} from '@/game/types';
import { RESOURCES } from '@/game/types';
import { cardDetail, cardTitle, TRACK_TEXT } from '@/game/cardText';
import {
  playerStyles,
  surface,
  TERRAIN_LABEL,
  TRACK_COLORS,
} from '@/lib/theme';

/**
 * What a tap on the board would currently do.
 *
 * Two of these name a *specific piece* rather than a kind of build, which is
 * why this is an object and not a bare string: moving a knight has to know
 * which knight, and playing the merchant has to know which card. Without that
 * the board could only offer the union of every knight's destinations, and a
 * tap on a shared square would be a coin toss.
 */
type BuildMode =
  | { kind: 'settlement' | 'city' | 'road' | 'ship' | 'knight' | 'wall' }
  | { kind: 'move_knight'; knightId: string }
  /**
   * A progress card mid-play. The card is *not* played until every spot it
   * asks for has been chosen and confirmed — Road Building wants two edges,
   * Inventor two hexes — so the picks accumulate here and the action is only
   * sent once the set is complete. Cancelling costs nothing; the card is still
   * in hand.
   */
  | {
      kind: 'progress';
      cardId: string;
      targets: ProgressTargets;
      picked: string[];
    }
  | null;

type BuildKind = NonNullable<BuildMode>['kind'];

/** How many spots this card still wants, and how many it wants in total. */
function aimProgress(mode: Extract<NonNullable<BuildMode>, { kind: 'progress' }>) {
  const total = 'count' in mode.targets ? mode.targets.count : 1;
  return { total, done: mode.picked.length, remaining: total - mode.picked.length };
}

/**
 * Turn the spots a player pointed at into the choice the rules expect. The
 * shape depends on the card, which is why `progressTargets` names the kind.
 */
function progressChoice(
  targets: ProgressTargets,
  picked: string[],
): NonNullable<Extract<GameAction, { type: 'play_progress_card' }>['choice']> | null {
  if (targets.kind === 'hex') {
    const hexes = picked.map(parseHexKey);
    return targets.count === 2
      ? { kind: 'pick_hexes', hexes }
      : { kind: 'pick_hex', hex: hexes[0] };
  }
  if (targets.kind === 'edge') return { kind: 'pick_edges', edges: picked };
  if (targets.kind === 'vertex') return { kind: 'pick_vertex', vertex: picked[0] };
  return null;
}

/**
 * A left rail buys vertical space on a wide screen, where the board is
 * limited by height. On a narrow phone held upright the opposite is true —
 * there the same rail steals nearly half the width — so it becomes a strip
 * across the top instead.
 */
function useWideLayout(): boolean {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const q = window.matchMedia('(min-width: 700px)');
    const sync = () => setWide(q.matches);
    sync();
    q.addEventListener('change', sync);
    return () => q.removeEventListener('change', sync);
  }, []);
  return wide;
}

export function GameScreen({ game }: { game: UseGame }) {
  const { state, me, myPlayerId, isMyTurn, send, actionError, clearActionError } =
    game;

  const [mode, setMode] = useState<BuildMode>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [sheet, setSheet] = useState<
    'trade' | 'cards' | 'progress' | 'log' | null
  >(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [discard, setDiscard] = useState<Partial<Record<Tradeable, number>>>({});
  const wide = useWideLayout();
  // Bot turns all resolve inside one request, so without this the board simply
  // jumps several turns forward with no account of what happened.
  const playback = useTurnPlayback(state?.log);

  const legal = useMemo(
    () => (state && myPlayerId ? allLegalActions(state, myPlayerId) : []),
    [state, myPlayerId],
  );

  /** What the rules are waiting on from *this* player, if anything. */
  const owed = useMemo(() => {
    if (!state || !myPlayerId) return null;
    return (
      state.pending.find(
        (t) => t.kind !== 'resume' && t.playerId === myPlayerId,
      ) ?? null
    );
  }, [state, myPlayerId]);

  // A build mode that stops being possible must not leave stale highlights.
  // Checked against the specific knight or card, not just the action type: a
  // knight that has already acted would otherwise keep the board lit up.
  useEffect(() => {
    if (!mode) return;
    if (!legal.some((a) => matchesMode(a, mode))) setMode(null);
  }, [legal, mode]);

  const act = useCallback(
    async (action: ClientAction) => {
      setMode(null);
      setPending(null);
      await send(action);
    },
    [send],
  );

  if (!state) {
    return (
      <Centered>
        <p>Loading the game…</p>
      </Centered>
    );
  }

  const styles = playerStyles(state.players);

  // --- what the board should highlight, derived from the legal moves ---
  const highlightVertices = verticesFor(legal, mode, owed?.kind);
  const highlightEdges = edgesFor(legal, mode);
  const highlightHexes = hexesFor(legal, mode, owed?.kind);

  /**
   * Record one spot for a progress card, and play it once the card has
   * everything it asked for. Until then nothing is sent — the card stays in
   * hand and cancelling is free.
   */
  const aimAt = (id: string) => {
    if (mode?.kind !== 'progress') return;
    const picked = [...mode.picked, id];
    const { total } = aimProgress(mode);
    if (picked.length < total) {
      setMode({ ...mode, picked });
      setPending(null);
      return;
    }
    const choice = progressChoice(mode.targets, picked);
    if (choice) {
      void act({ type: 'play_progress_card', cardId: mode.cardId, choice });
    }
  };

  const onVertexTap = (vertex: VertexId) => {
    if (mode?.kind === 'progress') return aimAt(vertex);
    const match = legal.find((a) =>
      mode?.kind === 'move_knight'
        ? matchesMode(a, mode) && a.type === 'move_knight' && a.to === vertex
        : 'vertex' in a &&
          a.vertex === vertex &&
          (mode ? a.type === actionTypeFor(mode) : true),
    );
    if (match) void act(stripId(match));
  };

  const onEdgeTap = (edge: EdgeId) => {
    if (mode?.kind === 'progress') return aimAt(edge);
    const match = legal.find(
      (a) =>
        'edge' in a &&
        a.edge === edge &&
        (mode ? a.type === actionTypeFor(mode) : true),
    );
    if (match) void act(stripId(match));
  };

  const onHexTap = (coord: { q: number; r: number }) => {
    if (mode?.kind === 'progress') return aimAt(hexKey(coord));
    const match = legal.find(
      (a) =>
        (a.type === 'move_robber' || a.type === 'move_pirate') &&
        a.hex.q === coord.q &&
        a.hex.r === coord.r,
    );
    if (match) void act(stripId(match));
  };

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        background: surface('board-bg'),
        color: surface('chrome-ink'),
        overflow: 'hidden',
      }}
    >
      <GameMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        state={state}
        onResign={() => void act({ type: 'resign' })}
      />

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: wide ? 'row' : 'column',
        }}
      >
        <PlayerRail
          state={state}
          myPlayerId={myPlayerId}
          onOpenMenu={() => setMenuOpen(true)}
          wide={wide}
        />
        <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        <Board
          board={state.board}
          players={state.players}
          settlements={state.settlements}
          roads={state.roads}
          knights={state.knights}
          merchant={state.merchant}
          highlightVertices={highlightVertices}
          highlightEdges={highlightEdges}
          highlightHexes={highlightHexes}
          hexLabel={
            mode?.kind === 'progress' ? 'Choose this hex' : 'Move the robber here'
          }
          vertexGhost={vertexGhostFor(mode)}
          edgeGhost={edgeGhostFor(mode)}
          onVertexTap={onVertexTap}
          onEdgeTap={onEdgeTap}
          onHexTap={onHexTap}
          onPendingChange={setPending}
          barbarianPosition={
            state.options.expansions.citiesAndKnights
              ? (state.barbarianPosition ?? 0)
              : undefined
          }
        />
        </div>
      </div>

      {/*
        Confirming by tapping a small badge on the board is hard on a phone, so
        the choice is repeated as a full-width bar within thumb reach. Both
        routes commit the same action.
      */}
      {pending && (
        <ConfirmBar
          label={describePending(pending, mode, vertexGhostFor(mode), edgeGhostFor(mode))}
          onConfirm={() => {
            if (pending.kind === 'vertex') onVertexTap(pending.id);
            else if (pending.kind === 'edge') onEdgeTap(pending.id);
            else onHexTap(pending.coord);
          }}
          onCancel={() => setPending(null)}
        />
      )}

      <BottomBar
        state={state}
        me={me}
        legal={legal}
        mode={mode}
        setMode={setMode}
        isMyTurn={isMyTurn}
        onAct={act}
        onOpen={setSheet}
      />

      {/* --- things the rules are waiting on: not dismissable --- */}
      <DiscardSheet
        state={state}
        me={me}
        open={owed?.kind === 'discard'}
        selection={discard}
        setSelection={setDiscard}
        onConfirm={() => {
          void act({ type: 'discard', hand: discard });
          setDiscard({});
        }}
      />

      <ChoiceSheet
        open={owed?.kind === 'gold'}
        title="Choose your gold"
        options={legal.filter((a) => a.type === 'choose_gold')}
        describe={(a) =>
          a.type === 'choose_gold'
            ? Object.entries(a.resources)
                .map(([r, n]) => `${n}× ${CARD_LABEL[r as Tradeable]}`)
                .join(', ')
            : ''
        }
        onPick={(a) => void act(stripId(a))}
      />

      <ChoiceSheet
        open={owed?.kind === 'steal'}
        title="Rob a player"
        options={legal.filter((a) => a.type === 'steal')}
        describe={(a) =>
          a.type === 'steal'
            ? (state.players.find((p) => p.id === a.victim)?.name ?? 'Nobody')
            : ''
        }
        onPick={(a) => void act(stripId(a))}
      />

      <ChoiceSheet
        open={owed?.kind === 'barbarian_loss'}
        title="The barbarians sacked a city"
        options={legal.filter((a) => a.type === 'barbarian_loss')}
        describe={(a) =>
          a.type === 'barbarian_loss'
            ? `The city ${describeVertex(state, a.vertex)} — it goes back to a settlement`
            : ''
        }
        onPick={(a) => void act(stripId(a))}
      />

      <ChoiceSheet
        open={owed?.kind === 'progress'}
        title="You hold too many progress cards"
        options={legal.filter((a) => a.type === 'discard_progress_card')}
        describe={(a) =>
          a.type === 'discard_progress_card'
            ? (me?.progressCards?.find((c) => c.id === a.cardId)?.kind ?? 'card')
                .replace(/_/g, ' ')
            : ''
        }
        onPick={(a) => void act(stripId(a))}
      />

      <TradeSheet
        open={sheet === 'trade'}
        onClose={() => setSheet(null)}
        state={state}
        me={me}
        legal={legal}
        onAct={act}
      />

      <ProgressSheet
        open={sheet === 'progress'}
        onClose={() => setSheet(null)}
        state={state}
        me={me}
        legal={legal}
        onAct={act}
        onAim={(next) => {
          setMode(next);
          setSheet(null);
        }}
      />

      <CardsSheet
        open={sheet === 'cards'}
        onClose={() => setSheet(null)}
        state={state}
        me={me}
        legal={legal}
        onAct={act}
        onAim={(next) => {
          setMode(next);
          setSheet(null);
        }}
      />

      <LogSheet
        open={sheet === 'log'}
        onClose={() => setSheet(null)}
        state={state}
      />

      {state.phase === 'game_over' && (
        <WinnerOverlay state={state} myPlayerId={myPlayerId} />
      )}

      {playback.current && (
        <PlaybackOverlay
          entry={playback.current}
          players={state.players}
          remaining={playback.remaining}
          onSkip={playback.skip}
        />
      )}

      {actionError && (
        <Toast message={actionError} onDismiss={clearActionError} />
      )}

      {/* My own offer, waiting on the others. */}
      {state.activeTrade && state.activeTrade.from === myPlayerId && (
        <OutgoingTrade state={state} onAct={act} />
      )}

      {/* An active trade offer aimed at me needs answering wherever I am. */}
      {state.activeTrade && state.activeTrade.from !== myPlayerId && (
        <IncomingTrade
          state={state}
          onRespond={(accept) => void act({ type: 'respond_trade', accept })}
          styles={styles}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top strip
// ---------------------------------------------------------------------------

function PlayerRail({
  state,
  myPlayerId,
  onOpenMenu,
  wide,
}: {
  state: GameState;
  myPlayerId: string | null;
  onOpenMenu: () => void;
  wide: boolean;
}) {
  const styles = playerStyles(state.players);
  const ck = state.options.expansions.citiesAndKnights;

  return (
    <div
      style={{
        ...panel,
        display: 'flex',
        flexDirection: wide ? 'column' : 'row',
        alignItems: wide ? 'stretch' : 'center',
        gap: 6,
        flexShrink: 0,
        width: wide ? 176 : undefined,
        padding: `max(6px, env(safe-area-inset-top)) 8px 6px`,
        borderRight: wide ? `1px solid ${surface('chrome-edge')}` : undefined,
        borderBottom: wide ? undefined : `1px solid ${surface('chrome-edge')}`,
        overflowY: wide ? 'auto' : undefined,
        overflowX: wide ? undefined : 'auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          order: wide ? 0 : 1,
          marginLeft: wide ? undefined : 'auto',
        }}
      >
        <Button tone="ghost" onClick={onOpenMenu}>
          ☰
        </Button>
      </div>
      {state.players.map((p) => {
        const isTurn = state.players[state.currentPlayer]?.id === p.id;
        const mine = p.id === myPlayerId;
        return (
          <div
            key={p.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              padding: '5px 8px',
              borderRadius: 10,
              border: `2px solid ${isTurn ? styles[p.id]?.base : 'transparent'}`,
              background: isTurn ? 'rgba(127,127,127,.12)' : 'transparent',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  background: styles[p.id]?.base,
                  border: `1px solid ${styles[p.id]?.ink}`,
                }}
              />
              <strong style={{ fontSize: 14 }}>
                {p.name}
                {mine && ' (you)'}
              </strong>
              <span style={{ marginLeft: 'auto', fontWeight: 700 }}>
                {/* Only my own hidden points are mine to see. */}
                {mine ? p.victoryPoints + p.hiddenPoints : p.victoryPoints}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, fontSize: 11, opacity: 0.8 }}>
              <span>
                {mine ? totalCards(p.hand) : (p.handSize ?? 0)} cards
              </span>
              {ck && (
                <span>
                  {(state.knights ?? []).filter((k) => k.owner === p.id).length}{' '}
                  knights
                </span>
              )}
              {state.longestRoad?.owner === p.id && <span>🛣 longest</span>}
              {state.largestArmy?.owner === p.id && <span>⚔ army</span>}
            </div>
            {wide && ck && p.improvements && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {(['trade', 'politics', 'science'] as ImprovementTrack[]).map(
                  (t) => (
                    <TrackMeter
                      key={t}
                      track={t}
                      level={p.improvements![t]}
                      metropolis={state.metropolises?.[t] === p.id}
                    />
                  ),
                )}
              </div>
            )}
          </div>
        );
      })}


    </div>
  );
}

// ---------------------------------------------------------------------------
// Bottom bar
// ---------------------------------------------------------------------------

function BottomBar({
  state,
  me,
  legal,
  mode,
  setMode,
  isMyTurn,
  onAct,
  onOpen,
}: {
  state: GameState;
  me: Player | null;
  legal: GameAction[];
  mode: BuildMode;
  setMode: (m: BuildMode) => void;
  isMyTurn: boolean;
  onAct: (a: ClientAction) => void;
  onOpen: (s: 'trade' | 'cards' | 'progress' | 'log') => void;
}) {
  const has = (t: string) => legal.some((a) => a.type === t);
  const ck = state.options.expansions.citiesAndKnights;
  const roll = state.lastRoll;

  const modes: Array<[BuildKind, string, string]> = [
    ['settlement', 'build_settlement', 'Settle'],
    ['city', 'build_city', 'City'],
    ['road', 'build_road', 'Road'],
    ['ship', 'build_ship', 'Ship'],
    ['knight', 'build_knight', 'Knight'],
    ['wall', 'build_wall', 'Wall'],
  ];

  return (
    <div
      style={{
        ...panel,
        borderTop: `1px solid ${surface('chrome-edge')}`,
        padding: `8px 10px max(8px, env(safe-area-inset-bottom))`,
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        gap: 8,
      }}
    >
      {/* --- my hand --- */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', overflowX: 'auto' }}>
        {ALL_TRADEABLES.filter(
          (k) => ck || (RESOURCES as readonly string[]).includes(k),
        ).map((k) => (
          <Card key={k} kind={k} count={handCount(me?.hand ?? {}, k)} small />
        ))}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {roll && (
            <span
              style={{
                minHeight: TAP,
                display: 'flex',
                alignItems: 'center',
                padding: '0 10px',
              }}
            >
              <DiceTray roll={roll} />
            </span>
          )}
          <Button onClick={() => onOpen('log')} tone="ghost">
            Log
          </Button>
        </div>
      </div>

      {/* --- actions --- */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {has('roll') && (
          <Button tone="primary" wide onClick={() => onAct({ type: 'roll' })}>
            Roll
          </Button>
        )}

        {modes.map(([m, type, label]) =>
          has(type) ? (
            <Button
              key={m}
              tone={mode?.kind === m ? 'primary' : 'default'}
              onClick={() =>
                setMode(mode?.kind === m ? null : ({ kind: m } as BuildMode))
              }
            >
              {label}
            </Button>
          ) : null,
        )}

        {has('buy_dev_card') && (
          <Button onClick={() => onAct({ type: 'buy_dev_card' })}>
            Buy card
          </Button>
        )}

        {/* Progress cards get their own tab, with the count on it. Buried in
            a shared sheet there was nothing to tell you a card had arrived. */}
        {ck && (me?.progressCards?.length ?? 0) > 0 && (
          <Button
            tone={has('play_progress_card') ? 'primary' : 'default'}
            onClick={() => onOpen('progress')}
          >
            Progress
            <span
              style={{
                marginLeft: 6,
                padding: '1px 7px',
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 700,
                background: surface('highlight-ring'),
                color: surface('board-bg'),
              }}
            >
              {me!.progressCards!.length}
            </span>
          </Button>
        )}

        {(has('buy_improvement') ||
          has('play_dev_card') ||
          has('activate_knight') ||
          has('promote_knight') ||
          has('move_knight')) && (
          <Button onClick={() => onOpen('cards')}>
            {ck ? 'Knights' : 'Cards'}
          </Button>
        )}

        {(has('bank_trade') ||
          (isMyTurn &&
            state.phase === 'main' &&
            !state.activeTrade &&
            totalCards(me?.hand ?? {}) > 0)) && (
          <Button onClick={() => onOpen('trade')}>Trade</Button>
        )}

        {has('end_turn') && (
          <Button
            tone="primary"
            wide
            style={{ marginLeft: 'auto' }}
            onClick={() => onAct({ type: 'end_turn' })}
          >
            End turn
          </Button>
        )}

        {!isMyTurn && legal.length === 0 && (
          <span style={{ opacity: 0.7, fontSize: 15, padding: '0 8px' }}>
            Waiting for {state.players[state.currentPlayer]?.name}…
          </span>
        )}
      </div>

      {mode && (
        <p style={{ fontSize: 13, opacity: 0.8 }}>
          {mode.kind === 'move_knight'
            ? 'Tap where the knight should go, then tap again to confirm.'
            : mode.kind === 'progress'
              ? aimHint(mode)
              : 'Tap a highlighted spot, then tap it again to confirm.'}{' '}
          <button
            type="button"
            onClick={() => setMode(null)}
            style={{ textDecoration: 'underline' }}
          >
            Cancel
          </button>
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

function DiscardSheet({
  state,
  me,
  open,
  selection,
  setSelection,
  onConfirm,
}: {
  state: GameState;
  me: Player | null;
  open: boolean;
  selection: Partial<Record<Tradeable, number>>;
  setSelection: (s: Partial<Record<Tradeable, number>>) => void;
  onConfirm: () => void;
}) {
  if (!open || !me) return null;
  const owed = discardCountFor(state, me.id);
  const chosen = totalCards(selection);

  return (
    <Sheet open title={`Discard ${owed} cards`} dismissable={false}>
      <p style={{ marginBottom: 12, opacity: 0.8 }}>
        You rolled into a seven. Tap cards to give up {owed}.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {ALL_TRADEABLES.map((k) => {
          const held = handCount(me.hand, k);
          if (held === 0) return null;
          const picked = selection[k] ?? 0;
          return (
            <div key={k} style={{ textAlign: 'center' }}>
              <Card
                kind={k}
                count={held - picked}
                selected={picked > 0}
                onTap={() =>
                  picked < held &&
                  chosen < owed &&
                  setSelection({ ...selection, [k]: picked + 1 })
                }
              />
              {picked > 0 && (
                <button
                  type="button"
                  onClick={() => setSelection({ ...selection, [k]: picked - 1 })}
                  style={{ fontSize: 12, marginTop: 4, textDecoration: 'underline' }}
                >
                  −{picked}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <Button tone="primary" wide disabled={chosen !== owed} onClick={onConfirm}>
        Discard {chosen} of {owed}
      </Button>
    </Sheet>
  );
}

/** A forced pick between a handful of concrete actions. */
function ChoiceSheet({
  open,
  title,
  options,
  describe,
  onPick,
}: {
  open: boolean;
  title: string;
  options: GameAction[];
  describe: (a: GameAction) => string;
  onPick: (a: GameAction) => void;
}) {
  if (!open || options.length === 0) return null;
  return (
    <Sheet open title={title} dismissable={false}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {options.slice(0, 40).map((a, i) => (
          <Button key={i} onClick={() => onPick(a)} wide>
            {describe(a) || a.type.replace(/_/g, ' ')}
          </Button>
        ))}
      </div>
    </Sheet>
  );
}

/**
 * Bank trades are a list of ready-made swaps; player trades are composed.
 *
 * The composer sends whatever the player builds rather than picking from an
 * enumeration — the server validates it anyway, and enumerating every possible
 * two-sided offer would be both enormous and useless to a human.
 */
function TradeSheet({
  open,
  onClose,
  state,
  me,
  legal,
  onAct,
}: {
  open: boolean;
  onClose: () => void;
  state: GameState;
  me: Player | null;
  legal: GameAction[];
  onAct: (a: ClientAction) => void;
}) {
  const [give, setGive] = useState<Partial<Record<Tradeable, number>>>({});
  const [want, setWant] = useState<Partial<Record<Tradeable, number>>>({});

  const bank = legal.filter((a) => a.type === 'bank_trade');
  // `offer_trade` is never enumerated by legalActions — its space is unbounded
  // — so the composer is offered on the situation instead, and the server
  // validates whatever gets built.
  const canOffer =
    state.phase === 'main' &&
    state.players[state.currentPlayer]?.id === me?.id &&
    !state.activeTrade;
  const ck = state.options.expansions.citiesAndKnights;
  const kinds = ALL_TRADEABLES.filter(
    (k) => ck || (RESOURCES as readonly string[]).includes(k),
  );

  const bump = (
    set: typeof setGive,
    current: Partial<Record<Tradeable, number>>,
    k: Tradeable,
    delta: number,
    max: number,
  ) => {
    const next = Math.max(0, Math.min(max, (current[k] ?? 0) + delta));
    set({ ...current, [k]: next });
  };

  const reset = () => {
    setGive({});
    setWant({});
  };

  return (
    <Sheet
      open={open}
      title="Trade"
      onClose={() => {
        reset();
        onClose();
      }}
    >
      <h3 style={{ fontWeight: 600, marginBottom: 8 }}>With the bank</h3>
      {bank.length === 0 ? (
        <p style={{ opacity: 0.7, marginBottom: 18 }}>
          Nothing you can afford to swap right now.
        </p>
      ) : (
        <div
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}
        >
          {bank.map((a, i) =>
            a.type === 'bank_trade' ? (
              <Button
                key={i}
                onClick={() => {
                  onAct(stripId(a));
                  onClose();
                }}
              >
                {describeHand(a.give)} → {describeHand(a.receive)}
              </Button>
            ) : null,
          )}
        </div>
      )}

      {canOffer && !state.activeTrade && (
        <>
          <h3 style={{ fontWeight: 600, marginBottom: 8 }}>
            Offer the other players
          </h3>

          <TradeRow
            label="You give"
            kinds={kinds}
            values={give}
            cap={(k) => handCount(me?.hand ?? {}, k)}
            onBump={(k, d) =>
              bump(setGive, give, k, d, handCount(me?.hand ?? {}, k))
            }
          />
          <TradeRow
            label="You want"
            kinds={kinds}
            values={want}
            cap={() => 9}
            onBump={(k, d) => bump(setWant, want, k, d, 9)}
          />

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <Button
              tone="primary"
              wide
              disabled={totalCards(give) === 0 || totalCards(want) === 0}
              onClick={() => {
                onAct({ type: 'offer_trade', give, receive: want });
                reset();
                onClose();
              }}
            >
              Send offer
            </Button>
            <Button onClick={reset}>Clear</Button>
          </div>
        </>
      )}

      {state.activeTrade && (
        <p style={{ marginTop: 16, opacity: 0.8 }}>
          There is already an offer on the table.
        </p>
      )}
    </Sheet>
  );
}

function TradeRow({
  label,
  kinds,
  values,
  cap,
  onBump,
}: {
  label: string;
  kinds: Tradeable[];
  values: Partial<Record<Tradeable, number>>;
  cap: (k: Tradeable) => number;
  onBump: (k: Tradeable, delta: number) => void;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <p style={{ fontSize: 14, opacity: 0.8, marginBottom: 6 }}>{label}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {kinds.map((k) => {
          const n = values[k] ?? 0;
          const max = cap(k);
          if (max === 0 && n === 0) return null;
          return (
            <div key={k} style={{ textAlign: 'center' }}>
              <Card kind={k} count={n} selected={n > 0} small />
              <div
                style={{ display: 'flex', gap: 2, justifyContent: 'center', marginTop: 2 }}
              >
                <button
                  type="button"
                  aria-label={`one fewer ${k}`}
                  onClick={() => onBump(k, -1)}
                  style={stepper}
                >
                  −
                </button>
                <button
                  type="button"
                  aria-label={`one more ${k}`}
                  onClick={() => onBump(k, 1)}
                  style={stepper}
                >
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const stepper: React.CSSProperties = {
  width: 22,
  height: 30,
  borderRadius: 6,
  border: `1px solid ${surface('chrome-edge')}`,
  background: surface('chrome'),
  fontSize: 15,
  lineHeight: 1,
  touchAction: 'manipulation',
};

/**
 * The offerer's side of a live trade: who has accepted, and the confirm that
 * actually completes it.
 */
function OutgoingTrade({
  state,
  onAct,
}: {
  state: GameState;
  onAct: (a: ClientAction) => void;
}) {
  const offer = state.activeTrade!;
  const accepted = offer.accepted
    .map((id) => state.players.find((p) => p.id === id))
    .filter(Boolean) as Player[];

  return (
    <div
      style={{
        ...panel,
        position: 'absolute',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: 150,
        padding: 14,
        borderRadius: 14,
        border: `1px solid ${surface('chrome-edge')}`,
        zIndex: 45,
        boxShadow: '0 8px 30px rgba(0,0,0,.3)',
        maxWidth: 520,
      }}
    >
      <p style={{ marginBottom: 10 }}>
        You offered {describeHand(offer.give)} for {describeHand(offer.receive)}
      </p>
      {accepted.length === 0 ? (
        <p style={{ opacity: 0.75, marginBottom: 10 }}>
          {offer.rejected.length > 0 ? 'Turned down so far.' : 'Waiting…'}
        </p>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          {accepted.map((p) => (
            <Button
              key={p.id}
              tone="primary"
              onClick={() => onAct({ type: 'confirm_trade', with: p.id })}
            >
              Trade with {p.name}
            </Button>
          ))}
        </div>
      )}
      <Button onClick={() => onAct({ type: 'cancel_trade' })}>
        Cancel offer
      </Button>
    </div>
  );
}

function CardsSheet({
  open,
  onClose,
  state,
  me,
  legal,
  onAct,
  onAim,
}: {
  open: boolean;
  onClose: () => void;
  state: GameState;
  me: Player | null;
  legal: GameAction[];
  onAct: (a: ClientAction) => void;
  /** Close the sheet and hand the board a target to aim at. */
  onAim: (mode: BuildMode) => void;
}) {
  const group = (type: string) => legal.filter((a) => a.type === type);
  const run = (a: GameAction) => {
    onAct(stripId(a));
    onClose();
  };

  const sections: Array<[string, GameAction[], (a: GameAction) => string]> = [
    [
      'City improvements',
      group('buy_improvement'),
      (a) => (a.type === 'buy_improvement' ? `Improve ${a.track}` : ''),
    ],
    [
      'Development cards',
      group('play_dev_card'),
      (a) =>
        a.type === 'play_dev_card'
          ? (me?.devCards.find((c) => c.id === a.cardId)?.kind ?? 'card').replace(
              /_/g,
              ' ',
            )
          : '',
    ],
  ];

  return (
    <Sheet open={open} title="Knights & improvements" onClose={onClose}>
      <KnightRoster
        state={state}
        me={me}
        legal={legal}
        onRun={run}
        onAim={onAim}
      />

      {sections.map(([title, actions, describe]) =>
        actions.length === 0 ? null : (
          <section key={title} style={{ marginBottom: 16 }}>
            <h3 style={{ fontWeight: 600, marginBottom: 8 }}>{title}</h3>
            {title === 'City improvements' && (
              <ul
                style={{
                  fontSize: 13,
                  opacity: 0.8,
                  marginBottom: 8,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                {(['trade', 'politics', 'science'] as ImprovementTrack[]).map(
                  (t) => (
                    <li key={t}>{TRACK_TEXT[t].detail}</li>
                  ),
                )}
              </ul>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {actions.map((a, i) => (
                <Button key={i} onClick={() => run(a)}>
                  {describe(a)}
                </Button>
              ))}
            </div>
          </section>
        ),
      )}
      {sections.every(([, a]) => a.length === 0) &&
        (state.knights ?? []).every((k) => k.owner !== me?.id) && (
          <p style={{ opacity: 0.7 }}>Nothing to play right now.</p>
        )}
    </Sheet>
  );
}

/**
 * Progress cards, one panel each, with what the card does written on it.
 *
 * They used to be a flat run of buttons in a shared sheet — one per possible
 * choice, so a single Resource Monopoly appeared five times over and a card
 * that wanted a board location appeared once per legal target with no way to
 * tell which was which. Worse, tapping any of them played the card
 * immediately: there was no point at which you could see what was about to
 * happen and back out.
 *
 * So: the card is the unit. Tap it, and it asks for what it needs — a
 * resource, a player, or a spot on the board — and only then is it played.
 */
function ProgressSheet({
  open,
  onClose,
  state,
  me,
  legal,
  onAct,
  onAim,
}: {
  open: boolean;
  onClose: () => void;
  state: GameState;
  me: Player | null;
  legal: GameAction[];
  onAct: (a: ClientAction) => void;
  onAim: (mode: BuildMode) => void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const cards = me?.progressCards ?? [];

  // Held cards that the rules will actually accept right now. A card with no
  // legal target is still shown, greyed, with the reason implicit in its text.
  const playable = new Set(
    legal.flatMap((a) => (a.type === 'play_progress_card' ? [a.cardId] : [])),
  );

  const play = (cardId: string, choice?: GameAction extends never ? never : unknown) => {
    onAct({
      type: 'play_progress_card',
      cardId,
      ...(choice ? { choice } : {}),
    } as ClientAction);
    setChosen(null);
    onClose();
  };

  return (
    <Sheet open={open} title="Progress cards" onClose={onClose}>
      {cards.length === 0 && (
        <p style={{ opacity: 0.7 }}>
          You hold none yet. They come from the event die, and you draw from a
          deck more often the further you have taken that improvement track.
        </p>
      )}

      <ul style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {cards.map((c) => {
          const canPlay = playable.has(c.id);
          const targets = me ? progressTargets(state, me.id, c) : { kind: 'none' as const };
          const expanded = chosen === c.id;

          return (
            <li
              key={c.id}
              style={{
                padding: '10px 12px',
                borderRadius: 12,
                border: `1px solid ${surface('chrome-edge')}`,
                borderLeft: `5px solid ${TRACK_COLORS[c.deck].light}`,
                opacity: canPlay ? 1 : 0.55,
              }}
            >
              <strong style={{ fontSize: 16 }}>{cardTitle(c.kind)}</strong>
              <p style={{ fontSize: 13, opacity: 0.85, margin: '3px 0 8px' }}>
                {cardDetail(c.kind)}
              </p>

              {!canPlay && (
                <p style={{ fontSize: 13, opacity: 0.75 }}>
                  Nothing on the board for it right now.
                </p>
              )}

              {canPlay && !expanded && (
                <Button tone="primary" onClick={() => setChosen(c.id)}>
                  {targets.kind === 'none' ? 'Play it' : 'Play it…'}
                </Button>
              )}

              {canPlay && expanded && (
                <ProgressChoices
                  state={state}
                  targets={targets}
                  onPickBoard={() => {
                    onAim({ kind: 'progress', cardId: c.id, targets, picked: [] });
                    setChosen(null);
                  }}
                  onPickHere={(choice) => play(c.id, choice)}
                  onCancel={() => setChosen(null)}
                />
              )}
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

/** The second step: what this particular card wants named. */
function ProgressChoices({
  state,
  targets,
  onPickBoard,
  onPickHere,
  onCancel,
}: {
  state: GameState;
  targets: ProgressTargets;
  onPickBoard: () => void;
  onPickHere: (choice: unknown) => void;
  onCancel: () => void;
}) {
  const row = (children: React.ReactNode) => (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {children}
      <Button tone="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );

  if (targets.kind === 'none') {
    return row(
      <Button tone="primary" onClick={() => onPickHere(undefined)}>
        Confirm
      </Button>,
    );
  }

  if (targets.kind === 'resource') {
    return row(
      targets.options.map((r) => (
        <Button
          key={r}
          onClick={() => onPickHere({ kind: 'pick_resources', resources: [r] })}
        >
          {CARD_LABEL[r]}
        </Button>
      )),
    );
  }

  if (targets.kind === 'commodity') {
    return row(
      targets.options.map((c) => (
        <Button
          key={c}
          onClick={() => onPickHere({ kind: 'trade_monopoly', commodity: c })}
        >
          {CARD_LABEL[c]}
        </Button>
      )),
    );
  }

  if (targets.kind === 'player') {
    return row(
      targets.options.map((id) => (
        <Button
          key={id}
          onClick={() => onPickHere({ kind: 'target_player', playerId: id })}
        >
          {state.players.find((p) => p.id === id)?.name ?? id}
        </Button>
      )),
    );
  }

  if (targets.kind === 'knight') {
    // Smith promotes two, so the buttons name the knights by where they stand.
    return row(
      targets.options.map((id) => {
        const k = (state.knights ?? []).find((x) => x.id === id);
        return (
          <Button
            key={id}
            onClick={() =>
              onPickHere({
                kind: 'pick_knights',
                knightIds: targets.options.slice(0, targets.count),
              })
            }
          >
            {k ? `Promote ${describeVertex(state, k.vertex)}` : id}
          </Button>
        );
      }),
    );
  }

  // Everything left is a spot on the map, so the board does the asking.
  const noun =
    targets.kind === 'hex' ? 'hex' : targets.kind === 'edge' ? 'road' : 'knight';
  const count = 'count' in targets ? targets.count : 1;
  return row(
    <Button tone="primary" onClick={onPickBoard}>
      {count > 1 ? `Choose ${count} ${noun}s on the board` : `Choose a ${noun} on the board`}
    </Button>,
  );
}

/**
 * The hint under the action bar while a card is waiting on the board. It says
 * which pick you are on, because Road Building asking twice in a row with no
 * explanation is indistinguishable from a stuck screen.
 */
function aimHint(
  mode: Extract<NonNullable<BuildMode>, { kind: 'progress' }>,
): string {
  const { total, done } = aimProgress(mode);
  const what =
    mode.targets.kind === 'hex'
      ? 'hex'
      : mode.targets.kind === 'edge'
        ? 'spot'
        : 'knight';
  return total > 1
    ? `Tap ${what} ${done + 1} of ${total}, then tap again to confirm.`
    : `Tap the ${what}, then tap it again to confirm.`;
}

/**
 * Your knights, one panel each, with that knight's own actions on it.
 *
 * They used to be a flat run of buttons reading "move knight" twelve times
 * over, which named neither the knight nor where it would end up — with more
 * than one knight on the board there was no way to say which you meant. A
 * knight is a piece in a place, so each panel says which piece and which
 * place, and moving hands the choice of square to the board.
 */
function KnightRoster({
  state,
  me,
  legal,
  onRun,
  onAim,
}: {
  state: GameState;
  me: Player | null;
  legal: GameAction[];
  onRun: (a: GameAction) => void;
  onAim: (mode: BuildMode) => void;
}) {
  const mine = (state.knights ?? []).filter((k) => k.owner === me?.id);
  if (mine.length === 0) return null;

  const style = playerStyles(state.players)[me!.id];
  const forKnight = (id: string, type: string) =>
    legal.find((a) => a.type === type && 'knightId' in a && a.knightId === id);

  return (
    <section style={{ marginBottom: 16 }}>
      <h3 style={{ fontWeight: 600, marginBottom: 8 }}>Your knights</h3>
      <ul style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {mine.map((k) => {
          const activate = forKnight(k.id, 'activate_knight');
          const promote = forKnight(k.id, 'promote_knight');
          const chase = forKnight(k.id, 'chase_robber');
          const canMove = legal.some(
            (a) => a.type === 'move_knight' && a.knightId === k.id,
          );

          return (
            <li
              key={k.id}
              style={{
                padding: '8px 10px',
                borderRadius: 10,
                border: `1px solid ${surface('chrome-edge')}`,
                borderLeft: `4px solid ${style.base}`,
                display: 'flex',
                gap: 10,
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <svg width={34} height={34} viewBox="-22 -22 44 44" aria-hidden>
                <KnightPiece
                  x={0}
                  y={0}
                  rank={k.rank}
                  active={k.active}
                  style={style}
                  size={38}
                />
              </svg>

              <div style={{ minWidth: 150, flex: 1 }}>
                <strong style={{ fontSize: 15 }}>
                  {KNIGHT_RANK[k.rank]} knight
                </strong>
                <p style={{ fontSize: 13, opacity: 0.8 }}>
                  {k.active ? 'Active' : 'Inactive'}
                  {k.usedThisTurn && ' · already acted'} ·{' '}
                  {describeVertex(state, k.vertex)}
                </p>
              </div>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {activate && (
                  <Button onClick={() => onRun(activate)}>Activate</Button>
                )}
                {promote && (
                  <Button onClick={() => onRun(promote)}>Promote</Button>
                )}
                {canMove && (
                  <Button
                    tone="primary"
                    onClick={() => onAim({ kind: 'move_knight', knightId: k.id })}
                  >
                    Move
                  </Button>
                )}
                {chase && (
                  <Button onClick={() => onRun(chase)}>Chase the robber</Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const KNIGHT_RANK: Record<number, string> = {
  1: 'Basic',
  2: 'Strong',
  3: 'Mighty',
};

/**
 * Where a vertex is, in the terms players actually use at a table: the hexes
 * and numbers it touches. A vertex id is three hex coordinates, which locates
 * it exactly and communicates nothing.
 */
function describeVertex(state: GameState, vertex: VertexId): string {
  const parts = vertexHexes(vertex)
    .map((c) => state.board.hexes.find((h) => h.coord.q === c.q && h.coord.r === c.r))
    .filter((h): h is NonNullable<typeof h> => !!h && h.terrain !== 'sea')
    .map((h) => `${TERRAIN_LABEL[h.terrain]}${h.number ? ` ${h.number}` : ''}`);
  return parts.length > 0 ? `on ${parts.join(', ')}` : 'on the coast';
}

function LogSheet({
  open,
  onClose,
  state,
}: {
  open: boolean;
  onClose: () => void;
  state: GameState;
}) {
  return (
    <Sheet open={open} title="Game log" onClose={onClose}>
      <ol style={{ display: 'flex', flexDirection: 'column-reverse', gap: 6 }}>
        {state.log.slice(-80).map((entry, i) => (
          <li key={i} style={{ fontSize: 14, opacity: 0.9 }}>
            <span style={{ opacity: 0.55 }}>turn {entry.turn} · </span>
            {entry.playerId
              ? `${state.players.find((p) => p.id === entry.playerId)?.name ?? '?'} ${entry.message}`
              : entry.message}
          </li>
        ))}
      </ol>
    </Sheet>
  );
}

function IncomingTrade({
  state,
  onRespond,
  styles,
}: {
  state: GameState;
  onRespond: (accept: boolean) => void;
  styles: Record<string, { base: string }>;
}) {
  const offer = state.activeTrade!;
  const from = state.players.find((p) => p.id === offer.from);
  return (
    <div
      style={{
        ...panel,
        position: 'absolute',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: 150,
        padding: 14,
        borderRadius: 14,
        border: `2px solid ${styles[offer.from]?.base ?? surface('chrome-edge')}`,
        zIndex: 45,
        boxShadow: '0 8px 30px rgba(0,0,0,.3)',
      }}
    >
      <p style={{ marginBottom: 10 }}>
        <strong>{from?.name}</strong> offers {describeHand(offer.give)} for{' '}
        {describeHand(offer.receive)}
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button tone="primary" onClick={() => onRespond(true)}>
          Accept
        </Button>
        <Button onClick={() => onRespond(false)}>Decline</Button>
      </div>
    </div>
  );
}

function WinnerOverlay({
  state,
  myPlayerId,
}: {
  state: GameState;
  myPlayerId: string | null;
}) {
  const winner = state.players.find((p) => p.id === state.winner);
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(0,0,0,.55)',
        zIndex: 60,
      }}
    >
      <div style={{ ...panel, padding: 28, borderRadius: 18, textAlign: 'center' }}>
        <h2 style={{ fontSize: 26, fontWeight: 700, marginBottom: 8 }}>
          {/* A game can end with nobody winning — resigning out of a game
              against bots finishes it rather than crowning one of them. */}
          {!winner
            ? 'Game over'
            : winner.id === myPlayerId
              ? 'You win'
              : `${winner.name} wins`}
        </h2>
        <p style={{ opacity: 0.8, marginBottom: 16 }}>
          {winner
            ? `${winner.victoryPoints} + ${winner.hiddenPoints} hidden points`
            : 'You resigned.'}
        </p>
        <a href="/">
          <Button tone="primary" wide>
            Back to games
          </Button>
        </a>
      </div>
    </div>
  );
}

/**
 * The confirm step, repeated where a thumb can reach it.
 *
 * Sits directly above the action bar so it never overlaps the board art the
 * player is trying to look at while deciding.
 */
function ConfirmBar({
  label,
  onConfirm,
  onCancel,
}: {
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      style={{
        ...panel,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexShrink: 0,
        padding: '8px 12px',
        borderTop: `1px solid ${surface('chrome-edge')}`,
        borderBottom: `1px solid ${surface('chrome-edge')}`,
      }}
    >
      <span style={{ fontSize: 15, flex: 1, minWidth: 0 }}>{label}</span>
      <Button tone="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button tone="primary" wide onClick={onConfirm}>
        Place here
      </Button>
    </div>
  );
}

/** Game-level actions that are not moves: leaving, resigning, house rules. */
function GameMenu({
  open,
  onClose,
  state,
  onResign,
}: {
  open: boolean;
  onClose: () => void;
  state: GameState;
  onResign: () => void;
}) {
  const [confirmResign, setConfirmResign] = useState(false);
  const link = typeof window === 'undefined' ? '' : window.location.href;

  return (
    <Sheet open={open} title="Menu" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Button wide onClick={() => void navigator.clipboard?.writeText(link)}>
          Copy the invite link
        </Button>
        <a href="/" style={{ display: 'block' }}>
          <Button wide>Back to my games</Button>
        </a>

        <hr style={{ borderColor: surface('chrome-edge'), margin: '6px 0' }} />

        <p style={{ fontSize: 13, opacity: 0.75 }}>
          Playing to {state.options.victoryPointsToWin} points ·{' '}
          {state.options.expansions.seafarers ? 'Seafarers' : 'no Seafarers'} ·{' '}
          {state.options.expansions.citiesAndKnights
            ? 'Cities & Knights'
            : 'no Cities & Knights'}
        </p>
        <p style={{ fontSize: 13, opacity: 0.75 }}>
          Board: {state.options.scenario} · seed {state.options.seed}
        </p>

        <hr style={{ borderColor: surface('chrome-edge'), margin: '6px 0' }} />

        {/*
          Resigning ends this player's game for good, so it asks twice. There is
          no "restart": a new game is a new board, which the lobby already does.
        */}
        {confirmResign ? (
          <>
            <p style={{ fontSize: 14 }}>
              Resign for good? The others carry on without you.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button tone="danger" wide onClick={onResign}>
                Yes, resign
              </Button>
              <Button onClick={() => setConfirmResign(false)}>Keep playing</Button>
            </div>
          </>
        ) : (
          <Button onClick={() => setConfirmResign(true)}>Resign</Button>
        )}
      </div>
    </Sheet>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        placeItems: 'center',
        height: '100dvh',
        background: surface('board-bg'),
        color: surface('chrome-ink'),
      }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deriving highlights from legal moves
// ---------------------------------------------------------------------------

const vertexGhostFor = (mode: BuildMode): 'settlement' | 'city' | 'knight' =>
  mode?.kind === 'city'
    ? 'city'
    : mode?.kind === 'knight' || mode?.kind === 'move_knight'
      ? 'knight'
      : 'settlement';

const edgeGhostFor = (mode: BuildMode): 'road' | 'ship' =>
  mode?.kind === 'ship' ? 'ship' : 'road';

/** Plain-language description of what confirming would do. */
function describePending(
  pending: NonNullable<Pending>,
  mode: BuildMode,
  vertexGhost: 'settlement' | 'city' | 'knight',
  edgeGhost: 'road' | 'ship',
): string {
  if (mode?.kind === 'progress') {
    const { total, done } = aimProgress(mode);
    const of = total > 1 ? ` (${done + 1} of ${total})` : '';
    return `Choose here${of}?`;
  }
  if (pending.kind === 'hex') return 'Move here?';
  if (pending.kind === 'edge') return `Build a ${edgeGhost} here?`;
  if (mode?.kind === 'move_knight') return 'Move the knight here?';
  if (mode?.kind === 'wall') return 'Build a city wall here?';
  return `Build a ${vertexGhost} here?`;
}

const ACTION_TYPE: Record<BuildKind, string> = {
  settlement: 'build_settlement',
  city: 'build_city',
  road: 'build_road',
  ship: 'build_ship',
  knight: 'build_knight',
  wall: 'build_wall',
  move_knight: 'move_knight',
  progress: 'play_progress_card',
};

const actionTypeFor = (mode: BuildMode): string =>
  mode ? ACTION_TYPE[mode.kind] : '';

/** Whether this legal action is the one the current mode is aiming at. */
function matchesMode(a: GameAction, mode: NonNullable<BuildMode>): boolean {
  if (a.type !== ACTION_TYPE[mode.kind]) return false;
  if (mode.kind === 'move_knight') {
    return a.type === 'move_knight' && a.knightId === mode.knightId;
  }
  if (mode.kind === 'progress') {
    return a.type === 'play_progress_card' && a.cardId === mode.cardId;
  }
  return true;
}

/**
 * During setup there is exactly one thing to do, so the spots are shown without
 * the player having to choose a build mode first — one less tap in the part of
 * the game where the mode picker would be pure friction.
 */
function verticesFor(
  legal: GameAction[],
  mode: BuildMode,
  owedKind: string | undefined,
): VertexId[] {
  if (owedKind && owedKind !== 'resume') return [];

  // A knight's destination is `to`, not `vertex`, and only one knight's
  // squares may be shown at a time or a shared square is ambiguous.
  if (mode?.kind === 'move_knight') {
    return legal
      .filter((a): a is Extract<GameAction, { type: 'move_knight' }> =>
        matchesMode(a, mode),
      )
      .map((a) => a.to);
  }
  // A progress card asks for its own spots, which the rules name directly
  // rather than the board guessing them from enumerated actions.
  if (mode?.kind === 'progress') {
    return mode.targets.kind === 'vertex'
      ? mode.targets.options.filter((v) => !mode.picked.includes(v))
      : [];
  }

  const wanted = mode
    ? [actionTypeFor(mode)]
    : ['build_settlement', 'build_city', 'build_knight', 'build_wall'];

  const auto = !mode;
  const out = new Set<VertexId>();
  for (const a of legal) {
    if (!('vertex' in a)) continue;
    if (!wanted.includes(a.type)) continue;
    // Without a mode chosen, only offer settlements — otherwise a tap would be
    // ambiguous between building a city and posting a knight on the same spot.
    if (auto && a.type !== 'build_settlement') continue;
    // `barbarian_loss` carries an optional vertex, so this is not guaranteed.
    if (a.vertex) out.add(a.vertex);
  }
  return [...out];
}

function edgesFor(legal: GameAction[], mode: BuildMode): EdgeId[] {
  if (mode?.kind === 'progress') {
    return mode.targets.kind === 'edge'
      ? mode.targets.options.filter((e) => !mode.picked.includes(e))
      : [];
  }
  if (mode && mode.kind !== 'road' && mode.kind !== 'ship') return [];
  const wanted = mode ? [actionTypeFor(mode)] : ['build_road', 'build_ship'];
  const auto = !mode;
  const out = new Set<EdgeId>();
  for (const a of legal) {
    if (!('edge' in a)) continue;
    if (!wanted.includes(a.type)) continue;
    if (auto && a.type !== 'build_road') continue;
    out.add(a.edge);
  }
  return [...out];
}

function hexesFor(
  legal: GameAction[],
  mode: BuildMode,
  owedKind: string | undefined,
): { q: number; r: number }[] {
  // Playing a card is something the player chose to start, so it takes
  // precedence over — and cannot collide with — the robber's turn.
  if (mode?.kind === 'progress') {
    return mode.targets.kind === 'hex'
      ? mode.targets.options.filter((h) => !mode.picked.includes(hexKey(h)))
      : [];
  }
  if (owedKind !== 'robber' && owedKind !== 'pirate') return [];
  return legal
    .filter((a) => a.type === 'move_robber' || a.type === 'move_pirate')
    .map((a) => (a as { hex: { q: number; r: number } }).hex);
}

/** Actions travel without a playerId; the server fills it from the session. */
function stripId(action: GameAction): ClientAction {
  const { playerId: _ignored, ...rest } = action;
  return rest as ClientAction;
}

const describeHand = (hand: Partial<Record<Tradeable, number>>): string =>
  Object.entries(hand)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([k, n]) => `${n}× ${CARD_LABEL[k as Tradeable]}`)
    .join(', ') || 'nothing';
