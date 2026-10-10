/**
 * Pacing of a round, in milliseconds. Every delay in the round choreography
 * (see `lib/roundSteps.ts`) comes from here, so the feel can be tuned in one
 * place. These are fixed: they do not scale with bet size.
 */
export const TIMING = {
  /** Bankroll count-down/up animation (also how long the bet withdrawal is shown before dealing). */
  MONEY_TWEEN_MS: 900,
  /** Pause after the withdrawal before the first card is dealt. */
  BET_WITHDRAW_MS: 1000,
  /** Gap between consecutive cards being dealt. */
  DEAL_INTERVAL_MS: 400,
  /** Duration of a card flip (matches the CSS transition in globals.css). */
  FLIP_MS: 600,
  /** Gap between the opening cards being flipped one by one. */
  FLIP_GAP_MS: 350,
  /** Pause after a natural blackjack is dealt before anything else happens. */
  NATURAL_PAUSE_MS: 900,
  /** After the player is done, pause before the dealer's hole card flips. */
  DEALER_REVEAL_PAUSE_MS: 800,
  /** After the dealer flips (or draws), pause so the player can read the total. */
  DEALER_DRAW_PAUSE_MS: 1300,
  /** Pause after the last card before the result is shown. */
  SETTLE_PAUSE_MS: 700,
} as const;
