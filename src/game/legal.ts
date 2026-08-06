/**
 * Rule predicates: "is this legal right now, and if not, why not?"
 *
 * Every check comes in two flavours — `xxxError` returns a human-readable
 * reason or `null`, and `canXxx` is the boolean sugar on top. The reducer wants
 * the message, the UI and the bots want the boolean, and having one
 * implementation means the two can never disagree.
 *
 * This module is deliberately a *leaf*: it imports no rules module, so
 * `rules/base.ts` can depend on it without an import cycle. `legalActions`
 * therefore takes the rules modules as an argument; `reducer.ts` exports
 * `allLegalActions`, which supplies the enabled ones.
 */

import type { GameAction } from './actions';
import type { RulesModule } from './engine';
import type { EdgeId, HexCoord, VertexId } from './hex';
import {
  adjacentVertices,
  edgeVertices,
  hexEquals,
  hexKey,
  hexVertices,
  vertexEdges,
} from './hex';
import { ALL_TRADEABLES, canAfford, count, totalCards } from './hand';
import type {
  DevCard,
  GameState,
  Hand,
  Phase,
  Player,
  PlayerId,
  Resource,
  RoadPiece,
  Settlement,
  Tradeable,
} from './types';
import {
  COMMODITY_FOR_TERRAIN,
  COSTS,
  PRODUCING_TERRAINS,
  RESOURCES,
  RESOURCE_FOR_TERRAIN,
} from './types';

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export const playerById = (
  state: GameState,
  id: PlayerId,
): Player | undefined => state.players.find((p) => p.id === id);

export const currentPlayerOf = (state: GameState): Player | undefined =>
  state.players[state.currentPlayer];

export const isCurrentPlayer = (state: GameState, id: PlayerId): boolean =>
  currentPlayerOf(state)?.id === id;

export const settlementAt = (
  state: GameState,
  vertex: VertexId,
): Settlement | undefined => state.settlements.find((s) => s.vertex === vertex);

export const pieceAt = (
  state: GameState,
  edge: EdgeId,
): RoadPiece | undefined => state.roads.find((r) => r.edge === edge);

export const hexAt = (state: GameState, coord: HexCoord) =>
  state.board.hexes.find((h) => hexEquals(h.coord, coord));

export const isResource = (t: Tradeable): t is Resource =>
  (RESOURCES as readonly string[]).includes(t);

/** Total victory points, including the ones opponents cannot see. */
export const truePoints = (p: Player): number =>
  p.victoryPoints + p.hiddenPoints;

// ---------------------------------------------------------------------------
// The bank
// ---------------------------------------------------------------------------

/** Physical card count in a real Catan box. */
export const BANK_STOCK_PER_RESOURCE = 19;
/** Cities & Knights ships fewer of each commodity than of each resource. */
export const BANK_STOCK_PER_COMMODITY = 12;

export const stockLimitFor = (what: Tradeable): number =>
  isResource(what) ? BANK_STOCK_PER_RESOURCE : BANK_STOCK_PER_COMMODITY;

/**
 * How many of a resource the bank still holds. Derived rather than stored:
 * every card is either in the bank or in someone's hand, so there is nothing
 * to keep in sync.
 */
export function bankStock(state: GameState, resource: Tradeable): number {
  const held = state.players.reduce((sum, p) => sum + count(p.hand, resource), 0);
  return stockLimitFor(resource) - held;
}

/**
 * Best exchange rate per resource, given the ports this player has built on.
 * 4:1 by default, 3:1 on a generic port, 2:1 on the matching resource port.
 */
export function portRatios(
  state: GameState,
  playerId: PlayerId,
): Record<Resource, number> {
  const ratios = Object.fromEntries(RESOURCES.map((r) => [r, 4])) as Record<
    Resource,
    number
  >;
  const mine = new Set(
    state.settlements.filter((s) => s.owner === playerId).map((s) => s.vertex),
  );
  for (const port of state.board.ports) {
    if (!port.vertices.some((v) => mine.has(v))) continue;
    if (port.kind === 'any') {
      for (const r of RESOURCES) ratios[r] = Math.min(ratios[r], 3);
    } else {
      ratios[port.kind] = Math.min(ratios[port.kind], port.ratio);
    }
  }
  return ratios;
}

// ---------------------------------------------------------------------------
// Hand limit on a 7
// ---------------------------------------------------------------------------

/**
 * The hand size above which this player must discard. City walls (C&K) raise
 * it by two each, which is why this lives here rather than in the base rules.
 */
export function discardLimitFor(state: GameState, playerId: PlayerId): number {
  const walls = state.settlements.filter(
    (s) => s.owner === playerId && s.wall,
  ).length;
  return state.options.handLimit + walls * 2;
}

export function discardCountFor(state: GameState, playerId: PlayerId): number {
  const p = playerById(state, playerId);
  if (!p) return 0;
  const total = totalCards(p.hand);
  return total > discardLimitFor(state, playerId) ? Math.floor(total / 2) : 0;
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

export const isSetupPhase = (phase: Phase): boolean =>
  phase === 'setup_first' || phase === 'setup_second';

/** During setup, whether this player owes a settlement or the road after it. */
export function setupNeeds(
  state: GameState,
  playerId: PlayerId,
): 'settlement' | 'road' | null {
  if (!isSetupPhase(state.phase)) return null;
  const settlements = state.settlements.filter(
    (s) => s.owner === playerId,
  ).length;
  const roads = state.roads.filter((r) => r.owner === playerId).length;
  return settlements === roads ? 'settlement' : 'road';
}

/**
 * The settlement a setup road must touch: the most recent one, identified as
 * the player's only settlement with no road of their own attached yet.
 */
export function setupRoadAnchor(
  state: GameState,
  playerId: PlayerId,
): VertexId | null {
  for (const s of state.settlements) {
    if (s.owner !== playerId) continue;
    const edges = vertexEdges(s.vertex);
    const attached = state.roads.some(
      (r) => r.owner === playerId && edges.includes(r.edge),
    );
    if (!attached) return s.vertex;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

/** The distance rule: no settlement may touch another across a single edge. */
export function violatesDistanceRule(
  state: GameState,
  vertex: VertexId,
): boolean {
  return adjacentVertices(vertex).some((v) => settlementAt(state, v));
}

export function settlementError(
  state: GameState,
  playerId: PlayerId,
  vertex: VertexId,
): string | null {
  const p = playerById(state, playerId);
  if (!p) return 'no such player';
  const setup = isSetupPhase(state.phase);

  if (!setup && state.phase !== 'main') return 'you cannot build right now';
  if (!isCurrentPlayer(state, playerId)) return 'it is not your turn';
  if (setup && setupNeeds(state, playerId) !== 'settlement') {
    return 'you must place your road first';
  }
  if (!state.board.landVertices.includes(vertex)) {
    return 'you cannot build there';
  }
  if (settlementAt(state, vertex)) return 'that spot is taken';
  if (violatesDistanceRule(state, vertex)) {
    return 'too close to another settlement';
  }
  if (p.supply.settlements <= 0) return 'no settlements left';
  if (!setup) {
    if (!touchesOwnNetwork(state, playerId, vertex)) {
      return 'that spot is not connected to your roads';
    }
    if (!canAfford(p.hand, COSTS.settlement)) {
      return 'you cannot afford a settlement';
    }
  }
  return null;
}

export const canBuildSettlement = (
  state: GameState,
  playerId: PlayerId,
  vertex: VertexId,
): boolean => settlementError(state, playerId, vertex) === null;

/** True when the player owns a road or ship touching this vertex. */
export function touchesOwnNetwork(
  state: GameState,
  playerId: PlayerId,
  vertex: VertexId,
): boolean {
  const edges = vertexEdges(vertex);
  return state.roads.some((r) => r.owner === playerId && edges.includes(r.edge));
}

export function cityError(
  state: GameState,
  playerId: PlayerId,
  vertex: VertexId,
): string | null {
  const p = playerById(state, playerId);
  if (!p) return 'no such player';
  if (state.phase !== 'main') return 'you cannot build right now';
  if (!isCurrentPlayer(state, playerId)) return 'it is not your turn';
  const s = settlementAt(state, vertex);
  if (!s || s.owner !== playerId) return 'you have no settlement there';
  if (s.kind !== 'settlement') return 'that is already a city';
  if (p.supply.cities <= 0) return 'no cities left';
  if (!canAfford(p.hand, COSTS.city)) return 'you cannot afford a city';
  return null;
}

export const canBuildCity = (
  state: GameState,
  playerId: PlayerId,
  vertex: VertexId,
): boolean => cityError(state, playerId, vertex) === null;

/**
 * A route may start from a settlement/city of yours, or extend one of your own
 * pieces — but not *through* a vertex an opponent has built on.
 *
 * `kind` matters once Seafarers is on: a road continues a road and a ship
 * continues a ship, and the two only ever join at a settlement or city you own.
 * With Seafarers off every piece is a road, so the filter is a no-op.
 */
export function roadConnects(
  state: GameState,
  playerId: PlayerId,
  edge: EdgeId,
  kind: RoadPiece['kind'] = 'road',
): boolean {
  for (const v of edgeVertices(edge)) {
    const building = settlementAt(state, v);
    if (building) {
      if (building.owner === playerId) return true;
      continue; // an opponent's building blocks the junction
    }
    const incident = vertexEdges(v);
    const linked = state.roads.some(
      (r) =>
        r.owner === playerId &&
        r.kind === kind &&
        r.edge !== edge &&
        incident.includes(r.edge),
    );
    if (linked) return true;
  }
  return false;
}

/**
 * `ignorePhase` is for cards that build roads outside the build step — Road
 * Building may be played before the dice, so the phase gate has to lift.
 */
export function roadError(
  state: GameState,
  playerId: PlayerId,
  edge: EdgeId,
  opts: { free?: boolean; ignorePhase?: boolean; kind?: RoadPiece['kind'] } = {},
): string | null {
  const p = playerById(state, playerId);
  if (!p) return 'no such player';
  const kind = opts.kind ?? 'road';
  const ship = kind === 'ship';
  const noun = ship ? 'ship' : 'road';

  const setup = !opts.ignorePhase && isSetupPhase(state.phase);
  if (!opts.ignorePhase) {
    if (!setup && state.phase !== 'main') return 'you cannot build right now';
  }
  if (!isCurrentPlayer(state, playerId)) return 'it is not your turn';
  if (setup && setupNeeds(state, playerId) !== 'road') {
    return 'place your settlement first';
  }

  const buildable = ship ? state.board.shipEdges : state.board.roadEdges;
  if (!buildable.includes(edge)) return `you cannot build a ${noun} there`;
  if (pieceAt(state, edge)) return 'that edge is taken';
  if ((ship ? p.supply.ships : p.supply.roads) <= 0) return `no ${noun}s left`;

  if (setup) {
    const anchor = setupRoadAnchor(state, playerId);
    if (!anchor || !vertexEdges(anchor).includes(edge)) {
      return `your ${noun} must touch the settlement you just placed`;
    }
    return null;
  }
  if (!roadConnects(state, playerId, edge, kind)) {
    return 'that edge does not connect to your network';
  }
  if (!opts.free && !canAfford(p.hand, ship ? COSTS.ship : COSTS.road)) {
    return `you cannot afford a ${noun}`;
  }
  return null;
}

export const canBuildShip = (
  state: GameState,
  playerId: PlayerId,
  edge: EdgeId,
): boolean => roadError(state, playerId, edge, { kind: 'ship' }) === null;

export const canBuildRoad = (
  state: GameState,
  playerId: PlayerId,
  edge: EdgeId,
): boolean => roadError(state, playerId, edge) === null;

// ---------------------------------------------------------------------------
// Development cards
// ---------------------------------------------------------------------------

export function buyDevCardError(
  state: GameState,
  playerId: PlayerId,
): string | null {
  const p = playerById(state, playerId);
  if (!p) return 'no such player';
  if (state.phase !== 'main') return 'you cannot buy right now';
  if (!isCurrentPlayer(state, playerId)) return 'it is not your turn';
  if (state.devDeck.length === 0) return 'the development deck is empty';
  if (!canAfford(p.hand, COSTS.devCard)) return 'you cannot afford that';
  return null;
}

export const canBuyDevCard = (state: GameState, playerId: PlayerId): boolean =>
  buyDevCardError(state, playerId) === null;

/** Cards this player could legally play this instant, ignoring the choice. */
export function playableDevCards(
  state: GameState,
  playerId: PlayerId,
): DevCard[] {
  const p = playerById(state, playerId);
  if (!p) return [];
  if (playDevCardError(state, playerId, null) !== null) return [];
  return p.devCards.filter(
    (c) =>
      !c.played &&
      c.kind !== 'victory_point' &&
      c.boughtOnTurn !== state.turn,
  );
}

/**
 * Timing checks that do not depend on which card it is. Pass `cardId: null` to
 * ask only "could I play *any* card now?".
 */
export function playDevCardError(
  state: GameState,
  playerId: PlayerId,
  cardId: string | null,
): string | null {
  const p = playerById(state, playerId);
  if (!p) return 'no such player';
  if (state.phase !== 'main' && state.phase !== 'roll') {
    return 'you cannot play a card right now';
  }
  if (!isCurrentPlayer(state, playerId)) return 'it is not your turn';
  if (state.devCardPlayedThisTurn) {
    return 'you have already played a development card this turn';
  }
  if (cardId === null) return null;
  const card = p.devCards.find((c) => c.id === cardId);
  if (!card) return 'you do not hold that card';
  if (card.played) return 'that card has already been played';
  if (card.kind === 'victory_point') {
    return 'victory point cards are not played, they simply count';
  }
  if (card.boughtOnTurn === state.turn) {
    return 'you cannot play a card the turn you bought it';
  }
  return null;
}

export const canPlayDevCard = (
  state: GameState,
  playerId: PlayerId,
  cardId: string,
): boolean => playDevCardError(state, playerId, cardId) === null;

// ---------------------------------------------------------------------------
// Trading
// ---------------------------------------------------------------------------

export function bankTradeError(
  state: GameState,
  playerId: PlayerId,
  give: Hand,
  receive: Hand,
): string | null {
  const p = playerById(state, playerId);
  if (!p) return 'no such player';
  if (state.phase !== 'main') return 'you cannot trade right now';
  if (!isCurrentPlayer(state, playerId)) return 'it is not your turn';
  if (!canAfford(p.hand, give)) return 'you do not have those cards';

  const ratios = portRatios(state, playerId);
  let credits = 0;
  for (const k of ALL_TRADEABLES) {
    const n = count(give, k);
    if (!n) continue;
    if (!isResource(k)) return 'the bank does not trade commodities';
    if (n % ratios[k] !== 0) return `you must give ${ratios[k]} ${k} at a time`;
    credits += n / ratios[k];
  }
  if (credits === 0) return 'you must offer something';

  let wanted = 0;
  for (const k of ALL_TRADEABLES) {
    const n = count(receive, k);
    if (!n) continue;
    if (!isResource(k)) return 'the bank does not trade commodities';
    if (count(give, k)) return 'you cannot trade a resource for itself';
    wanted += n;
  }
  if (wanted !== credits) {
    return `that trade is worth ${credits}, but you asked for ${wanted}`;
  }
  for (const r of RESOURCES) {
    if (count(receive, r) > bankStock(state, r)) {
      return `the bank is out of ${r}`;
    }
  }
  return null;
}

export const canBankTrade = (
  state: GameState,
  playerId: PlayerId,
  give: Hand,
  receive: Hand,
): boolean => bankTradeError(state, playerId, give, receive) === null;

/** Everyone who may still answer the offer on the table. */
export function tradeResponders(state: GameState): PlayerId[] {
  const offer = state.activeTrade;
  if (!offer) return [];
  const invited =
    offer.to.length > 0
      ? offer.to
      : state.players.filter((p) => p.id !== offer.from).map((p) => p.id);
  return invited.filter(
    (id) => !offer.accepted.includes(id) && !offer.rejected.includes(id),
  );
}

// ---------------------------------------------------------------------------
// Robber
// ---------------------------------------------------------------------------

/** Land hexes the robber may be moved to — anywhere but where it already is. */
export function legalRobberHexes(state: GameState): HexCoord[] {
  return state.board.hexes
    .filter((h) => h.terrain !== 'sea' && !hexEquals(h.coord, state.board.robber))
    .map((h) => h.coord);
}

/**
 * Who the current player may steal from after moving the robber: opponents
 * with a building on the hex and at least one card. The friendly-robber option
 * spares anyone still on two points or fewer.
 */
export function robberVictims(
  state: GameState,
  hex: HexCoord,
  thiefId: PlayerId,
): PlayerId[] {
  const corners = new Set(hexVertices(hex));
  const out: PlayerId[] = [];
  for (const s of state.settlements) {
    if (!corners.has(s.vertex)) continue;
    if (s.owner === thiefId || out.includes(s.owner)) continue;
    const victim = playerById(state, s.owner);
    if (!victim || totalCards(victim.hand) === 0) continue;
    if (state.options.friendlyRobber && truePoints(victim) <= 2) continue;
    out.push(s.owner);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pending work
// ---------------------------------------------------------------------------

export const pendingFor = (state: GameState, playerId: PlayerId) =>
  state.pending.filter((p) => p.playerId === playerId && p.kind !== 'resume');

export const nextPending = (state: GameState) =>
  state.pending.find((p) => p.kind !== 'resume');

/**
 * A deterministic "just get rid of them" discard, so a bot always has a legal
 * move. Trims the biggest stacks first, breaking ties by resource order.
 */
export function suggestedDiscard(hand: Hand, n: number): Hand {
  const remaining: Hand = { ...hand };
  const out: Hand = {};
  for (let i = 0; i < n; i++) {
    let best: Tradeable | null = null;
    for (const k of ALL_TRADEABLES) {
      if (count(remaining, k) === 0) continue;
      if (best === null || count(remaining, k) > count(remaining, best)) best = k;
    }
    if (best === null) break;
    remaining[best] = count(remaining, best) - 1;
    out[best] = count(out, best) + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Enumerating legal actions
// ---------------------------------------------------------------------------

const combinationsWithRepeats = <T,>(items: readonly T[], k: number): T[][] => {
  if (k <= 0) return [[]];
  const out: T[][] = [];
  const walk = (start: number, acc: T[]) => {
    if (acc.length === k) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i < items.length; i++) {
      acc.push(items[i]);
      walk(i, acc);
      acc.pop();
    }
  };
  walk(0, []);
  return out;
};

/** Cap on how many gold-choice / road-building permutations we enumerate. */
const ENUMERATION_CAP = 200;

/**
 * Everything `playerId` may legally do right now.
 *
 * Two families are deliberately left out because their space is unbounded and
 * a bot is better placed to construct them: `offer_trade` and `resign`.
 * `discard` is represented by a single suggested split rather than every
 * combination.
 */
export function legalActions(
  state: GameState,
  playerId: PlayerId,
  modules: readonly RulesModule[] = [],
): GameAction[] {
  const out: GameAction[] = [];
  const p = playerById(state, playerId);
  if (!p || state.phase === 'game_over' || p.resigned) return out;
  const me = { playerId };

  // --- things that can be owed while it is someone else's turn ---
  for (const task of pendingFor(state, playerId)) {
    if (task.kind === 'discard' && state.phase === 'discard') {
      const n = Number(task.data?.count ?? 0);
      out.push({ ...me, type: 'discard', hand: suggestedDiscard(p.hand, n) });
    }
    if (task.kind === 'gold' && state.phase === 'choose_gold') {
      const n = Number(task.data?.count ?? 0);
      const affordable = RESOURCES.filter((r) => bankStock(state, r) > 0);
      for (const combo of combinationsWithRepeats(affordable, n).slice(
        0,
        ENUMERATION_CAP,
      )) {
        const resources: Partial<Record<Resource, number>> = {};
        for (const r of combo) resources[r] = (resources[r] ?? 0) + 1;
        if (RESOURCES.some((r) => (resources[r] ?? 0) > bankStock(state, r))) {
          continue;
        }
        out.push({ ...me, type: 'choose_gold', resources });
      }
    }
  }

  if (state.phase === 'trade_response' && state.activeTrade) {
    const offer = state.activeTrade;
    if (offer.from === playerId) {
      out.push({ ...me, type: 'cancel_trade' });
      for (const other of offer.accepted) {
        out.push({ ...me, type: 'confirm_trade', with: other });
      }
    } else if (tradeResponders(state).includes(playerId)) {
      out.push({ ...me, type: 'respond_trade', accept: true });
      out.push({ ...me, type: 'respond_trade', accept: false });
    }
  }

  if (isCurrentPlayer(state, playerId)) {
    switch (state.phase) {
      case 'setup_first':
      case 'setup_second': {
        if (setupNeeds(state, playerId) === 'settlement') {
          for (const v of state.board.landVertices) {
            if (canBuildSettlement(state, playerId, v)) {
              out.push({ ...me, type: 'build_settlement', vertex: v });
            }
          }
        } else {
          for (const e of state.board.roadEdges) {
            if (canBuildRoad(state, playerId, e)) {
              out.push({ ...me, type: 'build_road', edge: e });
            }
          }
        }
        break;
      }
      case 'roll': {
        out.push({ ...me, type: 'roll' });
        out.push(...devCardActions(state, playerId));
        break;
      }
      case 'main': {
        out.push({ ...me, type: 'end_turn' });
        for (const v of state.board.landVertices) {
          if (canBuildSettlement(state, playerId, v)) {
            out.push({ ...me, type: 'build_settlement', vertex: v });
          }
          if (canBuildCity(state, playerId, v)) {
            out.push({ ...me, type: 'build_city', vertex: v });
          }
        }
        for (const e of state.board.roadEdges) {
          if (canBuildRoad(state, playerId, e)) {
            out.push({ ...me, type: 'build_road', edge: e });
          }
        }
        if (canBuyDevCard(state, playerId)) {
          out.push({ ...me, type: 'buy_dev_card' });
        }
        out.push(...devCardActions(state, playerId));
        out.push(...bankTradeActions(state, playerId));
        break;
      }
      // The phase says *something* is owed, but not necessarily by the player
      // asking. Both of these are offered only to whoever actually owes them —
      // otherwise a bystander is handed a move the reducer will refuse.
      case 'move_robber': {
        const owed = state.pending.some(
          (t) => t.kind === 'robber' && t.playerId === playerId,
        );
        if (!owed) break;
        for (const hex of legalRobberHexes(state)) {
          out.push({ ...me, type: 'move_robber', hex });
        }
        break;
      }
      case 'steal': {
        const task = state.pending.find(
          (t) => t.kind === 'steal' && t.playerId === playerId,
        );
        if (!task) break;
        const victims = (task.data?.victims as PlayerId[] | undefined) ?? [];
        if (victims.length === 0) {
          out.push({ ...me, type: 'steal', victim: null });
        }
        for (const v of victims) out.push({ ...me, type: 'steal', victim: v });
        break;
      }
      default:
        break;
    }
  }

  for (const m of modules) {
    if (m.enabled(state) && m.legalActions) {
      out.push(...m.legalActions(state, playerId));
    }
  }
  return out;
}

function devCardActions(state: GameState, playerId: PlayerId): GameAction[] {
  const out: GameAction[] = [];
  const me = { playerId };
  for (const card of playableDevCards(state, playerId)) {
    switch (card.kind) {
      case 'knight':
        out.push({ ...me, type: 'play_dev_card', cardId: card.id });
        break;
      case 'monopoly':
        for (const r of RESOURCES) {
          out.push({
            ...me,
            type: 'play_dev_card',
            cardId: card.id,
            choice: { kind: 'monopoly', resource: r },
          });
        }
        break;
      case 'year_of_plenty':
        for (const pair of combinationsWithRepeats(RESOURCES, 2)) {
          if (pair.some((r) => bankStock(state, r) < (pair[0] === pair[1] ? 2 : 1))) {
            continue;
          }
          out.push({
            ...me,
            type: 'play_dev_card',
            cardId: card.id,
            choice: { kind: 'year_of_plenty', resources: [...pair] },
          });
        }
        break;
      case 'road_building':
        out.push(...roadBuildingActions(state, playerId, card.id));
        break;
      default:
        break;
    }
  }
  return out;
}

/**
 * Road Building needs a pair of edges up front. The second edge may only be
 * reachable once the first is down, so candidates include edges adjacent to
 * the first one; the reducer re-validates properly.
 */
function roadBuildingActions(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
): GameAction[] {
  const me = { playerId };
  const first = state.board.roadEdges.filter(
    (e) =>
      roadError(state, playerId, e, { free: true, ignorePhase: true }) === null,
  );
  const out: GameAction[] = [];
  const supply = playerById(state, playerId)?.supply.roads ?? 0;
  if (first.length === 0) return out;
  if (supply <= 1) {
    for (const e of first) {
      out.push({
        ...me,
        type: 'play_dev_card',
        cardId,
        choice: { kind: 'road_building', edges: [e] },
      });
    }
    return out;
  }
  const seen = new Set<string>();
  for (const a of first) {
    const followers = new Set<EdgeId>(first);
    for (const v of edgeVertices(a)) {
      for (const e of vertexEdges(v)) {
        if (state.board.roadEdges.includes(e) && !pieceAt(state, e)) {
          followers.add(e);
        }
      }
    }
    followers.delete(a);
    for (const b of followers) {
      const key = [a, b].sort().join('>');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        ...me,
        type: 'play_dev_card',
        cardId,
        choice: { kind: 'road_building', edges: [a, b] },
      });
      if (out.length >= ENUMERATION_CAP) return out;
    }
  }
  return out;
}

function bankTradeActions(
  state: GameState,
  playerId: PlayerId,
): GameAction[] {
  const p = playerById(state, playerId);
  if (!p) return [];
  const ratios = portRatios(state, playerId);
  const out: GameAction[] = [];
  for (const give of RESOURCES) {
    const n = ratios[give];
    if (count(p.hand, give) < n) continue;
    for (const want of RESOURCES) {
      if (want === give || bankStock(state, want) < 1) continue;
      out.push({
        playerId,
        type: 'bank_trade',
        give: { [give]: n },
        receive: { [want]: 1 },
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Production
// ---------------------------------------------------------------------------

export interface Production {
  /** What each player is owed, before the bank-shortage rule is applied. */
  owed: Record<PlayerId, Hand>;
  /** How many free-choice picks each player gets from gold hexes. */
  goldPicks: Record<PlayerId, number>;
}

/**
 * What a dice roll produces, ignoring bank stock. Kept here so the bots can
 * evaluate a spot without simulating a whole turn.
 */
export function productionFor(state: GameState, roll: number): Production {
  const ck = state.options.expansions.citiesAndKnights;
  const owed: Record<PlayerId, Hand> = {};
  const goldPicks: Record<PlayerId, number> = {};
  const byVertex = new Map<VertexId, Settlement>();
  for (const s of state.settlements) byVertex.set(s.vertex, s);

  for (const hex of state.board.hexes) {
    if (hex.number !== roll) continue;
    if (!PRODUCING_TERRAINS.includes(hex.terrain)) continue;
    if (hexEquals(hex.coord, state.board.robber)) continue;
    const resource = RESOURCE_FOR_TERRAIN[hex.terrain];
    const commodity = ck ? COMMODITY_FOR_TERRAIN[hex.terrain] : undefined;

    for (const v of hexVertices(hex.coord)) {
      const s = byVertex.get(v);
      if (!s) continue;
      const city = s.kind === 'city';
      const yield_ = city ? 2 : 1;

      if (hex.terrain === 'gold') {
        // Gold pays resources only — never commodities, even under C&K.
        goldPicks[s.owner] = (goldPicks[s.owner] ?? 0) + yield_;
        continue;
      }
      if (!resource) continue;

      const hand = owed[s.owner] ?? (owed[s.owner] = {});
      if (city && commodity) {
        // A C&K city on mountains, forest or pasture takes one resource and
        // one commodity rather than doubling up on the resource.
        hand[resource] = count(hand, resource) + 1;
        hand[commodity] = count(hand, commodity) + 1;
      } else {
        hand[resource] = count(hand, resource) + yield_;
      }
    }
  }
  return { owed, goldPicks };
}

/** Hex keys touched by a player's buildings — handy for bots and the UI. */
export const hexesTouchedBy = (
  state: GameState,
  playerId: PlayerId,
): string[] => {
  const mine = new Set(
    state.settlements.filter((s) => s.owner === playerId).map((s) => s.vertex),
  );
  return state.board.hexes
    .filter((h) => hexVertices(h.coord).some((v) => mine.has(v)))
    .map((h) => hexKey(h.coord));
};
