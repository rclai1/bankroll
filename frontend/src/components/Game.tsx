import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Card, { CARD_H, CARD_W, EmptySlot } from "./Card";
import { AnimatedMoney, FloatingMoney, formatMoney, type FloatMoney } from "./Money";
import { createGame, getLearningAdvice, hit, placeBet, stand, type GameView, type LearningAdvice } from "@/lib/blackjackApi";
import { score } from "@/lib/scoring";
import { betSteps, hitSteps, standSteps, type StepApi } from "@/lib/roundSteps";
import { INITIAL_SHOWN, useRoundTimeline } from "@/hooks/useRoundTimeline";
import { TIMING } from "@/config/timing";
import { ROUND_EVENTS, getRoundEvent } from "@/config/messages";
import { MODES_BY_ID, type ModeId } from "@/config/modes";
import { play, useBgm } from "@/audio/useSound";
import { selectDealSound, selectHitSound } from "@/audio/soundConfig";

const round2 = (n: number) => Math.round(n * 100) / 100;
const LEARNING_INTRO_STORAGE_KEY = "learning-mode-intro-seen-v2";

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
  const [adviceState, setAdviceState] = useState<{
    key: string;
    advice?: LearningAdvice;
    error?: string;
  } | null>(null);
  const [showLearningIntro, setShowLearningIntro] = useState(false);
  const [showEVExplanation, setShowEVExplanation] = useState(false);
  const [evExplanation, setEVExplanation] = useState<string | null>(null);
  const [evExplanationError, setEVExplanationError] = useState<string | null>(null);
  const [loadingEVExplanation, setLoadingEVExplanation] = useState(false);
  const floatId = useRef(0);
  const { shown, setShown, play: playTimeline } = useRoundTimeline();
  const dealerHandRef = useHandLayoutAnimation(`${game?.game_id ?? "loading"}:${shown.round}:${shown.dDealt}`);
  const playerHandRef = useHandLayoutAnimation(`${game?.game_id ?? "loading"}:${shown.round}:${shown.pDealt}`);

  useEffect(() => {
    if (mode !== "learning") return;
    try {
      setShowLearningIntro(window.localStorage.getItem(LEARNING_INTRO_STORAGE_KEY) !== "1");
    } catch {
      setShowLearningIntro(true);
    }
  }, [mode]);

  function dismissLearningIntro() {
    try {
      window.localStorage.setItem(LEARNING_INTRO_STORAGE_KEY, "1");
    } catch {
      // Keep the introduction dismissible if browser storage is unavailable.
    }
    setShowLearningIntro(false);
  }

  async function explainEV() {
    if (!game || !advice) return;
    setShowEVExplanation(true);
    setEVExplanation(null);
    setEVExplanationError(null);
    setLoadingEVExplanation(true);
    try {
      const response = await fetch("/api/blackjack/explain-ev", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          player_hand: game.player_hand,
          dealer_upcard: game.dealer_hand[0],
          player_total: game.player_score,
          bet_amount: game.bet_amount,
          bankroll: game.bankroll,
          advice,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not get an explanation.");
      setEVExplanation(data.explanation);
    } catch (e) {
      setEVExplanationError(e instanceof Error ? e.message : "Could not get an explanation.");
    } finally {
      setLoadingEVExplanation(false);
    }
  }

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

  useEffect(() => {
    if (mode !== "learning" || game?.status !== "playing" || shown.phase !== "player") return;

    let cancelled = false;
    const key = `${game.game_id}:${shown.round}:${game.player_hand.length}`;
    getLearningAdvice(game.game_id)
      .then((advice) => {
        if (!cancelled) setAdviceState({ key, advice });
      })
      .catch((e) => {
        if (!cancelled) {
          setAdviceState({
            key,
            error: e instanceof Error ? e.message : "Could not calculate advice",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [mode, game?.game_id, game?.player_hand.length, game?.status, shown.phase, shown.round]);

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
  const adviceKey = `${game.game_id}:${shown.round}:${game.player_hand.length}`;
  const advice = adviceState?.key === adviceKey ? adviceState.advice : undefined;

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 px-4 py-6">
      {natural && <div key={`flash-${shown.round}`} className="natural-flash" />}
      {showLearningIntro && mode === "learning" && typeof document !== "undefined" && createPortal(
        <div className="learning-intro-backdrop">
          <section
            className="learning-intro glass"
            role="dialog"
            aria-modal="true"
            aria-labelledby="learning-intro-title"
            aria-describedby="learning-intro-description"
          >
            <button
              className="learning-intro-close"
              aria-label="Close Learning Mode introduction"
              onClick={dismissLearningIntro}
            >
              ×
            </button>
            <h2 id="learning-intro-title" className="hand-title">Welcome to Learning Mode</h2>
            <p id="learning-intro-description">
              This learning tool helps you learn blackjack strategy. The best move is highlighted;
              hover over it for more information.
            </p>
            <button className="btn btn-green" onClick={dismissLearningIntro}>
              Close
            </button>
          </section>
        </div>,
        document.body,
      )}
      {showEVExplanation && typeof document !== "undefined" && createPortal(
        <div className="learning-intro-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setShowEVExplanation(false);
        }}>
          <section className="learning-intro ev-explanation-modal" role="dialog" aria-modal="true" aria-labelledby="ev-explanation-title">
            <button className="learning-intro-close" aria-label="Close EV explanation" onClick={() => setShowEVExplanation(false)}>×</button>
            <h2 id="ev-explanation-title" className="hand-title">How this EV is calculated</h2>
            <div className="ev-explanation-values">
              <span>Your hand: {game.player_hand.join(", ")} ({game.player_score})</span>
              <span>Dealer shows: {game.dealer_hand[0]}</span>
              <span>Bet: {formatMoney(game.bet_amount)} · Hit EV: {formatMoney(advice?.hit_ev ?? 0)} · Stand EV: {formatMoney(advice?.stand_ev ?? 0)}</span>
            </div>
            {loadingEVExplanation && <p role="status">Asking Gemini to explain these numbers…</p>}
            {evExplanationError && <p className="error-text" role="alert">{evExplanationError}</p>}
            {evExplanation && <p className="ev-explanation-text">{evExplanation}</p>}
            <button className="btn btn-green" onClick={() => setShowEVExplanation(false)}>Close</button>
          </section>
        </div>,
        document.body,
      )}

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

      <div className="game-content">
        <div className="game-main-column">
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
            <div className="learning-choice">
              <button
                className={`btn btn-green${advice?.best_move === "hit" ? " btn-recommended" : ""}`}
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
              {mode === "learning" && advice?.best_move === "hit" && (
                <div className="learning-advice" aria-live="polite">
                  <strong>Best move: Hit</strong>
                  <span>Hit EV {formatMoney(advice.hit_ev)}</span>
                  <span>Stand EV {formatMoney(advice.stand_ev)}</span>
                  <small>Expected net change from this point in the hand.</small>
                  <button className="btn btn-orange ev-explain-button" onClick={explainEV}>Explain the maths</button>
                </div>
              )}
            </div>
            <div className="learning-choice">
              <button
                className={`btn btn-orange${advice?.best_move === "stand" ? " btn-recommended" : ""}`}
                disabled={busy}
                onClick={() => {
                  play("stand");
                  run("stand");
                }}
              >
                Stand
              </button>
              {mode === "learning" && advice?.best_move === "stand" && (
                <div className="learning-advice" aria-live="polite">
                  <strong>Best move: Stand</strong>
                  <span>Hit EV {formatMoney(advice.hit_ev)}</span>
                  <span>Stand EV {formatMoney(advice.stand_ev)}</span>
                  <small>Expected net change from this point in the hand.</small>
                  <button className="btn btn-orange ev-explain-button" onClick={explainEV}>Explain the maths</button>
                </div>
              )}
            </div>
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
        </div>
      </div>
    </main>
  );
}
