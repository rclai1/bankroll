import { useCallback, useEffect, useRef, useState } from "react";

export type Phase = "idle" | "withdrawing" | "dealing" | "player" | "dealer" | "settled";

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
}

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
};

export interface Step {
  at: number;
  run: () => void;
}

export function useRoundTimeline() {
  const [shown, setShown] = useState<Shown>(INITIAL_SHOWN);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const cancel = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const play = useCallback(
    (steps: Step[]) => {
      cancel();
      timers.current = steps.map((s) => setTimeout(s.run, s.at));
    },
    [cancel],
  );

  useEffect(() => cancel, [cancel]);

  return { shown, setShown, play, cancel };
}
