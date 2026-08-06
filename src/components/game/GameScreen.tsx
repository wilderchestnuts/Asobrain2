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

import { Board } from '@/components/board/Board';
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
import type { GameAction } from '@/game/actions';
import type {
  GameState,
  ImprovementTrack,
  Player,
  Tradeable,
} from '@/game/types';
import { RESOURCES } from '@/game/types';
import { playerStyles, surface } from '@/lib/theme';

type BuildMode =
  | 'settlement'
  | 'city'
  | 'road'
  | 'ship'
  | 'knight'
  | 'wall'
  | null;

export function GameScreen({ game }: { game: UseGame }) {
  const { state, me, myPlayerId, isMyTurn, send, actionError, clearActionError } =
    game;

  const [mode, setMode] = useState<BuildMode>(null);
  const [sheet, setSheet] = useState<'trade' | 'cards' | 'log' | null>(null);
  const [discard, setDiscard] = useState<Partial<Record<Tradeable, number>>>({});

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
  useEffect(() => {
    if (!mode) return;
    const stillOffered = legal.some((a) => actionTypeFor(mode) === a.type);
    if (!stillOffered) setMode(null);
  }, [legal, mode]);

  const act = useCallback(
    async (action: ClientAction) => {
      setMode(null);
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
  const highlightHexes = hexesFor(legal, owed?.kind);

  const onVertexTap = (vertex: VertexId) => {
    const match = legal.find(
      (a) =>
        'vertex' in a &&
        a.vertex === vertex &&
        (mode ? a.type === actionTypeFor(mode) : true),
    );
    if (match) void act(stripId(match));
  };

  const onEdgeTap = (edge: EdgeId) => {
    const match = legal.find(
      (a) =>
        'edge' in a &&
        a.edge === edge &&
        (mode ? a.type === actionTypeFor(mode) : true),
    );
    if (match) void act(stripId(match));
  };

  const onHexTap = (coord: { q: number; r: number }) => {
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
      <PlayerStrip state={state} myPlayerId={myPlayerId} />

      <div style={{ flex: 1, minHeight: 0 }}>
        <Board
          board={state.board}
          players={state.players}
          settlements={state.settlements}
          roads={state.roads}
          knights={state.knights}
          highlightVertices={highlightVertices}
          highlightEdges={highlightEdges}
          highlightHexes={highlightHexes}
          vertexGhost={
            mode === 'city' ? 'city' : mode === 'knight' ? 'knight' : 'settlement'
          }
          edgeGhost={mode === 'ship' ? 'ship' : 'road'}
          onVertexTap={onVertexTap}
          onEdgeTap={onEdgeTap}
          onHexTap={onHexTap}
        />
      </div>

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
        title="The barbarians took something"
        options={legal.filter((a) => a.type === 'barbarian_loss')}
        describe={(a) =>
          a.type === 'barbarian_loss'
            ? a.knightId
              ? 'Give up a knight'
              : 'Give up a city (it becomes a settlement)'
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

      <CardsSheet
        open={sheet === 'cards'}
        onClose={() => setSheet(null)}
        me={me}
        legal={legal}
        onAct={act}
      />

      <LogSheet
        open={sheet === 'log'}
        onClose={() => setSheet(null)}
        state={state}
      />

      {state.phase === 'game_over' && (
        <WinnerOverlay state={state} myPlayerId={myPlayerId} />
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

function PlayerStrip({
  state,
  myPlayerId,
}: {
  state: GameState;
  myPlayerId: string | null;
}) {
  const styles = playerStyles(state.players);
  const ck = state.options.expansions.citiesAndKnights;

  return (
    <div
      style={{
        ...panel,
        display: 'flex',
        gap: 8,
        alignItems: 'stretch',
        // Without this the strip shrinks and its content spills out of view;
        // only the board is allowed to give up space.
        flexShrink: 0,
        padding: `max(6px, env(safe-area-inset-top)) 10px 6px`,
        borderBottom: `1px solid ${surface('chrome-edge')}`,
        overflowX: 'auto',
      }}
    >
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
              padding: '4px 10px',
              borderRadius: 10,
              minWidth: 132,
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
            {ck && p.improvements && (
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

      {ck && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '4px 10px',
            fontSize: 12,
            minWidth: 108,
          }}
        >
          <span>Barbarians</span>
          <strong style={{ fontSize: 16 }}>
            {state.barbarianPosition ?? 0} / 7
          </strong>
        </div>
      )}
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
  onOpen: (s: 'trade' | 'cards' | 'log') => void;
}) {
  const has = (t: string) => legal.some((a) => a.type === t);
  const ck = state.options.expansions.citiesAndKnights;
  const roll = state.lastRoll;

  const modes: Array<[BuildMode, string, string]> = [
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
                padding: '0 12px',
                fontSize: 15,
                opacity: 0.85,
              }}
            >
              🎲 {roll.white + roll.red}
              {roll.event && ` · ${roll.event}`}
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
              tone={mode === m ? 'primary' : 'default'}
              onClick={() => setMode(mode === m ? null : m)}
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

        {(has('buy_improvement') ||
          has('play_progress_card') ||
          has('play_dev_card') ||
          has('activate_knight') ||
          has('promote_knight') ||
          has('move_knight')) && (
          <Button onClick={() => onOpen('cards')}>Cards &amp; knights</Button>
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
          Tap a highlighted spot, then tap it again to confirm.{' '}
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
  me,
  legal,
  onAct,
}: {
  open: boolean;
  onClose: () => void;
  me: Player | null;
  legal: GameAction[];
  onAct: (a: ClientAction) => void;
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
      'Knights',
      [
        ...group('activate_knight'),
        ...group('promote_knight'),
        ...group('move_knight').slice(0, 12),
        ...group('chase_robber'),
      ],
      (a) => a.type.replace(/_/g, ' '),
    ],
    [
      'Progress cards',
      group('play_progress_card').slice(0, 30),
      (a) =>
        a.type === 'play_progress_card'
          ? `${(me?.progressCards?.find((c) => c.id === a.cardId)?.kind ?? 'card').replace(/_/g, ' ')}${
              a.choice && 'resource' in a.choice ? ` — ${a.choice.resource}` : ''
            }`
          : '',
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
    <Sheet open={open} title="Cards & knights" onClose={onClose}>
      {sections.map(([title, actions, describe]) =>
        actions.length === 0 ? null : (
          <section key={title} style={{ marginBottom: 16 }}>
            <h3 style={{ fontWeight: 600, marginBottom: 8 }}>{title}</h3>
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
      {sections.every(([, a]) => a.length === 0) && (
        <p style={{ opacity: 0.7 }}>Nothing to play right now.</p>
      )}
    </Sheet>
  );
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
          {winner?.id === myPlayerId ? 'You win' : `${winner?.name} wins`}
        </h2>
        <p style={{ opacity: 0.8, marginBottom: 16 }}>
          {winner?.victoryPoints ?? 0} + {winner?.hiddenPoints ?? 0} hidden points
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

const actionTypeFor = (mode: BuildMode): string =>
  mode === 'settlement'
    ? 'build_settlement'
    : mode === 'city'
      ? 'build_city'
      : mode === 'road'
        ? 'build_road'
        : mode === 'ship'
          ? 'build_ship'
          : mode === 'knight'
            ? 'build_knight'
            : mode === 'wall'
              ? 'build_wall'
              : '';

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

function hexesFor(legal: GameAction[], owedKind: string | undefined) {
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
