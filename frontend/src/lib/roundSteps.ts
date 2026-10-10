import type { Shown, Step } from "@/hooks/useRoundTimeline";
import type { GameView } from "@/lib/blackjackApi";
import type { SoundKey } from "@/audio/soundConfig";
import { TIMING } from "@/config/timing";

/** Callbacks the choreography uses to drive the UI. */
export interface StepApi {
  set: (patch: Partial<Shown>) => void;
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

/**
 * After a bet. The caller has already reset the counters and started the
 * bankroll withdrawal; this deals face-down, flips the visible cards, and
 * continues into the dealer sequence if the round ended at the deal (natural).
 */
export function betSteps(view: GameView, api: StepApi): Step[] {
  const tl = timeline();
  tl.wait(TIMING.BET_WITHDRAW_MS);
  tl.add(() => api.set({ phase: "dealing" }));

  // Deal order: player, dealer, player, dealer (all face-down).
  const order: Partial<Shown>[] = [{ pDealt: 1 }, { dDealt: 1 }, { pDealt: 2 }, { dDealt: 2 }];
  for (const patch of order) {
    tl.add(() => {
      api.set(patch);
      api.sfx("card.deal");
    });
    tl.wait(TIMING.DEAL_INTERVAL_MS);
  }

  // Flip the player's cards and the dealer's up card; the hole card stays down.
  tl.wait(TIMING.FLIP_GAP_MS);
  for (const patch of [{ pRevealed: 1 }, { dRevealed: 1 }, { pRevealed: 2 }]) {
    tl.add(() => {
      api.set(patch);
      api.sfx("card.flip");
    });
    tl.wait(TIMING.FLIP_GAP_MS);
  }
  tl.wait(TIMING.FLIP_MS - TIMING.FLIP_GAP_MS);

  if (view.status === "finished") {
    tl.wait(TIMING.NATURAL_PAUSE_MS);
    dealerSteps(tl, view, api);
  } else {
    tl.add(() => api.set({ phase: "player" }));
  }
  return tl.steps;
}

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

  if (view.status === "finished") dealerSteps(tl, view, api);
  else tl.add(() => api.set({ phase: "player" }));
  return tl.steps;
}

export function standSteps(view: GameView, api: StepApi): Step[] {
  const tl = timeline();
  dealerSteps(tl, view, api);
  return tl.steps;
}
