/**
 * Seafarers.
 *
 * Adds ships, the pirate, fog hexes and per-island settlement bonuses. Gold
 * hexes are not here — they turned out to be a production rule rather than a
 * naval one, so `rules/base.ts` owns them and they work with the expansion off.
 *
 * The two rules worth stating plainly, because they drive most of the code:
 *
 *  - **Roads and ships are different networks.** They join only at a settlement
 *    or city you own, never mid-route. `roadConnects` takes the piece kind for
 *    exactly this reason.
 *  - **A ship at the end of a route can be relocated**, once per turn, and never
 *    on the turn it was built. That is what `locked` and `movedShipThisTurn`
 *    track.
 */

import type { ActionResult, GameAction } from '../actions';
import { fail } from '../actions';
import type { Ctx, RulesModule } from '../engine';
import type { EdgeId, VertexId } from '../hex';
import { edgeVertices, hexKey, vertexEdges, vertexHexes } from '../hex';
import { add, canAfford, subtract } from '../hand';
import {
  hexAt,
  isCurrentPlayer,
  pieceAt,
  playerById,
  roadError,
  settlementAt,
} from '../legal';
import { getScenario } from '../scenarios';
import type {
  GameState,
  Hex,
  Player,
  PlayerId,
  Resource,
  RoadPiece,
} from '../types';
import { COSTS, RESOURCE_FOR_TERRAIN } from '../types';
import { advancePhase, logLine, ok, PENDING_PHASE } from './base';

declare module '../types' {
  interface GameState {
    /** One ship relocation per turn; cleared when the turn advances. */
    movedShipThisTurn?: boolean;
  }
}

/** Moving the pirate is its own interruption, resolved like the robber. */
PENDING_PHASE.pirate = 'move_pirate';

/** Fallback when a scenario does not specify its own island payouts. */
const DEFAULT_ISLAND_BONUS = 2;

// ---------------------------------------------------------------------------
// Islands
// ---------------------------------------------------------------------------

function islandBonusFor(state: GameState, island: number): number {
  if (island === 0) return 0;
  const scenario = getScenario(state.options.scenario);
  return scenario?.islandBonus?.[island] ?? DEFAULT_ISLAND_BONUS;
}

/** Island numbers reachable from a vertex, ignoring the starting island. */
function islandsAt(state: GameState, vertex: VertexId): number[] {
  const out = new Set<number>();
  for (const coord of vertexHexes(vertex)) {
    const hex = hexAt(state, coord);
    if (hex?.island !== undefined && hex.island !== 0) out.add(hex.island);
  }
  return [...out];
}

/**
 * Award the landfall bonus the first time a player settles each outer island.
 * Called for every settlement, including the two placed during setup — a
 * scenario that starts players on separate islands depends on that.
 */
function creditIslands(
  draft: GameState,
  ctx: Ctx,
  player: Player,
  vertex: VertexId,
): void {
  player.islandsSettled ??= [];
  for (const island of islandsAt(draft, vertex)) {
    if (player.islandsSettled.includes(island)) continue;
    const bonus = islandBonusFor(draft, island);
    if (bonus <= 0) continue;
    player.islandsSettled.push(island);
    logLine(
      draft,
      ctx,
      player.id,
      `settled a new island for ${bonus} victory point${bonus === 1 ? '' : 's'}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Fog
// ---------------------------------------------------------------------------

/**
 * Reveal any fog hex the new piece now touches.
 *
 * This is the scenario the owners like most, so it is worth being precise: the
 * hex flips to whatever was hidden underneath, and if that is productive land
 * the builder immediately collects one of its resource.
 */
function revealFogAround(
  draft: GameState,
  ctx: Ctx,
  player: Player,
  edge: EdgeId,
): void {
  const touching = new Set<string>();
  for (const v of edgeVertices(edge)) {
    for (const c of vertexHexes(v)) touching.add(hexKey(c));
  }

  for (const hex of draft.board.hexes) {
    if (hex.terrain !== 'fog' || !hex.hidden) continue;
    if (!touching.has(hexKey(hex.coord))) continue;

    const { terrain, number } = hex.hidden;
    hex.terrain = terrain;
    if (number !== undefined) hex.number = number;
    delete hex.hidden;

    const resource = RESOURCE_FOR_TERRAIN[terrain];
    if (resource) {
      player.hand = add(player.hand, { [resource]: 1 });
      logLine(
        draft,
        ctx,
        player.id,
        `explored the fog, found ${terrain} and took 1 ${resource}`,
      );
    } else {
      logLine(draft, ctx, player.id, `explored the fog, found ${terrain}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Ships
// ---------------------------------------------------------------------------

/**
 * A ship can only be picked up from the open end of a route. An endpoint counts
 * as open when it carries no settlement and no other ship of yours, so a ship
 * wedged between two of your own pieces stays put.
 */
export function isOpenShip(state: GameState, ship: RoadPiece): boolean {
  return edgeVertices(ship.edge).some((v) => {
    if (settlementAt(state, v)) return false;
    const incident = vertexEdges(v);
    return !state.roads.some(
      (r) =>
        r.owner === ship.owner &&
        r.kind === 'ship' &&
        r.edge !== ship.edge &&
        incident.includes(r.edge),
    );
  });
}

export function movableShips(
  state: GameState,
  playerId: PlayerId,
): RoadPiece[] {
  if (state.movedShipThisTurn) return [];
  if (state.phase !== 'main' || !isCurrentPlayer(state, playerId)) return [];
  return state.roads.filter(
    (r) =>
      r.owner === playerId &&
      r.kind === 'ship' &&
      !r.locked &&
      isOpenShip(state, r),
  );
}

/** Sea hexes the pirate may be moved to — anywhere but where it already is. */
function legalPirateHexes(state: GameState): Hex[] {
  const current = state.board.pirate;
  return state.board.hexes.filter(
    (h) =>
      h.terrain === 'sea' &&
      (!current || hexKey(h.coord) !== hexKey(current)),
  );
}

/** Players with a ship touching the pirate's hex, who can therefore be robbed. */
function pirateVictims(state: GameState, roberId: PlayerId): PlayerId[] {
  const pirate = state.board.pirate;
  if (!pirate) return [];
  const key = hexKey(pirate);
  const victims = new Set<PlayerId>();
  for (const r of state.roads) {
    if (r.kind !== 'ship' || r.owner === roberId) continue;
    const touches = edgeVertices(r.edge).some((v) =>
      vertexHexes(v).some((c) => hexKey(c) === key),
    );
    if (touches && Object.keys(playerById(state, r.owner)?.hand ?? {}).length) {
      victims.add(r.owner);
    }
  }
  return [...victims];
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

function handle(
  draft: GameState,
  action: GameAction,
  ctx: Ctx,
): ActionResult | null {
  const actor = playerById(draft, action.playerId);
  if (!actor) return null;

  switch (action.type) {
    case 'build_ship': {
      const setup = draft.phase === 'setup_first' || draft.phase === 'setup_second';
      const err = roadError(draft, action.playerId, action.edge, {
        kind: 'ship',
        free: setup,
      });
      if (err) return fail(err);

      if (!setup) actor.hand = subtract(actor.hand, COSTS.ship);
      actor.supply.ships -= 1;
      // Locked for this turn: a ship cannot be built and then relocated in the
      // same turn, which would otherwise let a player teleport it two edges.
      draft.roads.push({
        edge: action.edge,
        owner: actor.id,
        kind: 'ship',
        locked: true,
      });
      logLine(draft, ctx, actor.id, 'built a ship');
      revealFogAround(draft, ctx, actor, action.edge);
      return ok(draft);
    }

    case 'move_ship': {
      if (!isCurrentPlayer(draft, action.playerId)) {
        return fail('it is not your turn');
      }
      if (draft.phase !== 'main') return fail('you cannot move a ship now');
      if (draft.movedShipThisTurn) {
        return fail('you have already moved a ship this turn');
      }
      const ship = draft.roads.find(
        (r) => r.edge === action.from && r.kind === 'ship',
      );
      if (!ship) return fail('there is no ship there');
      if (ship.owner !== actor.id) return fail('that is not your ship');
      if (ship.locked) return fail('that ship was built this turn');
      if (!isOpenShip(draft, ship)) {
        return fail('only a ship at the end of a route can be moved');
      }
      if (pieceAt(draft, action.to)) return fail('that edge is taken');
      if (!draft.board.shipEdges.includes(action.to)) {
        return fail('a ship cannot go there');
      }

      // Validate the destination against the network *without* this ship,
      // otherwise a ship could appear to anchor itself.
      const without: GameState = {
        ...draft,
        roads: draft.roads.filter((r) => r !== ship),
      };
      const err = roadError(without, action.playerId, action.to, {
        kind: 'ship',
        free: true,
      });
      if (err) return fail(err);

      ship.edge = action.to;
      ship.locked = true;
      draft.movedShipThisTurn = true;
      logLine(draft, ctx, actor.id, 'moved a ship');
      revealFogAround(draft, ctx, actor, action.to);
      return ok(draft);
    }

    case 'move_pirate': {
      // A 7 queues a 'robber' task; with Seafarers on, the roller may satisfy
      // it by moving the pirate instead. Either piece, never both.
      const task = draft.pending.find(
        (t) =>
          (t.kind === 'pirate' || t.kind === 'robber') &&
          t.playerId === action.playerId,
      );
      if (!task) return fail('you are not moving the pirate');
      const target = draft.board.hexes.find(
        (h) => hexKey(h.coord) === hexKey(action.hex),
      );
      if (!target || target.terrain !== 'sea') {
        return fail('the pirate must go on a sea hex');
      }
      if (
        draft.board.pirate &&
        hexKey(draft.board.pirate) === hexKey(action.hex)
      ) {
        return fail('the pirate is already there');
      }

      draft.board.pirate = action.hex;
      draft.pending.splice(draft.pending.indexOf(task), 1);
      logLine(draft, ctx, actor.id, 'moved the pirate');

      const victims = pirateVictims(draft, actor.id);
      if (victims.length > 0) {
        draft.pending.unshift({
          kind: 'steal',
          playerId: actor.id,
          data: { victims },
        });
      }
      advancePhase(draft);
      return ok(draft);
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------

export const seafarersRules: RulesModule = {
  name: 'seafarers',

  enabled: (state) => state.options.expansions.seafarers,

  handle,

  /**
   * Building a settlement is base's job; Seafarers only needs to notice that it
   * happened, so it watches rather than intercepting. A road can also make
   * landfall in the sense of touching fog, so it gets the same treatment.
   */
  afterAction(draft, action, ctx) {
    const player = playerById(draft, action.playerId);
    if (!player) return;
    if (action.type === 'build_settlement') {
      creditIslands(draft, ctx, player, action.vertex);
    }
    if (action.type === 'build_road') {
      revealFogAround(draft, ctx, player, action.edge);
    }
  },

  onTurnStart(draft) {
    draft.movedShipThisTurn = false;
    // Ships stop being "just built" once their owner's next turn begins.
    for (const r of draft.roads) {
      if (r.kind === 'ship' && r.owner === draft.players[draft.currentPlayer]?.id) {
        delete r.locked;
      }
    }
  },

  score(state, player) {
    return (player.islandsSettled ?? []).reduce(
      (sum, island) => sum + islandBonusFor(state, island),
      0,
    );
  },

  legalActions(state, playerId) {
    const out: GameAction[] = [];
    const p = playerById(state, playerId);
    if (!p) return out;
    const me = { playerId };

    // 'move_robber' is included on purpose: on a 7 the roller chooses which
    // piece to move, so both options must be offered from the same phase.
    if (state.phase === 'move_pirate' || state.phase === 'move_robber') {
      const owed = state.pending.some(
        (t) =>
          (t.kind === 'pirate' || t.kind === 'robber') && t.playerId === playerId,
      );
      if (owed) {
        for (const h of legalPirateHexes(state)) {
          out.push({ ...me, type: 'move_pirate', hex: h.coord });
        }
      }
      return out;
    }

    const buildable =
      state.phase === 'main' &&
      isCurrentPlayer(state, playerId) &&
      p.supply.ships > 0 &&
      canAfford(p.hand, COSTS.ship);

    if (buildable) {
      for (const edge of state.board.shipEdges) {
        if (roadError(state, playerId, edge, { kind: 'ship' }) === null) {
          out.push({ ...me, type: 'build_ship', edge });
        }
      }
    }

    for (const ship of movableShips(state, playerId)) {
      const without: GameState = {
        ...state,
        roads: state.roads.filter((r) => r !== ship),
      };
      for (const to of state.board.shipEdges) {
        if (to === ship.edge || pieceAt(state, to)) continue;
        if (
          roadError(without, playerId, to, { kind: 'ship', free: true }) === null
        ) {
          out.push({ ...me, type: 'move_ship', from: ship.edge, to });
        }
      }
    }

    return out;
  },
};

/** Exported for tests. */
export const __internals = {
  creditIslands,
  isOpenShip,
  islandsAt,
  pirateVictims,
  legalPirateHexes,
  revealFogAround,
};

export type { Resource };
