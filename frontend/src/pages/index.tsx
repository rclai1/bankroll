import { FormEvent, useState } from "react";
import atlas from "@/assets/standard/PC _ Computer - Balatro - Playing Cards - Playing Cards.png";

type Game = {
  game_id: string;
  bankroll: number;
  bet_amount: number;
  status: "waiting_for_bet" | "playing" | "finished";
  player_hand: string[];
  player_score: number;
  dealer_hand: string[];
  dealer_score: number | null;
  result: string | null;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const SUIT_ROWS: Record<string, number> = { hearts: 0, clubs: 1, diamonds: 2, spades: 3 };

function Card({ card, hidden = false }: { card: string; hidden?: boolean }) {
  if (hidden) return <div className="playing-card card-back" aria-label="Hidden dealer card" />;
  const [rank, , suit] = card.split(" ");
  const column = RANKS.indexOf(rank);
  const row = SUIT_ROWS[suit] ?? 0;
  return <div className="playing-card" aria-label={card} style={{ backgroundImage: `url("${atlas.src}")`, backgroundPosition: `${column * -71}px ${row * -95}px` }} />;
}

function money(value: number) {
  return `$${value.toFixed(2)}`;
}

export default function Home() {
  const [game, setGame] = useState<Game | null>(null);
  const [bankroll, setBankroll] = useState("100");
  const [bet, setBet] = useState("10");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function request(path: string, options?: RequestInit) {
    const response = await fetch(`${API_URL}${path}`, { headers: { "Content-Type": "application/json" }, ...options });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail ?? "Something went wrong");
    return data as Game;
  }

  async function startGame(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      setGame(await request("/games", { method: "POST", body: JSON.stringify({ bankroll: Number(bankroll) }) }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start game");
    } finally {
      setBusy(false);
    }
  }

  async function play(path: string, body?: object) {
    if (!game) return;
    setBusy(true);
    setMessage("");
    try {
      setGame(await request(`/games/${game.game_id}${path}`, { method: "POST", body: body ? JSON.stringify(body) : undefined }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The table could not be updated");
    } finally {
      setBusy(false);
    }
  }

  if (!game) {
    return <main className="welcome-shell"><section className="welcome-panel"><div className="brand-mark">♠</div><p className="eyebrow">The house is ready</p><h1>Make your move.</h1><p className="welcome-copy">A clean table, a fresh deck, and just enough nerve to beat the dealer.</p><form className="start-form" onSubmit={startGame}><label htmlFor="bankroll">Starting bankroll</label><div className="money-input"><span>$</span><input id="bankroll" type="number" min="1" step="0.01" value={bankroll} onChange={(event) => setBankroll(event.target.value)} /></div><button className="primary-button" disabled={busy} type="submit">{busy ? "Opening table..." : "Take a seat"}<span>→</span></button></form>{message && <p className="error-message">{message}</p>}</section><aside className="welcome-aside"><div className="mini-card mini-red">♥</div><div className="mini-card mini-dark">♣</div><p>BLACKJACK<br /><span>21</span></p></aside></main>;
  }

  const isPlaying = game.status === "playing";
  const canBet = game.status !== "playing";
  const resultLabels: Record<string, string> = { win: "You win", loss: "Dealer wins", push: "Push", blackjack: "Blackjack" };
  const tableMessage = message || (game.result ? resultLabels[game.result] ?? game.result : "");
  return <main className="table-shell"><header className="topbar"><div className="wordmark"><span>♠</span> BANKROLL</div><div className="table-status"><span className="live-dot" /> LIVE TABLE <b>#{game.game_id.slice(0, 6).toUpperCase()}</b></div><button className="quiet-button" onClick={() => setGame(null)}>Leave table</button></header><section className="table-layout"><div className="felt"><div className="felt-heading"><p className="eyebrow">Classic table</p><h1>Blackjack</h1><span className="rule">Dealer stands on 17</span></div><div className="hand dealer-hand"><div className="hand-label"><span>Dealer</span><b>{game.dealer_score ?? "?"}</b></div><div className="cards">{game.dealer_hand.map((card, index) => <Card key={`${card}-${index}`} card={card} hidden={isPlaying && index === 1} />)}</div></div><div className="table-divider"><span>♠</span></div><div className="hand player-hand"><div className="hand-label"><span>You</span><b>{game.player_score}</b></div><div className="cards">{game.player_hand.map((card, index) => <Card key={`${card}-${index}`} card={card} />)}</div></div>{tableMessage && <div className={`result-banner ${game.result === "loss" ? "loss" : ""}`}>{tableMessage}</div>}</div><aside className="control-panel"><div><p className="eyebrow">Your balance</p><div className="balance">{money(game.bankroll)}</div></div><div className="panel-rule" /><div className="bet-section"><label htmlFor="bet">Wager</label><div className="money-input"><span>$</span><input id="bet" type="number" min="0.01" max={game.bankroll} step="0.01" value={bet} onChange={(event) => setBet(event.target.value)} disabled={!canBet} /></div><div className="quick-bets"><button onClick={() => setBet("5")} disabled={!canBet}>$5</button><button onClick={() => setBet("10")} disabled={!canBet}>$10</button><button onClick={() => setBet(String(Math.floor(game.bankroll / 2)))} disabled={!canBet}>½</button></div></div><button className="primary-button deal-button" disabled={busy || !canBet || Number(bet) <= 0} onClick={() => play("/bet", { amount: Number(bet) })}>{busy ? "Dealing..." : game.status === "finished" ? "Deal again" : "Deal cards"}<span>→</span></button><div className="action-buttons"><button onClick={() => play("/hit")} disabled={busy || !isPlaying}>Hit</button><button onClick={() => play("/stand")} disabled={busy || !isPlaying}>Stand</button></div><p className="panel-note">Cards are dealt from a freshly shuffled deck for every round.</p></aside></section></main>;
}
