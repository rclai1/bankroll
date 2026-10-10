export type GameStatus = "waiting_for_bet" | "playing" | "finished";
export type GameResult = "win" | "loss" | "push" | "blackjack" | null;

export interface GameView {
  game_id: string;
  bankroll: number;
  bet_amount: number;
  status: GameStatus;
  player_hand: string[];
  player_score: number;
  dealer_hand: string[];
  dealer_score: number | null;
  result: GameResult;
}

export interface LearningAdvice {
  best_move: "hit" | "stand";
  /** Expected net bankroll change, in dollars, from this point in the hand. */
  hit_ev: number;
  stand_ev: number;
  bet_amount: number;
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
  return data as GameView;
}

export const createGame = (bankroll = 100) => request("/games", { bankroll });
export const placeBet = (id: string, amount: number) =>
  request(`/games/${id}/bet`, { amount });
export const hit = (id: string) => request(`/games/${id}/hit`);
export const stand = (id: string) => request(`/games/${id}/stand`);

export async function getLearningAdvice(id: string): Promise<LearningAdvice> {
  const res = await fetch(`${BASE}/games/${id}/advice`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.detail;
    throw new Error(typeof detail === "string" ? detail : "Could not calculate advice");
  }
  return data as LearningAdvice;
}
