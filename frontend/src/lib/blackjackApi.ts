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

export interface DailyGameView extends GameView {
  cash_out: false;
  seed: number;
}

export interface DailyGameResult {
  cash_out: true;
  score: number;
  seed: number;
}

export interface HighScoreEntry {
  id: number;
  user_id: number;
  username: string;
  score: number;
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
export async function createDailyGame(userId: number): Promise<DailyGameView | DailyGameResult> {
  const res = await fetch(`${BASE}/daily/${userId}`, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.detail ?? "Could not load daily game");
  return data;
}
export async function cashOutDailyGame(userId: number): Promise<{ score: number; cash_out: true }> {
  const res = await fetch(`${BASE}/daily/${userId}/cashout`, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.detail ?? "Could not cash out");
  return data;
}
export async function uploadHighScore(userId: number, score: number): Promise<void> {
  const res = await fetch(`${BASE}/high_scores`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, score }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.detail ?? "Could not upload high score");
}
export async function getHighScores(): Promise<HighScoreEntry[]> {
  const res = await fetch(`${BASE}/high_scores`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.detail ?? "Could not load leaderboard");
  return data as HighScoreEntry[];
}
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
