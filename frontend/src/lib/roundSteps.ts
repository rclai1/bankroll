import type { SeatShown, Shown, Step } from "@/hooks/useRoundTimeline";
import type { GameView } from "@/lib/blackjackApi";
import type { SoundKey } from "@/audio/soundConfig";
import { TIMING } from "@/config/timing";

/** Callbacks the choreography uses to drive the UI. */
export interface StepApi {
  set: (patch: Partial<Shown>) => void;
  /** Like `set` but computed from the latest state (needed for per-seat updates). */
  update: (fn: (s: Shown) => Partial<Shown>) => void;
  sfx: (key: SoundKey) => void;
  /** Called once everything has been shown: applies payout, banner, etc. */
  settle: () => void;
}

function timeline() {
  let t = 0;
  const steps: Step[] = [];
  return {
    steps,
    wait(ms: number) {
      t += ms;
    },
    add(run: () => void) {
      steps.push({ at: t, run });
    },
  };
}

type Timeline = ReturnType<typeof timeline>;

/** Patch one CPU seat's visible state (seat 1 = others[0], seat 2 = others[1]). */
function seatPatch(api: StepApi, seat: number, patch: Partial<SeatShown>) {
  api.update((s) => ({ others: s.others.map((o, i) => (i === seat - 1 ? { ...o, ...patch } : o)) }));
}

/** Dealer flips the hole card, draws any extra cards (paced), then the round settles. */
function dealerSteps(tl: Timeline, view: GameView, api: StepApi) {
  tl.add(() => api.set({ phase: "dealer" }));
  tl.wait(TIMING.DEALER_REVEAL_PAUSE_MS);
  tl.add(() => {
    api.set({ dRevealed: 2 });
    api.sfx("card.flip");
  });
  tl.wait(TIMING.FLIP_MS);

  for (let i = 2; i < view.dealer_hand.length; i++) {
    // Give the player time to read the dealer's total before each draw.
    tl.wait(TIMING.DEALER_DRAW_PAUSE_MS);
    tl.add(() => {
      api.set({ dDealt: i + 1 });
      api.sfx("card.deal");
    });
    tl.wait(TIMING.DEAL_INTERVAL_MS);
    tl.add(() => {
      api.set({ dRevealed: i + 1 });
      api.sfx("card.flip");
    });
    tl.wait(TIMING.FLIP_MS);
  }

  tl.wait(TIMING.SETTLE_PAUSE_MS);
  tl.add(() => {
    api.set({ phase: "settled" });
    api.settle();
  });
}

/** What follows the human's last visible step: the dealer, a CPU, or the human again. */
function afterHumanSteps(tl: Timeline, view: GameView, api: StepApi) {
  if (view.status === "finished") {
    dealerSteps(tl, view, api);
  } else {
    tl.add(() => api.set({ phase: view.current_player === 0 ? "player" : "cpu" }));
  }
}

/**
 * After a bet. The caller has already reset the counters and started the
 * bankroll withdrawal; this deals face-down (one card per seat per pass),
 * flips the visible cards, and continues into the dealer sequence if the
 * round already ended at the deal.
 */
export function betSteps(view: GameView, api: StepApi): Step[] {
  const tl = timeline();
  const cpuSeats = view.players.filter((p) => p.index > 0 && p.hand.length > 0).map((p) => p.index);

  tl.wait(TIMING.BET_WITHDRAW_MS);
  tl.add(() => api.set({ phase: "dealing" }));

  // Deal order: player, each CPU, dealer; twice. All face-down.
  for (const pass of [1, 2]) {
    tl.add(() => {
      api.set({ pDealt: pass });
      api.sfx("card.deal");
    });
    tl.wait(TIMING.DEAL_INTERVAL_MS);
    for (const seat of cpuSeats) {
      tl.add(() => {
        seatPatch(api, seat, { dealt: pass });
        api.sfx("card.deal");
      });
      tl.wait(TIMING.DEAL_INTERVAL_MS);
    }
    tl.add(() => {
      api.set({ dDealt: pass });
      api.sfx("card.deal");
    });
    tl.wait(TIMING.DEAL_INTERVAL_MS);
  }

  // Flip the player's cards and the dealer's up card; the hole card stays down.
  // CPU cards are public, so they flip too.
  tl.wait(TIMING.FLIP_GAP_MS);
  const flips: (() => void)[] = [
    () => api.set({ pRevealed: 1 }),
    () => api.set({ dRevealed: 1 }),
    () => api.set({ pRevealed: 2 }),
    ...cpuSeats.flatMap((seat) => [
      () => seatPatch(api, seat, { revealed: 1 }),
      () => seatPatch(api, seat, { revealed: 2 }),
    ]),
  ];
  for (const flip of flips) {
    tl.add(() => {
      flip();
      api.sfx("card.flip");
    });
    tl.wait(TIMING.FLIP_GAP_MS);
  }
  tl.wait(TIMING.FLIP_MS - TIMING.FLIP_GAP_MS);

  if (view.status === "finished") tl.wait(TIMING.NATURAL_PAUSE_MS);
  afterHumanSteps(tl, view, api);
  return tl.steps;
}

/** Hit or double down: one card for the human, then whatever comes next. */
export function hitSteps(view: GameView, api: StepApi): Step[] {
  const tl = timeline();
  const count = view.player_hand.length;
  tl.add(() => {
    api.set({ phase: "dealing", pDealt: count });
    api.sfx("card.deal");
  });
  tl.wait(TIMING.DEAL_INTERVAL_MS);
  tl.add(() => {
    api.set({ pRevealed: count });
    api.sfx("card.flip");
  });
  tl.wait(TIMING.FLIP_MS);

  afterHumanSteps(tl, view, api);
  return tl.steps;
}

/** Stand or surrender: no card; the dealer goes if nobody else is left. */
export function standSteps(view: GameView, api: StepApi): Step[] {
  const tl = timeline();
  if (view.status === "finished") {
    dealerSteps(tl, view, api);
  } else {
    tl.add(() => api.set({ phase: "cpu" }));
  }
  return tl.steps;
}

/**
 * One CPU action (the response of a `cpu_turn` call): a dealt-then-flipped
 * card for a hit or double down, a pause for a stand or surrender, and the
 * dealer sequence if that action ended the round. `prev` is the view before
 * the action (needed to show a double down's second bet leaving the bankroll).
 */
export function cpuTurnSteps(prev: GameView, view: GameView, seat: number, api: StepApi): Step[] {
  const tl = timeline();
  const before = prev.players[seat];
  const after = view.players[seat];
  const events = view.events.filter((e) => e.actor === "player" && e.index === seat);

  tl.add(() => api.set({ phase: "cpu" }));
  for (const event of events) {
    if (event.action === "hit" || event.action === "double_down") {
      if (event.action === "double_down") {
        tl.add(() => {
          seatPatch(api, seat, {
            bet: after.bet_amount,
            bankroll: Math.round((before.bankroll - before.bet_amount) * 100) / 100,
          });
          api.sfx("money.withdraw");
        });
      }
      const count = after.hand.length;
      tl.add(() => {
        seatPatch(api, seat, { dealt: count });
        api.sfx("card.deal");
      });
      tl.wait(TIMING.DEAL_INTERVAL_MS);
      tl.add(() => {
        seatPatch(api, seat, { revealed: count });
        api.sfx("card.flip");
      });
      tl.wait(TIMING.FLIP_MS);
    }
  }
  tl.wait(TIMING.CPU_ACTION_PAUSE_MS);

  if (view.status === "finished") dealerSteps(tl, view, api);
  return tl.steps;
}
