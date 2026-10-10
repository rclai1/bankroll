import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Card, { CARD_H, CARD_W, EmptySlot } from "./Card";
import { AnimatedMoney, FloatingMoney, formatMoney, type FloatMoney } from "./Money";
import { createGame, hit, placeBet, stand, type GameView } from "@/lib/blackjackApi";
import { score } from "@/lib/scoring";
import { betSteps, hitSteps, standSteps, type StepApi } from "@/lib/roundSteps";
import { INITIAL_SHOWN, useRoundTimeline } from "@/hooks/useRoundTimeline";
import { TIMING } from "@/config/timing";
import { ROUND_EVENTS, getRoundEvent } from "@/config/messages";
import { MODES_BY_ID, type ModeId } from "@/config/modes";
import { play, useBgm } from "@/audio/useSound";
import { selectDealSound, selectHitSound } from "@/audio/soundConfig";

const round2 = (n: number) => Math.round(n * 100) / 100;

function useHandLayoutAnimation(layoutKey: string) {
  const ref = useRef<HTMLDivElement>(null);
  const previousPositions = useRef(new Map<string, { left: number; top: number }>());

  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;

    const currentPositions = new Map<string, { left: number; top: number }>();
    container.querySelectorAll<HTMLElement>("[data-hand-card]").forEach((card) => {
      const key = card.dataset.handCard;
      if (!key) return;
      const rect = card.getBoundingClientRect();
      currentPositions.set(key, { left: rect.left, top: rect.top });
    });

    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      currentPositions.forEach((position, key) => {
        const previous = previousPositions.current.get(key);
        if (!previous) return;
        const x = previous.left - position.left;
        const y = previous.top - position.top;
        if (Math.abs(x) < 1 && Math.abs(y) < 1) return;

        const card = container.querySelector<HTMLElement>(`[data-hand-card="${key}"]`);
        card?.animate(
          [{ transform: `translate(${x}px, ${y}px)` }, { transform: "translate(0, 0)" }],
          { duration: 260, easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" },
        );
      });
    }

    previousPositions.current = currentPositions;
  }, [layoutKey]);

  return ref;
}

export default function Game({ mode, onExit }: { mode: ModeId; onExit: () => void }) {
  useBgm(MODES_BY_ID[mode].bgm);

  const [game, setGame] = useState<GameView | null>(null);
  const [bet, setBet] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // False after a round finishes until the player clicks "Next round".
  const [betting, setBetting] = useState(true);
  const [floats, setFloats] = useState<FloatMoney[]>([]);
  const floatId = useRef(0);
  const { shown, setShown, play: playTimeline } = useRoundTimeline();
  const dealerHandRef = useHandLayoutAnimation(`${game?.game_id ?? "loading"}:${shown.round}:${shown.dDealt}`);
  const playerHandRef = useHandLayoutAnimation(`${game?.game_id ?? "loading"}:${shown.round}:${shown.pDealt}`);

  function pushFloat(text: string, kind: FloatMoney["kind"], where: FloatMoney["where"]) {
    const id = ++floatId.current;
    setFloats((f) => [...f, { id, text, kind, where, delay: 0 }]);
    setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 1800);
  }

  /** Runs when the timeline finishes: payout, result sound. */
  function settleRound(view: GameView, afterBet: number) {
    setShown((s) => ({ ...s, bankroll: view.bankroll, settled: true, phase: "settled" }));
    const gain = round2(view.bankroll - afterBet);
    if (gain > 0) pushFloat(`+${formatMoney(gain)}`, "win", "bank");
    else if (view.result === "loss") pushFloat(`-${formatMoney(view.bet_amount)}`, "loss", "table");

    const sfx = ROUND_EVENTS[getRoundEvent(view)].sfx;
    if (sfx) play(sfx);
  }

  async function run(kind: "bet" | "hit" | "stand", amount = 0) {
    if (!game) return;
    setBusy(true);
    setError(null);
    try {
      const next =
        kind === "bet"
          ? await placeBet(game.game_id, amount)
          : kind === "hit"
            ? await hit(game.game_id)
            : await stand(game.game_id);

      // The bet is taken from the bankroll at deal time; hit/stand see it already gone.
      const afterBet = kind === "bet" ? round2(game.bankroll - amount) : game.bankroll;
      const api: StepApi = {
        set: (patch) => setShown((s) => ({ ...s, ...patch })),
        sfx: play,
        settle: () => settleRound(next, afterBet),
      };

      setGame(next);
      if (kind === "bet") {
        setBetting(false);
        // Reset what is visible and show the money leaving first; cards follow.
        setShown((s) => ({
          ...s,
          round: s.round + 1,
          phase: "withdrawing",
          pDealt: 0,
          pRevealed: 0,
          dDealt: 0,
          dRevealed: 0,
          settled: false,
          bet: amount,
          bankroll: afterBet,
        }));
        pushFloat(`-${formatMoney(amount)}`, "loss", "bank");
        play("money.withdraw");
        playTimeline(betSteps(next, api));
      } else {
        playTimeline((kind === "hit" ? hitSteps : standSteps)(next, api));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function startNewGame() {
    setBetting(true);
    createGame()
      .then((g) => {
        setGame(g);
        setShown((s) => ({ ...INITIAL_SHOWN, round: s.round, bankroll: g.bankroll }));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not reach the server"));
  }

  useEffect(() => {
    let cancelled = false;
    createGame()
      .then((g) => {
        if (cancelled) return;
        setGame(g);
        setShown((s) => ({ ...s, bankroll: g.bankroll }));
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not reach the server");
      });
    return () => {
      cancelled = true;
    };
  }, [setShown]);

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

  const idleOrSettled = shown.phase === "idle" || shown.phase === "settled";
  const showBetForm = betting && game.status !== "playing" && idleOrSettled;
  const broke = game.bankroll <= 0;
  const hasCards = shown.pDealt > 0 || shown.dDealt > 0;

  // Only flipped cards count towards the displayed totals.
  const playerScore = shown.pRevealed > 0 ? score(game.player_hand.slice(0, shown.pRevealed)) : null;
  const dealerScore = shown.dRevealed > 0 ? score(game.dealer_hand.slice(0, shown.dRevealed)) : null;

  const playerCards = game.player_hand.slice(0, shown.pDealt);
  // The hole card is unknown to the client until the round ends (undefined entry).
  const dealerCards = Array.from({ length: shown.dDealt }, (_, i) => game.dealer_hand[i]);

  const settledKey = shown.settled && game.status === "finished" ? getRoundEvent(game) : null;
  const chipOutcome = settledKey ? ROUND_EVENTS[settledKey].tone === "loss" ? "loss" : ROUND_EVENTS[settledKey].tone === "push" ? "push" : "win" : "";
  // The banner and effects clear once the player moves on to the next round.
  const eventKey = betting ? null : settledKey;
  const event = eventKey ? ROUND_EVENTS[eventKey] : null;
  const natural = event?.effect === "natural";
  const glowPlayer = natural && (eventKey === "playerNatural" || eventKey === "bothNatural");
  const glowDealer = natural && (eventKey === "dealerNatural" || eventKey === "bothNatural");

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 px-4 py-6">
      {natural && <div key={`flash-${shown.round}`} className="natural-flash" />}

      <header className="flex w-full max-w-4xl items-stretch gap-3">
        <div className="glass relative flex flex-1 flex-col px-5 py-3">
          <span className="label">Bankroll</span>
          <span>
            <span className="coin" />
            <AnimatedMoney value={shown.bankroll} duration={TIMING.MONEY_TWEEN_MS} />
          </span>
          <FloatingMoney items={floats.filter((f) => f.where === "bank")} />
        </div>
        <div className="glass flex flex-col px-5 py-3">
          <span className="label">Bet</span>
          <span className="money">{formatMoney(shown.bet)}</span>
        </div>
        <button className="btn btn-orange self-center" onClick={onExit}>
          Menu
        </button>
      </header>

      <section className="glass flex w-full max-w-4xl flex-col items-center gap-6 px-4 py-6">
        <div className="flex flex-col items-center gap-2">
          <h2 className="hand-title">
            Dealer
            {dealerScore !== null && <span className="score-badge">{dealerScore}</span>}
          </h2>
          <div ref={dealerHandRef} className="flex w-full flex-wrap justify-start gap-2" style={{ minHeight: CARD_H }}>
            {!hasCards && (
              <>
                <EmptySlot />
                <EmptySlot />
              </>
            )}
            {dealerCards.map((c, i) => (
              <div
                key={`${shown.round}-d${i}`}
                data-hand-card={`${shown.round}-d${i}`}
                className="card-hand-item"
                style={{ width: CARD_W, height: CARD_H }}
              >
                <Card card={c} faceUp={i < shown.dRevealed} glow={glowDealer && i < 2} />
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex h-24 items-center justify-center">
          {shown.round > 0 && (
            <div
              key={shown.round}
              className={`chip-wrap ${chipOutcome}`}
            >
              <div className="chip">${shown.bet}</div>
            </div>
          )}
          {event && (
            <div
              key={`result-${shown.round}`}
              className="absolute flex flex-col items-center gap-1"
            >
              <div className={`result-banner ${event.tone}${natural ? " natural" : ""}`}>
                {event.banner}
              </div>
              {event.subtitle && <div className="result-subtitle">{event.subtitle}</div>}
            </div>
          )}
          <FloatingMoney items={floats.filter((f) => f.where === "table")} />
        </div>

        <div className="flex flex-col items-center gap-2">
          <div ref={playerHandRef} className="flex w-full flex-wrap justify-start gap-2" style={{ minHeight: CARD_H }}>
            {!hasCards && (
              <>
                <EmptySlot />
                <EmptySlot />
              </>
            )}
            {playerCards.map((c, i) => (
              <div
                key={`${shown.round}-p${i}`}
                data-hand-card={`${shown.round}-p${i}`}
                className="card-hand-item"
                style={{ width: CARD_W, height: CARD_H }}
              >
                <Card card={c} faceUp={i < shown.pRevealed} glow={glowPlayer && i < 2} />
              </div>
            ))}
          </div>
          <h2 className="hand-title">
            You
            {playerScore !== null && <span className="score-badge">{playerScore}</span>}
          </h2>
        </div>
      </section>

      <div className="flex min-h-16 flex-col items-center gap-3">
        {game.status === "playing" && shown.phase === "player" && (
          <div className="fade-in flex gap-3">
            <button
              className="btn btn-green"
              disabled={busy}
              onClick={() => {
                play(
                  selectHitSound({
                    bet: game.bet_amount,
                    bankrollBeforeBet: game.bankroll + game.bet_amount,
                    playerScore: game.player_score,
                  }),
                );
                run("hit");
              }}
            >
              Hit
            </button>
            <button
              className="btn btn-orange"
              disabled={busy}
              onClick={() => {
                play("stand");
                run("stand");
              }}
            >
              Stand
            </button>
          </div>
        )}

        {game.status === "finished" && shown.settled && !betting && (
          <div className="fade-in flex gap-3">
            {broke ? (
              <button
                className="btn btn-green"
                disabled={busy}
                onClick={() => {
                  play("nextRound");
                  startNewGame();
                }}
              >
                Out of money, new game
              </button>
            ) : (
              <button
                className="btn btn-green"
                onClick={() => {
                  play("nextRound");
                  setBetting(true);
                }}
              >
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
              play(selectDealSound(bet, game.bankroll));
              run("bet", bet);
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
