import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Card, { EmptySlot, cardSize } from "./Card";
import CpuSeat from "./CpuSeat";
import { AnimatedMoney, FloatingMoney, formatMoney, type FloatMoney } from "./Money";
import {
  cpuTurn,
  createGame,
  doubleDown,
  hit,
  placeBet,
  stand,
  surrender,
  type GameView,
} from "@/lib/blackjackApi";
import { BET_PRESETS, minBetFor, presetAmount } from "@/config/betting";
import { score } from "@/lib/scoring";
import { betSteps, cpuTurnSteps, hitSteps, standSteps, type StepApi } from "@/lib/roundSteps";
import { INITIAL_SHOWN, useRoundTimeline } from "@/hooks/useRoundTimeline";
import { TIMING } from "@/config/timing";
import { CARD_SCALE } from "@/config/layout";
import { ROUND_EVENTS, getRoundEvent } from "@/config/messages";
import { MODES_BY_ID, type ModeId } from "@/config/modes";
import { play, useBgm } from "@/audio/useSound";
import { selectDealSound, selectHitSound } from "@/audio/soundConfig";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Starting visible state for a freshly created game. */
function shownFor(g: GameView) {
  return {
    bankroll: g.bankroll,
    others: [1, 2].map((seat) => {
      const p = g.players[seat];
      return { dealt: 0, revealed: 0, bet: 0, bankroll: p ? p.bankroll : 0 };
    }),
  };
}

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

export default function Game({
  mode,
  cpuCount,
  onExit,
}: {
  mode: ModeId;
  cpuCount: number;
  onExit: () => void;
}) {
  useBgm(MODES_BY_ID[mode].bgm);

  const [game, setGame] = useState<GameView | null>(null);
  const [bet, setBet] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // False after a round finishes until the player clicks "Next round".
  const [betting, setBetting] = useState(true);
  const [floats, setFloats] = useState<FloatMoney[]>([]);
  // Seat whose CPU is currently deciding (a call takes about 3-15 s), and a CPU turn to retry after an error.
  const [thinking, setThinking] = useState<number | null>(null);
  const [cpuStuck, setCpuStuck] = useState<GameView | null>(null);
  const floatId = useRef(0);
  const alive = useRef(true);
  const afterBetRef = useRef(0);
  const { shown, setShown, play: playTimeline } = useRoundTimeline();
  const dealerHandRef = useHandLayoutAnimation(`${game?.game_id ?? "loading"}:${shown.round}:${shown.dDealt}`);
  const playerHandRef = useHandLayoutAnimation(`${game?.game_id ?? "loading"}:${shown.round}:${shown.pDealt}`);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  function pushFloat(text: string, kind: FloatMoney["kind"], where: FloatMoney["where"]) {
    const id = ++floatId.current;
    setFloats((f) => [...f, { id, text, kind, where, delay: 0 }]);
    setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 1800);
  }

  /** Runs when the timeline finishes: payout, result sound. */
  function settleRound(view: GameView, afterBet: number) {
    setShown((s) => ({
      ...s,
      bankroll: view.bankroll,
      settled: true,
      phase: "settled",
      others: s.others.map((o, i) => (view.players[i + 1] ? { ...o, bankroll: view.players[i + 1].bankroll } : o)),
    }));
    const gain = round2(view.bankroll - afterBet);
    if (view.result === "surrender") {
      // Half the bet comes back; the other half is what is lost.
      pushFloat(`-${formatMoney(round2(view.bet_amount / 2))}`, "loss", "table");
    } else if (gain > 0) {
      pushFloat(`+${formatMoney(gain)}`, "win", "bank");
    } else if (view.result === "loss") {
      pushFloat(`-${formatMoney(view.bet_amount)}`, "loss", "table");
    }

    const sfx = ROUND_EVENTS[getRoundEvent(view)].sfx;
    if (sfx) play(sfx);
  }

  function makeApi(view: GameView, afterBet: number): StepApi {
    return {
      set: (patch) => setShown((s) => ({ ...s, ...patch })),
      update: (fn) => setShown((s) => ({ ...s, ...fn(s) })),
      sfx: play,
      settle: () => settleRound(view, afterBet),
    };
  }

  /** Plays CPU turns one call at a time until it is the human's turn or the round is over. */
  async function driveCpus(start: GameView, afterBet: number) {
    let view = start;
    setCpuStuck(null);
    while (alive.current && view.status === "playing" && view.current_player !== null && view.current_player > 0) {
      const seat = view.current_player;
      setThinking(seat);
      let next: GameView;
      try {
        next = await cpuTurn(view.game_id);
      } catch (e) {
        if (!alive.current) return;
        setThinking(null);
        setError(e instanceof Error ? e.message : "A CPU could not take its turn");
        setCpuStuck(view);
        return;
      }
      if (!alive.current) return;
      setThinking(null);
      setError(null);
      setGame(next);
      const completed = await playTimeline(cpuTurnSteps(view, next, seat, makeApi(next, afterBet)));
      if (!completed) return;
      view = next;
    }
  }

  async function run(kind: "bet" | "hit" | "stand" | "double" | "surrender", amount = 0) {
    if (!game) return;
    setBusy(true);
    setError(null);
    let followUp: { done: Promise<boolean>; view: GameView; afterBet: number } | null = null;
    try {
      const next =
        kind === "bet"
          ? await placeBet(game.game_id, amount)
          : kind === "hit"
            ? await hit(game.game_id)
            : kind === "double"
              ? await doubleDown(game.game_id)
              : kind === "surrender"
                ? await surrender(game.game_id)
                : await stand(game.game_id);

      // The bet is taken from the bankroll at deal time; later actions see it already gone,
      // except doubling down, which takes a second, equal bet.
      const afterBet =
        kind === "bet"
          ? round2(game.bankroll - amount)
          : kind === "double"
            ? round2(game.bankroll - game.bet_amount)
            : game.bankroll;
      afterBetRef.current = afterBet;
      const api = makeApi(next, afterBet);

      setGame(next);
      let done: Promise<boolean>;
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
          others: s.others.map((o, i) => {
            const before = game.players[i + 1];
            const now = next.players[i + 1];
            if (!before || !now) return o;
            return { dealt: 0, revealed: 0, bet: now.bet_amount, bankroll: round2(before.bankroll - now.bet_amount) };
          }),
        }));
        pushFloat(`-${formatMoney(amount)}`, "loss", "bank");
        play("money.withdraw");
        done = playTimeline(betSteps(next, api));
      } else if (kind === "double") {
        // The extra bet leaves the bankroll, then one card is dealt (same flow as a hit).
        setShown((s) => ({ ...s, bet: next.bet_amount, bankroll: afterBet }));
        pushFloat(`-${formatMoney(game.bet_amount)}`, "loss", "bank");
        play("money.withdraw");
        done = playTimeline(hitSteps(next, api));
      } else {
        // Surrender deals no card; it just ends the human's turn like a stand.
        done = playTimeline((kind === "hit" ? hitSteps : standSteps)(next, api));
      }
      if (next.status === "playing" && next.current_player !== null && next.current_player > 0) {
        followUp = { done, view: next, afterBet };
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
    // Once the human's own animation has finished, the CPUs take their turns.
    if (followUp && (await followUp.done)) await driveCpus(followUp.view, followUp.afterBet);
  }

  function startNewGame() {
    setBetting(true);
    setCpuStuck(null);
    createGame(100, cpuCount)
      .then((g) => {
        setGame(g);
        setShown((s) => ({ ...INITIAL_SHOWN, round: s.round, ...shownFor(g) }));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not reach the server"));
  }

  useEffect(() => {
    let cancelled = false;
    createGame(100, cpuCount)
      .then((g) => {
        if (cancelled) return;
        setGame(g);
        setShown((s) => ({ ...s, ...shownFor(g) }));
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not reach the server");
      });
    return () => {
      cancelled = true;
    };
  }, [setShown, cpuCount]);

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
  const main = cardSize(CARD_SCALE.main);

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

  const seats = ([1, 2] as const)
    .map((seat) => ({ seat, player: game.players[seat], side: seat === 1 ? ("left" as const) : ("right" as const) }))
    .filter((s) => s.player);

  return (
    <main className="flex min-h-screen flex-col items-center gap-4 px-4 py-4">
      {natural && <div key={`flash-${shown.round}`} className="natural-flash" />}

      <header className="flex w-full max-w-5xl items-stretch gap-3">
        <div className="glass relative flex flex-1 flex-col px-4 py-2">
          <span className="label">Bankroll</span>
          <span>
            <span className="coin" />
            <AnimatedMoney value={shown.bankroll} duration={TIMING.MONEY_TWEEN_MS} />
          </span>
          <FloatingMoney items={floats.filter((f) => f.where === "bank")} />
        </div>
        <div className="glass flex flex-col px-4 py-2">
          <span className="label">Bet</span>
          <span className="money">{formatMoney(shown.bet)}</span>
        </div>
        <button className="btn btn-orange btn-sm self-center" onClick={onExit}>
          Menu
        </button>
      </header>

      <section className={`table-box glass flex w-full max-w-5xl flex-col items-center gap-4 px-4 py-4${seats.length ? " has-cpus" : ""}`}>
        {seats.map(({ seat, player, side }) => (
          <CpuSeat
            key={seat}
            player={player}
            side={side}
            shown={shown.others[seat - 1]}
            thinking={thinking === seat}
            settled={shown.settled}
            round={shown.round}
          />
        ))}

        <div className="flex w-full flex-col items-center gap-1">
          <h2 className="hand-title">
            Dealer
            {dealerScore !== null && <span className="score-badge">{dealerScore}</span>}
          </h2>
          <div ref={dealerHandRef} className="flex w-full flex-wrap justify-start gap-2" style={{ minHeight: main.height }}>
            {!hasCards && (
              <>
                <EmptySlot scale={CARD_SCALE.main} />
                <EmptySlot scale={CARD_SCALE.main} />
              </>
            )}
            {dealerCards.map((c, i) => (
              <div
                key={`${shown.round}-d${i}`}
                data-hand-card={`${shown.round}-d${i}`}
                className="card-hand-item"
                style={main}
              >
                <Card card={c} faceUp={i < shown.dRevealed} glow={glowDealer && i < 2} scale={CARD_SCALE.main} />
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex h-20 items-center justify-center">
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

        <div className="flex w-full flex-col items-center gap-1">
          <div ref={playerHandRef} className="flex w-full flex-wrap justify-start gap-2" style={{ minHeight: main.height }}>
            {!hasCards && (
              <>
                <EmptySlot scale={CARD_SCALE.main} />
                <EmptySlot scale={CARD_SCALE.main} />
              </>
            )}
            {playerCards.map((c, i) => (
              <div
                key={`${shown.round}-p${i}`}
                data-hand-card={`${shown.round}-p${i}`}
                className="card-hand-item"
                style={main}
              >
                <Card card={c} faceUp={i < shown.pRevealed} glow={glowPlayer && i < 2} scale={CARD_SCALE.main} />
              </div>
            ))}
          </div>
          <h2 className="hand-title">
            You
            {playerScore !== null && <span className="score-badge">{playerScore}</span>}
          </h2>
        </div>
      </section>

      <div className="flex min-h-14 flex-col items-center gap-2">
        {game.status === "playing" && shown.phase === "player" && game.current_player === 0 && (
          <div className="fade-in flex flex-wrap justify-center gap-2">
            <button
              className="btn btn-green btn-md"
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
              className="btn btn-orange btn-md"
              disabled={busy}
              onClick={() => {
                play("stand");
                run("stand");
              }}
            >
              Stand
            </button>
            {game.legal_actions.includes("double_down") && (
              <button
                className="btn btn-md"
                disabled={busy}
                onClick={() => {
                  play("double");
                  run("double");
                }}
              >
                Double Down
              </button>
            )}
            {game.legal_actions.includes("surrender") && (
              <button
                className="btn btn-red btn-md"
                disabled={busy}
                onClick={() => {
                  play("surrender");
                  run("surrender");
                }}
              >
                Surrender
              </button>
            )}
          </div>
        )}

        {cpuStuck && (
          <button className="btn btn-md" onClick={() => driveCpus(cpuStuck, afterBetRef.current)}>
            Retry CPU turn
          </button>
        )}

        {game.status === "finished" && shown.settled && !betting && (
          <div className="fade-in flex gap-2">
            {broke ? (
              <button
                className="btn btn-green btn-md"
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
                className="btn btn-green btn-md"
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
            className="fade-in glass flex flex-wrap items-center justify-center gap-2 px-4 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              const amount = Math.min(Math.max(bet, minBetFor(game.bankroll)), game.bankroll);
              play(selectDealSound(amount, game.bankroll));
              run("bet", amount);
            }}
          >
            <div className="flex w-full flex-wrap justify-center gap-2" role="group" aria-label="Preset bets">
              {BET_PRESETS.map((preset) => {
                const amount = presetAmount(preset, game.bankroll);
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={`btn btn-sm${bet === amount ? " selected" : ""}`}
                    onClick={() => setBet(amount)}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            <label className="flex items-center gap-2 font-bold">
              Bet $
              <input
                type="number"
                min={minBetFor(game.bankroll)}
                max={game.bankroll}
                step="any"
                value={bet}
                onChange={(e) => setBet(Number(e.target.value))}
                className="aero-input"
              />
            </label>
            <button className="btn btn-green btn-md" disabled={busy || !(bet > 0)}>
              Deal
            </button>
          </form>
        )}

        {error && <p className="error-text">{error}</p>}
      </div>
    </main>
  );
}
