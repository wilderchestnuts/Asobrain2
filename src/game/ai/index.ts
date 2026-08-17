/**
 * The bot policy.
 *
 * Deliberately a competent-but-beatable heuristic player, not a search. These
 * bots exist to be "random interference" in a two-human game, so the bar is
 * that they never blunder embarrassingly, never stall a turn, and — above all —
 * never pester a human for trades.
 *
 * It is a pure function of the state: `chooseAction` returns one action, and
 * the server calls it in a loop until it returns `null`. That keeps bots
 * replayable and lets them run inside a single request.
 */

import type { GameAction } from '../actions';
import { allLegalActions } from '../reducer';
import { count, totalCards } from '../hand';
import {
  bankStock,
  hexesTouchedBy,
  playerById,
  productionFor,
  settlementAt,
  tradeResponders,
  truePoints,
  violatesDistanceRule,
} from '../legal';
import { pipsFor } from '../board';
import { BARBARIAN_ATTACK_AT } from '../rules/citiesKnights';
import type { EdgeId, VertexId } from '../hex';
import { edgeVertices, hexVertices, vertexEdges, vertexHexes } from '../hex';
import type { GameState, PlayerId, Resource, Tradeable } from '../types';
import { RESOURCE_FOR_TERRAIN, RESOURCES, TRACK_COMMODITY } from '../types';


/** Interruptions must be answered before anything else can happen. */
const BLOCKING: ReadonlySet<string> = new Set([
  'discard',
  'move_robber',
  'move_pirate',
  'steal',
  'choose_gold',
  'barbarian_loss',
  'discard_progress_card',
  'choose_metropolis',
]);

/**
 * How much a bot wants each resource. Ore and grain win games through cities,
 * so they are weighted above the road-building pair.
 */
const RESOURCE_VALUE: Record<Resource, number> = {
  ore: 1.2,
  grain: 1.15,
  wool: 0.95,
  brick: 0.9,
  lumber: 0.9,
};

// ---------------------------------------------------------------------------
// Board evaluation
// ---------------------------------------------------------------------------

/**
 * Score a settlement spot: total probability, weighted by resource value, with
 * a bonus for variety. Diversity matters more than raw pips early, because a
 * player who cannot make bricks cannot expand at all.
 */
export function evaluateVertex(state: GameState, vertex: VertexId): number {
  let pips = 0;
  const kinds = new Set<string>();

  for (const coord of vertexHexes(vertex)) {
    const hex = state.board.hexes.find(
      (h) => h.coord.q === coord.q && h.coord.r === coord.r,
    );
    if (!hex?.number) continue;

    const weight =
      hex.terrain === 'gold'
        ? 1.4 // gold is any resource, which is worth a premium
        : (RESOURCE_VALUE[RESOURCE_FOR_TERRAIN[hex.terrain] as Resource] ?? 0);
    if (weight === 0) continue;

    pips += pipsFor(hex.number) * weight;
    kinds.add(hex.terrain);
  }

  // A port is only worth something once there is production to feed it.
  const onPort = state.board.ports.some((p) => p.vertices.includes(vertex));
  return pips + kinds.size * 1.5 + (onPort && pips > 0 ? 0.75 : 0);
}

/**
 * How much a road or ship on this edge advances the player towards somewhere
 * worth settling.
 *
 * The bot used to take the first legal edge in enumeration order, which is
 * arbitrary — so it laid roads into dead ends and along the coast and almost
 * never arrived anywhere. Over a long game that reads as a player who does
 * nothing, because building a road that leads nowhere *is* doing nothing.
 *
 * The search walks outward from the new edge over buildable edges and takes
 * the best open spot it can see, discounted by how many more pieces it would
 * take to get there.
 */
const ROUTE_HORIZON = 3;

function routeValue(
  state: GameState,
  playerId: PlayerId,
  edge: EdgeId,
): number {
  const buildable = new Set<EdgeId>([
    ...state.board.roadEdges,
    ...state.board.shipEdges,
  ]);
  const taken = new Set(state.roads.map((r) => r.edge));

  let value = 0;
  const seen = new Set<EdgeId>([edge]);
  let frontier: EdgeId[] = [edge];

  for (let step = 0; step <= ROUTE_HORIZON && frontier.length > 0; step++) {
    const next: EdgeId[] = [];
    for (const e of frontier) {
      for (const v of edgeVertices(e)) {
        // Somewhere we could actually put a settlement one day.
        if (
          state.board.landVertices.includes(v) &&
          !settlementAt(state, v) &&
          !violatesDistanceRule(state, v)
        ) {
          value = Math.max(value, evaluateVertex(state, v) / (1 + step));
        }
        for (const n of vertexEdges(v)) {
          if (seen.has(n) || !buildable.has(n) || taken.has(n)) continue;
          seen.add(n);
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return value;
}

/** The best road or ship available, or null if none leads anywhere. */
function chooseRoute(
  state: GameState,
  playerId: PlayerId,
  legal: GameAction[],
): { action: GameAction; value: number } | null {
  const routes = [...all(legal, 'build_road'), ...all(legal, 'build_ship')];
  if (routes.length === 0) return null;

  let winner: GameAction | null = null;
  let bestValue = -Infinity;
  for (const a of routes) {
    const v = routeValue(state, playerId, (a as { edge: EdgeId }).edge);
    if (v > bestValue) {
      bestValue = v;
      winner = a;
    }
  }
  return winner ? { action: winner, value: bestValue } : null;
}

/** What this player would earn per roll, as a rough measure of position. */
function incomeFor(state: GameState, playerId: PlayerId): number {
  let total = 0;
  for (let roll = 2; roll <= 12; roll++) {
    const { owed, goldPicks } = productionFor(state, roll);
    const hand = owed[playerId] ?? {};
    const n = totalCards(hand) + (goldPicks[playerId] ?? 0);
    total += n * pipsFor(roll);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Choosing
// ---------------------------------------------------------------------------

const pick = (legal: GameAction[], type: string): GameAction | undefined =>
  legal.find((a) => a.type === type);

const all = (legal: GameAction[], type: string): GameAction[] =>
  legal.filter((a) => a.type === type);

/**
 * The bot's move, or `null` when it has nothing left to do.
 *
 * Order matters: settle what the rules are waiting on, then take the free
 * points, then build, then consider trading. Trading is last on purpose.
 */
export function chooseAction(
  state: GameState,
  playerId: PlayerId,
): GameAction | null {
  const legal = allLegalActions(state, playerId);
  if (legal.length === 0) return null;

  const player = playerById(state, playerId);
  if (!player) return null;

  // --- 1. anything owed ---
  const blocking = legal.filter((a) => BLOCKING.has(a.type));
  if (blocking.length > 0) return chooseBlocking(state, playerId, blocking);

  // --- 2. finish any trade business; leaving it hanging stalls the table ---
  const respond = all(legal, 'respond_trade');
  if (respond.length > 0) return answerOffer(state, playerId, respond);

  // Our own offer came back answered. Take the first acceptance, or withdraw —
  // an offer left on the table blocks the turn from ever ending.
  const confirm = pick(legal, 'confirm_trade');
  if (confirm) return confirm;
  const cancel = pick(legal, 'cancel_trade');
  if (cancel) return cancel;

  // --- 3. opening placement ---
  if (state.phase === 'setup_first' || state.phase === 'setup_second') {
    const settlements = all(legal, 'build_settlement');
    if (settlements.length > 0) {
      return best(settlements, (a) =>
        evaluateVertex(state, (a as { vertex: VertexId }).vertex),
      );
    }
    // The opening road points at the best spot still open nearby — which is
    // what the comment here always claimed, and what taking the first legal
    // edge never did.
    const route = chooseRoute(state, playerId, legal);
    if (route) return route.action;
    return pick(legal, 'end_turn') ?? null;
  }

  // --- 4. roll ---
  const roll = pick(legal, 'roll');
  if (roll) return roll;

  // --- 5. build, best value first ---
  const build = chooseBuild(state, playerId, legal);
  if (build) return build;

  // --- 6. trade, sparingly ---
  const trade = chooseTrade(state, playerId, legal);
  if (trade) return trade;

  return pick(legal, 'end_turn') ?? null;
}

function best<T>(items: T[], score: (x: T) => number): T {
  let winner = items[0];
  let bestScore = -Infinity;
  for (const item of items) {
    const s = score(item);
    if (s > bestScore) {
      bestScore = s;
      winner = item;
    }
  }
  return winner;
}

/**
 * Accept an offer only when it is genuinely useful: it brings in something we
 * hold none of, and costs something we have to spare. Everything else is
 * declined immediately rather than left to time out.
 */
function answerOffer(
  state: GameState,
  playerId: PlayerId,
  options: GameAction[],
): GameAction {
  const me = playerById(state, playerId);
  const offer = state.activeTrade;
  const accept = options.find(
    (a) => a.type === 'respond_trade' && a.accept,
  );
  const decline =
    options.find((a) => a.type === 'respond_trade' && !a.accept) ?? options[0];
  if (!me || !offer || !accept) return decline;

  // Their `give` comes to us; their `receive` is what we hand over.
  const gaining = Object.entries(offer.give).some(
    ([k, n]) => (n ?? 0) > 0 && count(me.hand, k as Tradeable) === 0,
  );
  const affordable = Object.entries(offer.receive).every(
    ([k, n]) => count(me.hand, k as Tradeable) >= (n ?? 0) + 1,
  );
  return gaining && affordable ? accept : decline;
}

/** Resolve whatever is blocking the game, sensibly rather than at random. */
function chooseBlocking(
  state: GameState,
  playerId: PlayerId,
  blocking: GameAction[],
): GameAction {
  const discard = pick(blocking, 'discard');
  if (discard) return discard; // legal.ts already suggests a sensible split

  // Put the robber where it hurts the leader most, and never on our own hexes.
  const robber = all(blocking, 'move_robber');
  if (robber.length > 0) {
    const mine = new Set(hexesTouchedBy(state, playerId));
    return best(robber, (a) => {
      const hex = (a as { hex: { q: number; r: number } }).hex;
      const key = `${hex.q},${hex.r}`;
      if (mine.has(key)) return -100;

      let value = 0;
      for (const v of hexVertices(hex)) {
        const s = state.settlements.find((x) => x.vertex === v);
        if (!s || s.owner === playerId) continue;
        const victim = playerById(state, s.owner);
        value += (s.kind === 'city' ? 2 : 1) * (victim ? truePoints(victim) : 1);
      }
      return value;
    });
  }

  const pirate = all(blocking, 'move_pirate');
  if (pirate.length > 0) return pirate[0];

  // Rob whoever is closest to winning and holding the most.
  const steal = all(blocking, 'steal');
  if (steal.length > 0) {
    return best(steal, (a) => {
      const victim = (a as { victim: PlayerId | null }).victim;
      if (!victim) return -1;
      const p = playerById(state, victim);
      return p ? truePoints(p) * 2 + totalCards(p.hand) : 0;
    });
  }

  // Gold: take whatever we are shortest of that the bank can still pay.
  const gold = all(blocking, 'choose_gold');
  if (gold.length > 0) {
    const me = playerById(state, playerId)!;
    return best(gold, (a) => {
      const picks = (a as { resources: Partial<Record<Resource, number>> })
        .resources;
      let score = 0;
      for (const r of RESOURCES) {
        const n = picks[r] ?? 0;
        if (n === 0) continue;
        if (bankStock(state, r) < n) return -100;
        // Prefer what we hold least of, weighted by how useful it is.
        score += n * RESOURCE_VALUE[r] * (3 - Math.min(3, count(me.hand, r)));
      }
      return score;
    });
  }

  // A sacked city is always a city, so give up the least productive one.
  const loss = all(blocking, 'barbarian_loss');
  if (loss.length > 0) {
    return best(loss, (a) =>
      a.type === 'barbarian_loss' ? -evaluateVertex(state, a.vertex) : 0,
    );
  }

  return blocking[0];
}

/** Spend on the highest-value thing available. */
function chooseBuild(
  state: GameState,
  playerId: PlayerId,
  legal: GameAction[],
): GameAction | null {
  // Cities first: two points of production and a step towards a metropolis.
  const cities = all(legal, 'build_city');
  if (cities.length > 0) {
    return best(cities, (a) =>
      evaluateVertex(state, (a as { vertex: VertexId }).vertex),
    );
  }

  const settlements = all(legal, 'build_settlement');
  if (settlements.length > 0) {
    return best(settlements, (a) =>
      evaluateVertex(state, (a as { vertex: VertexId }).vertex),
    );
  }

  // Expansion beats everything else while there is somewhere worth reaching.
  // Knights and improvements used to come first unconditionally, which is how
  // a bot ends a game with three knights, one city and no roads.
  const route = chooseRoute(state, playerId, legal);
  if (route && route.value >= WORTH_BUILDING_TOWARDS) return route.action;

  // Cities & Knights: improvements are cheap points and better card draws.
  // Follow the commodity we are actually accumulating rather than always the
  // same track, which is what taking the first offer amounted to.
  const improvements = all(legal, 'buy_improvement');
  if (improvements.length > 0) {
    const me = playerById(state, playerId)!;
    return best(improvements, (a) =>
      a.type === 'buy_improvement' ? count(me.hand, TRACK_COMMODITY[a.track]) : 0,
    );
  }

  // Keep a knight ready when the barbarians are actually a threat. Standing an
  // army up the moment the ship starts over, every time, is what starved the
  // rest of the turn.
  if (needsDefence(state, playerId)) {
    const activate = pick(legal, 'activate_knight');
    if (activate) return activate;
    const hire = pick(legal, 'build_knight');
    if (hire) return hire;
  }

  // Dev cards are a reasonable sink once there is nowhere good left to build.
  const devCard = pick(legal, 'buy_dev_card');
  if (devCard && all(legal, 'build_settlement').length === 0) return devCard;

  const playCard = pick(legal, 'play_dev_card') ?? pick(legal, 'play_progress_card');
  if (playCard) return playCard;

  // Nothing better to do: still take the best route rather than none at all.
  if (route && incomeFor(state, playerId) < 40) return route.action;

  const wall = pick(legal, 'build_wall');
  if (wall) return wall;

  return null;
}

/**
 * A route is worth laying when it can see a spot roughly as good as a middling
 * settlement. Below that it is wandering, and the resources are better spent.
 */
const WORTH_BUILDING_TOWARDS = 4;

/**
 * Whether to spend on knights now.
 *
 * Cities are what the barbarians take, so a player with none has nothing at
 * risk. Otherwise: keep one knight standing, and add to the muster as the ship
 * closes in.
 */
function needsDefence(state: GameState, playerId: PlayerId): boolean {
  if (!state.options.expansions.citiesAndKnights) return false;
  const cities = state.settlements.filter(
    (s) => s.owner === playerId && s.kind === 'city',
  ).length;
  if (cities === 0) return false;

  const knights = (state.knights ?? []).filter(
    (k) => k.owner === playerId && k.active,
  ).length;
  const imminent = (state.barbarianPosition ?? 0) >= BARBARIAN_ATTACK_AT - 2;
  return knights === 0 || (imminent && knights < cities);
}

// ---------------------------------------------------------------------------
// Trading
// ---------------------------------------------------------------------------

/**
 * Bank trades are free to make as often as we like; asking a human is not.
 *
 * The caps come from `options.botTrade`, and a bot that has already been
 * refused this turn stays quiet for the rest of it.
 */
function chooseTrade(
  state: GameState,
  playerId: PlayerId,
  legal: GameAction[],
): GameAction | null {
  const bank = all(legal, 'bank_trade');
  if (bank.length > 0) {
    const me = playerById(state, playerId)!;
    // Only trade away a genuine surplus, and only for something we are short of.
    const worthwhile = bank.filter((a) => {
      const { give, receive } = a as {
        give: Record<string, number>;
        receive: Record<string, number>;
      };
      const giving = Object.keys(give)[0] as Tradeable;
      const getting = Object.keys(receive)[0] as Tradeable;
      const surplus = count(me.hand, giving) - (give[giving] ?? 0);
      return surplus >= 2 && count(me.hand, getting) === 0;
    });
    if (worthwhile.length > 0) return worthwhile[0];
  }

  // `offer_trade` is never enumerated by legalActions — the space of possible
  // offers is unbounded — so a bot that wants one has to construct it.
  if (!mayAskForTrade(state, playerId)) return null;
  return composeOffer(state, playerId);
}

/**
 * Build one honest, straightforward offer: a card we have three or more of for
 * one we have none of. Nothing clever, and nothing lopsided — a bot that haggles
 * is a bot that gets ignored, and it only gets a handful of asks per game.
 */
function composeOffer(
  state: GameState,
  playerId: PlayerId,
): GameAction | null {
  const me = playerById(state, playerId);
  if (!me) return null;

  const surplus = RESOURCES.filter((r) => count(me.hand, r) >= 3).sort(
    (a, b) => count(me.hand, b) - count(me.hand, a),
  );
  const missing = RESOURCES.filter((r) => count(me.hand, r) === 0).sort(
    (a, b) => RESOURCE_VALUE[b] - RESOURCE_VALUE[a],
  );
  if (surplus.length === 0 || missing.length === 0) return null;

  // Only ask someone who can actually supply it, or the offer is just noise.
  const wanted = missing.find((r) =>
    state.players.some(
      (p) => p.id !== playerId && !p.resigned && count(p.hand, r) > 0,
    ),
  );
  if (!wanted) return null;

  return {
    type: 'offer_trade',
    playerId,
    give: { [surplus[0]]: 1 },
    receive: { [wanted]: 1 },
  };
}

/** The rate limit that keeps bots from nagging. */
export function mayAskForTrade(state: GameState, playerId: PlayerId): boolean {
  const caps = state.options.botTrade;
  if (!caps || caps.maxPerGame <= 0) return false;

  const me = playerById(state, playerId);
  if (!me) return false;

  // Only a bot seat is rate-limited, so only a bot seat may use this policy to
  // offer. Proposing on behalf of a human would bypass the caps entirely — the
  // counters in base.ts deliberately only tick for bots.
  if (!me.isBot) return false;

  if ((me.botTradesMade ?? 0) >= caps.maxPerGame) return false;
  if ((me.botTradesThisTurn ?? 0) >= caps.maxPerTurn) return false;
  // Asked once and turned down already: leave it alone until next turn.
  if ((state.botTradeRefusals?.[playerId] ?? 0) > 0) return false;

  // Never haggle with another bot; it is noise nobody sees.
  const humans = state.players.filter(
    (p) => !p.isBot && !p.resigned && p.id !== playerId,
  );
  return humans.length > 0;
}

/**
 * Drive every consecutive bot turn to completion.
 *
 * The server calls this after each human action so the humans only ever see a
 * state where it is someone's turn to act. `maxSteps` is a safety net: a bug
 * that makes a bot loop must not hang the request.
 */
export function runBots(
  state: GameState,
  apply: (s: GameState, a: GameAction) => GameState | null,
  maxSteps = 500,
): GameState {
  let current = state;
  for (let i = 0; i < maxSteps; i++) {
    if (current.phase === 'game_over') break;

    // A bot acts when it is their turn, when the rules are waiting on them, or
    // when they owe an answer to a trade offer — that last case has no pending
    // entry and is not their turn, so it needs naming explicitly or an offer to
    // a bot would hang the table forever.
    const owed = current.pending.find((t) => t.kind !== 'resume');
    const responder =
      current.phase === 'trade_response'
        ? tradeResponders(current).find(
            (id) => playerById(current, id)?.isBot,
          )
        : undefined;
    const actorId =
      owed?.playerId ?? responder ?? current.players[current.currentPlayer]?.id;
    const actor = actorId ? playerById(current, actorId) : undefined;
    if (!actor?.isBot || actor.resigned) break;

    const action = chooseAction(current, actor.id);
    if (!action) break;

    const next = apply(current, { ...action, playerId: actor.id });
    if (!next) break; // the action was refused; stop rather than spin
    current = next;
  }
  return current;
}
