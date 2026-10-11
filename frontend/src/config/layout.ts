/** Display scale of the 71x95 card sprites (2 = original demo size). */
export const CARD_SCALE = {
  /** The player's and the dealer's cards. */
  main: 1.5,
  /** CPU cards on the sides of the table (shown rotated). */
  side: 1.2,
} as const;

/** Allowed numbers of CPU opponents. */
export const CPU_COUNTS = [0, 1, 2] as const;
export type CpuCount = (typeof CPU_COUNTS)[number];
