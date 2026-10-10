import { useEffect, useState } from "react";
import Card from "./Card";
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
  blackjack: "Blackjack! Pays 3:2",
  push: "Push",
  loss: "You lose",
};

const btn =
  "rounded-lg bg-white px-6 py-2 font-semibold text-green-900 hover:bg-green-100 disabled:opacity-50";

export default function Game({ onExit }: { onExit: () => void }) {
  const [game, setGame] = useState<GameView | null>(null);
  const [bet, setBet] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // False after a round finishes until the player clicks "Next round".
  const [betting, setBetting] = useState(true);

  async function run(action: () => Promise<GameView>) {
    setBusy(true);
    setError(null);
    try {
      setGame(await action());
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
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Could not reach the server");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!game) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-green-900 text-white">
        <p>{error ?? "Loading..."}</p>
        {error && (
          <button className={btn} onClick={onExit}>
            Back to menu
          </button>
        )}
      </main>
    );
  }

  const showBetForm = game.status !== "playing" && betting;
  const dealerRevealed = game.status !== "playing";
  const broke = game.bankroll <= 0;

  return (
    <main className="flex min-h-screen flex-col items-center gap-8 bg-green-900 px-4 py-8 text-white">
      <div className="flex w-full max-w-3xl justify-between text-lg">
        <span>Bankroll: ${game.bankroll}</span>
        <span>Bet: ${game.bet_amount}</span>
        <button className="underline" onClick={onExit}>
          Menu
        </button>
      </div>

      <section className="flex flex-col items-center gap-2">
        <h2 className="font-semibold">
          Dealer
          {dealerRevealed && game.dealer_score !== null ? ` (${game.dealer_score})` : ""}
        </h2>
        <div className="flex min-h-[190px] gap-2">
          {game.dealer_hand.map((c, i) => (
            <Card key={i} card={c} />
          ))}
          {game.status === "playing" && <Card />}
        </div>
      </section>

      <section className="flex flex-col items-center gap-2">
        <h2 className="font-semibold">
          You{game.player_hand.length ? ` (${game.player_score})` : ""}
        </h2>
        <div className="flex min-h-[190px] gap-2">
          {game.player_hand.map((c, i) => (
            <Card key={i} card={c} />
          ))}
        </div>
      </section>

      {game.status === "finished" && game.result && (
        <p className="text-2xl font-bold">{RESULT_TEXT[game.result]}</p>
      )}

      <div className="flex flex-col items-center gap-3">
        {game.status === "playing" && (
          <div className="flex gap-3">
            <button className={btn} disabled={busy} onClick={() => run(() => hit(game.game_id))}>
              Hit
            </button>
            <button className={btn} disabled={busy} onClick={() => run(() => stand(game.game_id))}>
              Stand
            </button>
          </div>
        )}

        {game.status === "finished" && !betting && (
          <div className="flex gap-3">
            {broke ? (
              <button
                className={btn}
                disabled={busy}
                onClick={() => {
                  setBetting(true);
                  run(() => createGame());
                }}
              >
                Out of money, new game
              </button>
            ) : (
              <button className={btn} onClick={() => setBetting(true)}>
                Next round
              </button>
            )}
          </div>
        )}

        {showBetForm && !broke && (
          <form
            className="flex items-center gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setBetting(false);
              run(() => placeBet(game.game_id, bet));
            }}
          >
            <label className="flex items-center gap-2">
              Bet $
              <input
                type="number"
                min={1}
                max={game.bankroll}
                step="any"
                value={bet}
                onChange={(e) => setBet(Number(e.target.value))}
                className="w-24 rounded px-2 py-1 text-black"
              />
            </label>
            <button className={btn} disabled={busy || !(bet > 0)}>
              Deal
            </button>
          </form>
        )}

        {error && <p className="text-red-300">{error}</p>}
      </div>
    </main>
  );
}
