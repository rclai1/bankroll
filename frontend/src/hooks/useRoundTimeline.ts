import { useCallback, useEffect, useRef, useState } from "react";

export type Phase = "idle" | "withdrawing" | "dealing" | "player" | "cpu" | "dealer" | "settled";

/** What is visible for one CPU seat (seat 1 is others[0], seat 2 is others[1]). */
export interface SeatShown {
  dealt: number;
  revealed: number;
  bankroll: number;
  bet: number;
}

/** What is currently *visible*; the API response is the truth, this is the pacing of it. */
export interface Shown {
  phase: Phase;
  round: number;
  pDealt: number;
  pRevealed: number;
  dDealt: number;
  dRevealed: number;
  bankroll: number;
  bet: number;
  settled: boolean;
  others: SeatShown[];
}

const EMPTY_SEAT: SeatShown = { dealt: 0, revealed: 0, bankroll: 0, bet: 0 };

export const INITIAL_SHOWN: Shown = {
  phase: "idle",
  round: 0,
  pDealt: 0,
  pRevealed: 0,
  dDealt: 0,
  dRevealed: 0,
  bankroll: 0,
  bet: 0,
  settled: false,
  others: [EMPTY_SEAT, EMPTY_SEAT],
};

export interface Step {
  at: number;
  run: () => void;
}

export function useRoundTimeline() {
  const [shown, setShown] = useState<Shown>(INITIAL_SHOWN);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const pending = useRef<((completed: boolean) => void) | null>(null);

  const cancel = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    pending.current?.(false);
    pending.current = null;
  }, []);

  /** Runs the steps; resolves true after the last one ran, false if cancelled first. */
  const play = useCallback(
    (steps: Step[]): Promise<boolean> => {
      cancel();
      return new Promise<boolean>((resolve) => {
        pending.current = resolve;
        timers.current = steps.map((s) => setTimeout(s.run, s.at));
        const end = steps.reduce((max, s) => Math.max(max, s.at), 0);
        timers.current.push(
          setTimeout(() => {
            pending.current = null;
            resolve(true);
          }, end + 20),
        );
      });
    },
    [cancel],
  );

  useEffect(() => cancel, [cancel]);

  return { shown, setShown, play, cancel };
}
