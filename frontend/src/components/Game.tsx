import { useEffect, useRef, useState } from "react";
import Card, { CARD_H, EmptySlot } from "./Card";
import { AnimatedMoney, FloatingMoney, formatMoney, type FloatMoney } from "./Money";
import {
  createGame,
  hit,
  placeBet,
  stand,
  type GameResult,
  type GameView,
} from "@/lib/blackjackApi";

const RESULT_TEXT: Record<NonNullable<GameResult>, string> = {
  win: "You win!",
  blackjack: "Blackjack!",
  push: "Push",
  loss: "You lose",
};

// Seconds before each card of the opening deal slides in (player, dealer, player, dealer).
const PLAYER_DEAL_DELAY = [0, 0.5];
const DEALER_DEAL_DELAY = [0.25, 0.75];

const round2 = (n: number) => Math.round(n * 100) / 100;

export default function Game({ onExit }: { onExit: () => void }) {
  const [game, setGame] = useState<GameView | null>(null);
  const [bet, setBet] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // False after a round finishes until the player clicks "Next round".
  const [betting, setBetting] = useState(true);
  // Incremented per deal so each round's cards remount (and animate in again).
  const [round, setRound] = useState(0);
  // ms to wait after a response before showing the outcome (lets cards finish).
  const [settleDelay, setSettleDelay] = useState(0);
  const [floats, setFloats] = useState<FloatMoney[]>([]);
  const floatId = useRef(0);

  function pushFloat(text: string, kind: FloatMoney["kind"], delay: number) {
    const id = ++floatId.current;
    setFloats((f) => [...f, { id, text, kind, delay }]);
    setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), delay + 1800);
  }

  function announce(before: number, next: GameView, betAmount?: number) {
    const afterBet = betAmount ? round2(before - betAmount) : before;
    const delay = next.dealer_hand.length > 2 ? 1500 : next.status === "finished" ? 1000 : 0;
    setSettleDelay(next.status === "finished" ? delay : 0);

    if (betAmount) pushFloat(`-${formatMoney(betAmount)}`, "loss", 0);
    if (next.status === "finished") {
      const gain = round2(next.bankroll - afterBet);
      if (gain > 0) pushFloat(`+${formatMoney(gain)}`, "win", delay);
      else if (next.result === "loss") pushFloat(`-${formatMoney(next.bet_amount)}`, "loss", delay);
    }
  }

  async function run(action: () => Promise<GameView>, betAmount?: number) {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      if (betAmount) setRound((r) => r + 1);
      announce(game?.bankroll ?? 0, next, betAmount);
      setGame(next);
      if (betAmount) setBetting(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    createGame()
      .then((g) => {
        if (!cancelled) setGame(g);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not reach the server");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!game) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4">
        <div className="glass flex flex-col items-center gap-4 px-10 py-8">
          <p className={error ? "error-text" : "hand-title"}>{error ?? "Loading..."}</p>
          {error && (
            <button className="btn" onClick={onExit}>
              Back to menu
            </button>
          )}
        </div>
      </main>
    );
  }

  const showBetForm = game.status !== "playing" && betting;
  const dealerRevealed = game.status !== "playing";
  const broke = game.bankroll <= 0;
  const hasCards = game.player_hand.length > 0;
  // While playing the API only sends the up card; show the hole card face-down.
  // Keeping it in the same array keeps the element stable so it flips on reveal.
  const dealerCards: (string | undefined)[] =
    game.status === "playing" ? [...game.dealer_hand, undefined] : game.dealer_hand;
  const outcome = game.status === "finished" ? game.result : null;
  const chipClass = outcome === "loss" ? "loss" : outcome === "push" ? "push" : "win";

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 px-4 py-6">
      <header className="flex w-full max-w-4xl items-stretch gap-3">
        <div className="glass relative flex flex-1 flex-col px-5 py-3">
          <span className="label">Bankroll</span>
          <span>
            <span className="coin" />
            <AnimatedMoney value={game.bankroll} delay={game.status === "finished" ? settleDelay : 0} />
          </span>
          <FloatingMoney items={floats.filter((f) => f.kind === "win" || f.delay === 0)} />
        </div>
        <div className="glass flex flex-col px-5 py-3">
          <span className="label">Bet</span>
          <span className="money">{formatMoney(game.bet_amount)}</span>
        </div>
        <button className="btn btn-orange self-center" onClick={onExit}>
          Menu
        </button>
      </header>

      <section className="glass flex w-full max-w-4xl flex-col items-center gap-6 px-4 py-6">
        <div className="flex flex-col items-center gap-2">
          <h2 className="hand-title">
            Dealer
            {dealerRevealed && game.dealer_score !== null && (
              <span className="score-badge">{game.dealer_score}</span>
            )}
          </h2>
          <div className="flex flex-wrap justify-center gap-2" style={{ minHeight: CARD_H }}>
            {!hasCards && (
              <>
                <EmptySlot />
                <EmptySlot />
              </>
            )}
            {dealerCards.map((c, i) => (
              <Card
                key={`${round}-d${i}`}
                card={c}
                delay={i < 2 ? DEALER_DEAL_DELAY[i] : 0.9 + (i - 2) * 0.5}
              />
            ))}
          </div>
        </div>

        <div className="relative flex h-20 items-center justify-center">
          {hasCards && !broke && (
            <div
              key={round}
              className={`chip-wrap ${outcome ? chipClass : ""}`}
              style={outcome ? { animationDelay: `${settleDelay}ms` } : undefined}
            >
              <div className="chip">${game.bet_amount}</div>
            </div>
          )}
          {outcome && (
            <div
              key={`result-${round}`}
              className={`result-banner ${outcome} absolute`}
              style={{ animationDelay: `${settleDelay}ms` }}
            >
              {RESULT_TEXT[outcome]}
            </div>
          )}
          <FloatingMoney items={floats.filter((f) => f.kind === "loss" && f.delay > 0)} />
        </div>

        <div className="flex flex-col items-center gap-2">
          <div className="flex flex-wrap justify-center gap-2" style={{ minHeight: CARD_H }}>
            {!hasCards && (
              <>
                <EmptySlot />
                <EmptySlot />
              </>
            )}
            {game.player_hand.map((c, i) => (
              <Card
                key={`${round}-p${i}`}
                card={c}
                delay={i < 2 ? PLAYER_DEAL_DELAY[i] : 0}
              />
            ))}
          </div>
          <h2 className="hand-title">
            You
            {hasCards && <span className="score-badge">{game.player_score}</span>}
          </h2>
        </div>
      </section>

      <div className="flex min-h-16 flex-col items-center gap-3">
        {game.status === "playing" && (
          <div className="fade-in flex gap-3">
            <button className="btn btn-green" disabled={busy} onClick={() => run(() => hit(game.game_id))}>
              Hit
            </button>
            <button className="btn btn-orange" disabled={busy} onClick={() => run(() => stand(game.game_id))}>
              Stand
            </button>
          </div>
        )}

        {game.status === "finished" && !betting && (
          <div
            className="fade-in flex gap-3"
            style={{ animationDelay: `${settleDelay}ms` }}
          >
            {broke ? (
              <button
                className="btn btn-green"
                disabled={busy}
                onClick={() => {
                  setBetting(true);
                  setSettleDelay(0);
                  run(() => createGame());
                }}
              >
                Out of money, new game
              </button>
            ) : (
              <button className="btn btn-green" onClick={() => setBetting(true)}>
                Next round
              </button>
            )}
          </div>
        )}

        {showBetForm && !broke && (
          <form
            className="fade-in glass flex items-center gap-3 px-5 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => placeBet(game.game_id, bet), bet);
            }}
          >
            <label className="flex items-center gap-2 font-bold">
              Bet $
              <input
                type="number"
                min={1}
                max={game.bankroll}
                step="any"
                value={bet}
                onChange={(e) => setBet(Number(e.target.value))}
                className="aero-input"
              />
            </label>
            <button className="btn btn-green" disabled={busy || !(bet > 0)}>
              Deal
            </button>
          </form>
        )}

        {error && <p className="error-text">{error}</p>}
      </div>
    </main>
  );
}
