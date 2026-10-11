/** Smallest allowed bet (a player with less than this may bet everything they have). */
export const MIN_BET = 10;

export interface BetPreset {
  id: string;
  label: string;
  /** Share of the bankroll, or "min" for the minimum bet / "all" for everything. */
  fraction: number | "min" | "all";
}

export const BET_PRESETS: BetPreset[] = [
  { id: "min", label: "Min $10", fraction: "min" },
  { id: "25", label: "25%", fraction: 0.25 },
  { id: "50", label: "50%", fraction: 0.5 },
  { id: "75", label: "75%", fraction: 0.75 },
  { id: "all", label: "All in", fraction: "all" },
];

export const minBetFor = (bankroll: number) => Math.min(MIN_BET, bankroll);

/** Bet amount for a preset, in whole cents and within [min bet, bankroll]. */
export function presetAmount(preset: BetPreset, bankroll: number): number {
  const floor = minBetFor(bankroll);
  const raw =
    preset.fraction === "min" ? floor : preset.fraction === "all" ? bankroll : bankroll * preset.fraction;
  return Math.round(Math.min(bankroll, Math.max(floor, raw)) * 100) / 100;
}
