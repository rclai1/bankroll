export type GameStatus = "waiting_for_bet" | "playing" | "finished";
export type GameResult = "win" | "loss" | "push" | "blackjack" | "surrender" | null;
export type PlayerStatus = "active" | "stood" | "double_down" | "surrender" | "bust" | "out";
export type ActionName = "hit" | "stand" | "double_down" | "surrender";

/** One seat at the table as the API sends it (index 0 is the human). */
export interface Player {
  index: number;
  kind: "human" | "cpu";
  bankroll: number;
  bet_amount: number;
  hand: string[];
  score: number;
  player_status: PlayerStatus;
  result: GameResult;
  /** What this seat may do right now (empty unless it is their turn). */
  legal_actions: ActionName[];
}

/** Something that happened during the latest request (bets, hits, dealer draws...). */
export interface GameEvent {
  actor: "player" | "dealer";
  action: string;
  index?: number;
  card?: string;
  amount?: number;
}

interface RawGame {
  game_id: string;
  status: GameStatus;
  pot_amount: number;
  current_player: number | null;
  players: Player[];
  dealer_hand: string[];
  dealer_score: number | null;
  events: GameEvent[];
}

/**
 * The game as the UI uses it: the human's seat flattened onto the top level
 * (so the single-player UI stays simple) plus the raw `players`/`events`
 * for when CPU seats get rendered.
 */
export interface GameView {
  game_id: string;
  status: GameStatus;
  bankroll: number;
  bet_amount: number;
  player_hand: string[];
  player_score: number;
  player_status: PlayerStatus;
  legal_actions: ActionName[];
  result: GameResult;
  dealer_hand: string[];
  dealer_score: number | null;
  pot_amount: number;
  current_player: number | null;
  players: Player[];
  events: GameEvent[];
}

function normalize(raw: RawGame): GameView {
  const human = raw.players[0];
  return {
    game_id: raw.game_id,
    status: raw.status,
    bankroll: human.bankroll,
    bet_amount: human.bet_amount,
    player_hand: human.hand,
    player_score: human.score,
    player_status: human.player_status,
    legal_actions: human.legal_actions,
    result: human.result,
    dealer_hand: raw.dealer_hand,
    dealer_score: raw.dealer_score,
    pot_amount: raw.pot_amount,
    current_player: raw.current_player,
    players: raw.players,
    events: raw.events,
  };
}

const BASE = "/api/blackjack";

async function request(path: string, body?: unknown): Promise<GameView> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.detail;
    throw new Error(typeof detail === "string" ? detail : "Request failed");
  }
  return normalize(data as RawGame);
}

/** `cpuCount` seats up to 2 CPU players (the UI does not render them yet). */
export const createGame = (bankroll = 100, cpuCount = 0) =>
  request("/games", { bankroll, cpu_count: cpuCount });
export const placeBet = (id: string, amount: number) =>
  request(`/games/${id}/bet`, { amount });
export const hit = (id: string) => request(`/games/${id}/hit`);
export const stand = (id: string) => request(`/games/${id}/stand`);
export const doubleDown = (id: string) => request(`/games/${id}/double`);
export const surrender = (id: string) => request(`/games/${id}/surrender`);
/** Plays one CPU action; takes about 3-15 s. Call while a CPU is the current player. */
export const cpuTurn = (id: string) => request(`/games/${id}/cpu_turn`);
