/**
 * Base Catan.
 *
 * This is the bottom of the rules chain: every action that no expansion claims
 * ends up here, and anything this module returns `null` for is genuinely
 * unknown. It mutates the draft the reducer hands it — that draft is a clone,
 * and it is thrown away if we return a failure, so mutation is safe here.
 *
 * Two conventions the expansions rely on:
 *
 *  - **Interruptions go through `state.pending`.** A step that must happen
 *    before play resumes is pushed as a `PendingAction`, and a `resume` entry
 *    records the phase to fall back to. `advancePhase` walks that queue, so
 *    nothing has to remember what came before it.
 *  - **Lifecycle hooks are fired by whoever owns the action.** `end_turn`
 *    lives here, so this module fires `onTurnEnd`/`onTurnStart` using
 *    `ctx.modules`.
 */

import type { ActionResult, GameAction } from '../actions';
import { fail } from '../actions';
import type { Ctx, RulesModule } from '../engine';
import { hexEquals, vertexHexes } from '../hex';
import {
  add,
  ALL_TRADEABLES,
  canAfford,
  count,
  subtract,
  toList,
  totalCards,
} from '../hand';
import {
  bankStock,
  currentPlayerOf,
  discardCountFor,
  isCurrentPlayer,
  isResource,
  isSetupPhase,
  playerById,
  productionFor,
  robberVictims,
  roadError,
  settlementAt,
  settlementError,
  cityError,
  buyDevCardError,
  bankTradeError,
  playDevCardError,
  tradeResponders,
} from '../legal';
import { updateLargestArmy } from '../scoring';
import type {
  GameState,
  Hand,
  PendingAction,
  Phase,
  Player,
  PlayerId,
  Resource,
} from '../types';
import { COSTS, RESOURCES, RESOURCE_FOR_TERRAIN } from '../types';

export const ok = (state: GameState): ActionResult => ({ ok: true, state });

/**
 * Which phase each kind of pending work puts the game into. Expansions may add
 * their own entries; an unknown kind leaves the phase alone so the module that
 * queued it can drive things itself.
 */
export const PENDING_PHASE: Record<string, Phase> = {
  discard: 'discard',
  gold: 'choose_gold',
  robber: 'move_robber',
  steal: 'steal',
};

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

export function logLine(
  draft: GameState,
  ctx: Ctx,
  playerId: PlayerId | undefined,
  message: string,
): void {
  draft.log.push({ turn: draft.turn, playerId, message, at: ctx.now });
}

const enabledModules = (draft: GameState, ctx: Ctx): RulesModule[] =>
  (ctx.modules ?? []).filter((m) => m.enabled(draft));

/** Lifecycle order is the reverse of dispatch order: base first. */
const lifecycleModules = (draft: GameState, ctx: Ctx): RulesModule[] =>
  [...enabledModules(draft, ctx)].reverse();

const dropPending = (draft: GameState, task: PendingAction): void => {
  const i = draft.pending.indexOf(task);
  if (i >= 0) draft.pending.splice(i, 1);
};

/**
 * Move to whatever the pending queue says is next, falling back to the phase
 * recorded by the matching `resume` entry when the queue is otherwise empty.
 */
export function advancePhase(draft: GameState): void {
  const next = draft.pending.find((p) => p.kind !== 'resume');
  if (next) {
    const phase = PENDING_PHASE[next.kind];
    if (phase) draft.phase = phase;
    return;
  }
  const i = draft.pending.findIndex((p) => p.kind === 'resume');
  if (i >= 0) {
    const [resume] = draft.pending.splice(i, 1);
    draft.phase = (resume.data?.phase as Phase | undefined) ?? 'main';
  }
}

/** Queue an interruption and remember where to come back to. */
function interrupt(
  draft: GameState,
  playerId: PlayerId,
  tasks: PendingAction[],
  resumeTo: Phase,
): void {
  draft.pending.push(...tasks, {
    kind: 'resume',
    playerId,
    data: { phase: resumeTo },
  });
  advancePhase(draft);
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

function placeRoad(
  draft: GameState,
  player: Player,
  edge: string,
  free: boolean,
): void {
  if (!free) player.hand = subtract(player.hand, COSTS.road);
  draft.roads.push({ edge, owner: player.id, kind: 'road' });
  player.supply.roads -= 1;
}

/**
 * The second settlement of the opening draft pays out its surrounding hexes.
 * Gold hexes owe a free choice instead, which suspends setup until it is made.
 */
function grantInitialResources(
  draft: GameState,
  ctx: Ctx,
  player: Player,
  vertex: string,
): void {
  let gold = 0;
  const gained: Hand = {};
  for (const coord of vertexHexes(vertex)) {
    const hex = draft.board.hexes.find((h) => hexEquals(h.coord, coord));
    if (!hex) continue;
    if (hex.terrain === 'gold') {
      gold += 1;
      continue;
    }
    const resource = RESOURCE_FOR_TERRAIN[hex.terrain];
    if (resource) gained[resource] = count(gained, resource) + 1;
  }
  if (totalCards(gained) > 0) {
    player.hand = add(player.hand, gained);
    logLine(draft, ctx, player.id, 'collected starting resources');
  }
  if (gold > 0) {
    interrupt(
      draft,
      player.id,
      [{ kind: 'gold', playerId: player.id, data: { count: gold } }],
      'setup_second',
    );
  }
}

// ---------------------------------------------------------------------------
// Turn flow
// ---------------------------------------------------------------------------

/** Opening draft order: forward for the first round, reverse for the second. */
function advanceSetup(draft: GameState, ctx: Ctx): void {
  const last = draft.players.length - 1;
  if (draft.phase === 'setup_first') {
    if (draft.currentPlayer < last) draft.currentPlayer += 1;
    else draft.phase = 'setup_second'; // the last player places twice
    return;
  }
  if (draft.currentPlayer > 0) {
    draft.currentPlayer -= 1;
    return;
  }
  beginPlay(draft, ctx);
}

function beginPlay(draft: GameState, ctx: Ctx): void {
  draft.currentPlayer = 0;
  draft.turn = 1;
  draft.phase = 'roll';
  draft.devCardPlayedThisTurn = false;
  logLine(draft, ctx, undefined, 'setup complete');
  for (const m of lifecycleModules(draft, ctx)) m.onTurnStart?.(draft, ctx);
}

export function advanceTurn(draft: GameState, ctx: Ctx): void {
  const n = draft.players.length;
  for (let i = 1; i <= n; i++) {
    const candidate = (draft.currentPlayer + i) % n;
    if (!draft.players[candidate].resigned) {
      draft.currentPlayer = candidate;
      break;
    }
  }
  draft.turn += 1;
  draft.phase = 'roll';
  draft.devCardPlayedThisTurn = false;
  delete draft.activeTrade;
  // Bot trade allowances are per turn; see GameOptions.botTrade.
  for (const p of draft.players) p.botTradesThisTurn = 0;
  draft.botTradeRefusals = {};
  for (const m of lifecycleModules(draft, ctx)) m.onTurnStart?.(draft, ctx);
}

// ---------------------------------------------------------------------------
// Production
// ---------------------------------------------------------------------------

/**
 * Hand out what the roll produced.
 *
 * The bank is finite. When it cannot cover everyone owed a resource, nobody
 * gets any of it — unless exactly one player is owed it, in which case they
 * take whatever is left.
 */
function distributeProduction(
  draft: GameState,
  ctx: Ctx,
  roll: number,
): void {
  const { owed, goldPicks } = productionFor(draft, roll);

  // Under C&K this loop also carries the three commodities, which obey the
  // same bank-shortage rule as resources.
  for (const resource of ALL_TRADEABLES) {
    const claimants = draft.players.filter(
      (p) => count(owed[p.id] ?? {}, resource) > 0,
    );
    if (claimants.length === 0) continue;

    const demand = claimants.reduce(
      (sum, p) => sum + count(owed[p.id], resource),
      0,
    );
    const stock = bankStock(draft, resource);

    if (demand <= stock) {
      for (const p of claimants) {
        p.hand = add(p.hand, { [resource]: count(owed[p.id], resource) });
      }
      continue;
    }
    if (claimants.length === 1) {
      const p = claimants[0];
      if (stock > 0) p.hand = add(p.hand, { [resource]: stock });
      logLine(
        draft,
        ctx,
        p.id,
        `took the bank's last ${stock} ${resource}`,
      );
      continue;
    }
    logLine(
      draft,
      ctx,
      undefined,
      `the bank is short of ${resource}, so nobody receives any`,
    );
  }

  const owedGold = draft.players
    .filter((p) => (goldPicks[p.id] ?? 0) > 0)
    .map<PendingAction>((p) => ({
      kind: 'gold',
      playerId: p.id,
      data: { count: goldPicks[p.id] },
    }));

  if (owedGold.length > 0) {
    interrupt(draft, currentPlayerOf(draft)!.id, owedGold, 'main');
  } else {
    draft.phase = 'main';
  }
}

function sevenRolled(draft: GameState, ctx: Ctx): void {
  const roller = currentPlayerOf(draft)!;
  const tasks: PendingAction[] = [];
  for (const p of draft.players) {
    if (p.resigned) continue;
    const n = discardCountFor(draft, p.id);
    if (n > 0) tasks.push({ kind: 'discard', playerId: p.id, data: { count: n } });
  }
  tasks.push({ kind: 'robber', playerId: roller.id });
  interrupt(draft, roller.id, tasks, 'main');
}

// ---------------------------------------------------------------------------
// The handler
// ---------------------------------------------------------------------------

function handle(
  draft: GameState,
  action: GameAction,
  ctx: Ctx,
): ActionResult | null {
  const actor = playerById(draft, action.playerId);
  if (!actor) return fail('no such player');
  if (draft.phase === 'game_over' && action.type !== 'resign') {
    return fail('the game is over');
  }
  if (actor.resigned) return fail('you have resigned');

  switch (action.type) {
    // ---------------------------------------------------------------- flow --
    case 'roll': {
      if (draft.phase !== 'roll') return fail('you cannot roll right now');
      if (!isCurrentPlayer(draft, action.playerId)) {
        return fail('it is not your turn');
      }
      const white = ctx.rng.die();
      const red = ctx.rng.die();
      draft.lastRoll = { white, red };
      const total = white + red;
      logLine(draft, ctx, actor.id, `rolled ${total}`);

      for (const m of lifecycleModules(draft, ctx)) m.onRoll?.(draft, ctx);

      if (total === 7) sevenRolled(draft, ctx);
      else distributeProduction(draft, ctx, total);
      return ok(draft);
    }

    case 'end_turn': {
      if (!isCurrentPlayer(draft, action.playerId)) {
        return fail('it is not your turn');
      }
      if (draft.phase !== 'main') return fail('you cannot end your turn yet');
      if (draft.pending.length > 0) return fail('you have unfinished business');
      if (draft.activeTrade) return fail('cancel your trade offer first');

      for (const m of lifecycleModules(draft, ctx)) m.onTurnEnd?.(draft, ctx);
      advanceTurn(draft, ctx);
      return ok(draft);
    }

    // ------------------------------------------------------------ building --
    case 'build_settlement': {
      const err = settlementError(draft, action.playerId, action.vertex);
      if (err) return fail(err);
      const setup = isSetupPhase(draft.phase);
      if (!setup) actor.hand = subtract(actor.hand, COSTS.settlement);
      draft.settlements.push({
        vertex: action.vertex,
        owner: actor.id,
        kind: 'settlement',
      });
      actor.supply.settlements -= 1;
      logLine(draft, ctx, actor.id, 'built a settlement');
      if (draft.phase === 'setup_second') {
        grantInitialResources(draft, ctx, actor, action.vertex);
      }
      return ok(draft);
    }

    case 'build_road': {
      const setup = isSetupPhase(draft.phase);
      const err = roadError(draft, action.playerId, action.edge, {
        free: setup,
      });
      if (err) return fail(err);
      placeRoad(draft, actor, action.edge, setup);
      logLine(draft, ctx, actor.id, 'built a road');
      if (setup) advanceSetup(draft, ctx);
      return ok(draft);
    }

    case 'build_city': {
      const err = cityError(draft, action.playerId, action.vertex);
      if (err) return fail(err);
      const target = settlementAt(draft, action.vertex)!;
      target.kind = 'city';
      actor.hand = subtract(actor.hand, COSTS.city);
      actor.supply.cities -= 1;
      actor.supply.settlements += 1; // the settlement goes back in the box
      logLine(draft, ctx, actor.id, 'upgraded to a city');
      return ok(draft);
    }

    // ----------------------------------------------------------- dev cards --
    case 'buy_dev_card': {
      const err = buyDevCardError(draft, action.playerId);
      if (err) return fail(err);
      const card = draft.devDeck.shift()!;
      card.boughtOnTurn = draft.turn;
      actor.devCards.push(card);
      actor.hand = subtract(actor.hand, COSTS.devCard);
      logLine(draft, ctx, actor.id, 'bought a development card');
      return ok(draft);
    }

    case 'play_dev_card': {
      const err = playDevCardError(draft, action.playerId, action.cardId);
      if (err) return fail(err);
      const card = actor.devCards.find((c) => c.id === action.cardId)!;
      const resumeTo = draft.phase;

      switch (card.kind) {
        case 'knight': {
          card.played = true;
          draft.devCardPlayedThisTurn = true;
          actor.knightsPlayed += 1;
          updateLargestArmy(draft);
          logLine(draft, ctx, actor.id, 'played a knight');
          interrupt(
            draft,
            actor.id,
            [{ kind: 'robber', playerId: actor.id }],
            resumeTo,
          );
          return ok(draft);
        }
        case 'road_building': {
          const choice = action.choice;
          if (!choice || choice.kind !== 'road_building') {
            return fail('choose where the roads go');
          }
          const edges = choice.edges ?? [];
          const allowed = Math.min(2, actor.supply.roads);
          if (edges.length < 1 || edges.length > allowed) {
            return fail(`you must place ${allowed} road(s)`);
          }
          if (new Set(edges).size !== edges.length) {
            return fail('those are the same edge');
          }
          for (const edge of edges) {
            const problem = roadError(draft, actor.id, edge, {
              free: true,
              ignorePhase: true,
            });
            if (problem) return fail(problem);
            placeRoad(draft, actor, edge, true);
          }
          card.played = true;
          draft.devCardPlayedThisTurn = true;
          logLine(draft, ctx, actor.id, 'played road building');
          return ok(draft);
        }
        case 'year_of_plenty': {
          const choice = action.choice;
          if (!choice || choice.kind !== 'year_of_plenty') {
            return fail('choose two resources');
          }
          const wanted = choice.resources ?? [];
          const available = RESOURCES.reduce(
            (sum, r) => sum + bankStock(draft, r),
            0,
          );
          const allowed = Math.min(2, available);
          if (wanted.length !== allowed) {
            return fail(`you must take ${allowed} resource(s)`);
          }
          const gain: Hand = {};
          for (const r of wanted) {
            if (!isResource(r)) return fail('that is not a resource');
            gain[r] = count(gain, r) + 1;
          }
          for (const r of RESOURCES) {
            if (count(gain, r) > bankStock(draft, r)) {
              return fail(`the bank is out of ${r}`);
            }
          }
          actor.hand = add(actor.hand, gain);
          card.played = true;
          draft.devCardPlayedThisTurn = true;
          logLine(draft, ctx, actor.id, 'played year of plenty');
          return ok(draft);
        }
        case 'monopoly': {
          const choice = action.choice;
          if (!choice || choice.kind !== 'monopoly') {
            return fail('choose a resource');
          }
          const resource = choice.resource;
          if (!isResource(resource)) return fail('that is not a resource');
          let taken = 0;
          for (const victim of draft.players) {
            if (victim.id === actor.id) continue;
            const n = count(victim.hand, resource);
            if (!n) continue;
            victim.hand = subtract(victim.hand, { [resource]: n });
            taken += n;
          }
          if (taken > 0) actor.hand = add(actor.hand, { [resource]: taken });
          card.played = true;
          draft.devCardPlayedThisTurn = true;
          logLine(
            draft,
            ctx,
            actor.id,
            `monopolised ${resource} and took ${taken}`,
          );
          return ok(draft);
        }
        default:
          return fail('that card cannot be played');
      }
    }

    // -------------------------------------------------------- robber / 7's --
    case 'discard': {
      const task = draft.pending.find(
        (t) => t.kind === 'discard' && t.playerId === action.playerId,
      );
      if (!task) return fail('you do not owe a discard');
      const owed = Number(task.data?.count ?? 0);
      if (totalCards(action.hand) !== owed) {
        return fail(`you must discard exactly ${owed} cards`);
      }
      if (!canAfford(actor.hand, action.hand)) {
        return fail('you do not hold those cards');
      }
      actor.hand = subtract(actor.hand, action.hand);
      dropPending(draft, task);
      logLine(draft, ctx, actor.id, `discarded ${owed} cards`);
      advancePhase(draft);
      return ok(draft);
    }

    case 'move_robber': {
      const task = draft.pending.find(
        (t) => t.kind === 'robber' && t.playerId === action.playerId,
      );
      if (!task) return fail('the robber does not need moving');
      const target = draft.board.hexes.find((h) =>
        hexEquals(h.coord, action.hex),
      );
      if (!target || target.terrain === 'sea') {
        return fail('the robber must go on a land hex');
      }
      if (hexEquals(action.hex, draft.board.robber)) {
        return fail('the robber is already there');
      }
      draft.board.robber = { q: action.hex.q, r: action.hex.r };
      dropPending(draft, task);
      logLine(draft, ctx, actor.id, 'moved the robber');

      const victims = robberVictims(draft, action.hex, actor.id);
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

    case 'steal': {
      const task = draft.pending.find(
        (t) => t.kind === 'steal' && t.playerId === action.playerId,
      );
      if (!task) return fail('there is nobody to rob');
      const victims = (task.data?.victims as PlayerId[] | undefined) ?? [];
      if (action.victim === null) {
        if (victims.length > 0) return fail('choose someone to rob');
      } else {
        if (!victims.includes(action.victim)) {
          return fail('you cannot rob that player');
        }
        const victim = playerById(draft, action.victim)!;
        const cards = toList(victim.hand);
        if (cards.length === 0) return fail('that player has no cards');
        const stolen = cards[ctx.rng.int(cards.length)];
        victim.hand = subtract(victim.hand, { [stolen]: 1 });
        actor.hand = add(actor.hand, { [stolen]: 1 });
        logLine(draft, ctx, actor.id, `robbed ${victim.name}`);
      }
      dropPending(draft, task);
      advancePhase(draft);
      return ok(draft);
    }

    case 'choose_gold': {
      const task = draft.pending.find(
        (t) => t.kind === 'gold' && t.playerId === action.playerId,
      );
      if (!task) return fail('you have no gold to spend');
      const owed = Number(task.data?.count ?? 0);
      const gain: Hand = {};
      let total = 0;
      for (const [key, n] of Object.entries(action.resources ?? {})) {
        if (!n) continue;
        if (n < 0 || !isResource(key as Resource)) {
          return fail('that is not a resource');
        }
        gain[key as Resource] = n;
        total += n;
      }
      if (total !== owed) return fail(`you must take exactly ${owed}`);
      for (const r of RESOURCES) {
        if (count(gain, r) > bankStock(draft, r)) {
          return fail(`the bank is out of ${r}`);
        }
      }
      actor.hand = add(actor.hand, gain);
      dropPending(draft, task);
      logLine(draft, ctx, actor.id, `took ${owed} from a gold hex`);
      advancePhase(draft);
      return ok(draft);
    }

    // --------------------------------------------------------------- trade --
    case 'bank_trade': {
      const err = bankTradeError(
        draft,
        action.playerId,
        action.give,
        action.receive,
      );
      if (err) return fail(err);
      actor.hand = add(subtract(actor.hand, action.give), action.receive);
      logLine(draft, ctx, actor.id, 'traded with the bank');
      return ok(draft);
    }

    case 'offer_trade': {
      if (draft.phase !== 'main') return fail('you cannot trade right now');
      if (!isCurrentPlayer(draft, action.playerId)) {
        return fail('only the player in turn may open a trade');
      }
      if (draft.activeTrade) return fail('there is already an offer on the table');
      if (totalCards(action.give) === 0 || totalCards(action.receive) === 0) {
        return fail('a trade needs something on both sides');
      }
      if (!canAfford(actor.hand, action.give)) {
        return fail('you do not hold what you are offering');
      }
      if (actor.isBot) actor.botTradesMade = (actor.botTradesMade ?? 0) + 1;
      if (actor.isBot) {
        actor.botTradesThisTurn = (actor.botTradesThisTurn ?? 0) + 1;
      }
      const invited = (action.to ?? []).filter((id) => id !== actor.id);
      if (invited.some((id) => !playerById(draft, id))) {
        return fail('no such player');
      }
      draft.activeTrade = {
        id: `trade-${draft.version}-${draft.turn}`,
        from: actor.id,
        to: invited,
        give: action.give,
        receive: action.receive,
        accepted: [],
        rejected: [],
      };
      draft.phase = 'trade_response';
      logLine(draft, ctx, actor.id, 'offered a trade');
      return ok(draft);
    }

    case 'respond_trade': {
      const offer = draft.activeTrade;
      if (!offer) return fail('there is no offer to answer');
      if (offer.from === action.playerId) {
        return fail('you cannot answer your own offer');
      }
      if (!tradeResponders(draft).includes(action.playerId)) {
        return fail('that offer is not open to you');
      }
      if (!action.accept && !actor.isBot) {
        // A human turning a bot down silences it for the rest of the turn.
        draft.botTradeRefusals ??= {};
        draft.botTradeRefusals[offer.from] =
          (draft.botTradeRefusals[offer.from] ?? 0) + 1;
      }
      if (action.accept) {
        if (!canAfford(actor.hand, offer.receive)) {
          return fail('you do not hold what they asked for');
        }
        offer.accepted.push(action.playerId);
      } else {
        offer.rejected.push(action.playerId);
      }
      // Nothing left to wait for and nobody wants it: clear the table.
      if (tradeResponders(draft).length === 0 && offer.accepted.length === 0) {
        delete draft.activeTrade;
        draft.phase = 'main';
        logLine(draft, ctx, offer.from, 'nobody took the trade');
      }
      return ok(draft);
    }

    case 'confirm_trade': {
      const offer = draft.activeTrade;
      if (!offer) return fail('there is no offer to confirm');
      if (offer.from !== action.playerId) return fail('that is not your offer');
      if (!offer.accepted.includes(action.with)) {
        return fail('that player has not accepted');
      }
      const partner = playerById(draft, action.with)!;
      if (!canAfford(actor.hand, offer.give)) {
        return fail('you no longer hold what you offered');
      }
      if (!canAfford(partner.hand, offer.receive)) {
        return fail('they no longer hold what you asked for');
      }
      actor.hand = add(subtract(actor.hand, offer.give), offer.receive);
      partner.hand = add(subtract(partner.hand, offer.receive), offer.give);
      delete draft.activeTrade;
      draft.phase = 'main';
      logLine(draft, ctx, actor.id, `traded with ${partner.name}`);
      return ok(draft);
    }

    case 'cancel_trade': {
      const offer = draft.activeTrade;
      if (!offer) return fail('there is no offer to cancel');
      if (offer.from !== action.playerId) return fail('that is not your offer');
      delete draft.activeTrade;
      draft.phase = 'main';
      logLine(draft, ctx, actor.id, 'withdrew the offer');
      return ok(draft);
    }

    // ---------------------------------------------------------------- meta --
    case 'resign': {
      if (actor.resigned) return fail('you have already resigned');
      actor.resigned = true;
      draft.pending = draft.pending.filter((t) => t.playerId !== actor.id);
      if (draft.activeTrade && draft.activeTrade.from === actor.id) {
        delete draft.activeTrade;
        draft.phase = 'main';
      }
      logLine(draft, ctx, actor.id, 'resigned');

      const remaining = draft.players.filter((p) => !p.resigned);
      if (remaining.length <= 1) {
        draft.phase = 'game_over';
        if (remaining[0]) draft.winner = remaining[0].id;
        return ok(draft);
      }
      if (isCurrentPlayer(draft, actor.id)) advanceTurn(draft, ctx);
      return ok(draft);
    }

    default:
      return null;
  }
}

export const baseRules: RulesModule = {
  name: 'base',
  enabled: () => true,
  handle,
};
