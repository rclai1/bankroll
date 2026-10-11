/**
 * SOUND FRAMEWORK: the one file to edit when sound assets exist.
 *
 * Put audio files in `public/audio/` and set `src` to the URL path, e.g.
 * `src: "/audio/bubble-pop.mp3"`. `src: null` means "no sound yet" and every
 * call to play it is a silent no-op. `volume` is 0..1.
 *
 * Keys starting with `bgm.` loop and are played through `playBgm`; all others
 * are one-shots. See docs/FRAMEWORKS.md for where each key is triggered.
 */

export interface SoundDef {
  src: string | null;
  volume: number;
}

const sound = (volume = 0.7): SoundDef => ({ src: null, volume });

export const SOUNDS = {
  // --- Background music (one per screen/mode; mapping lives in config/modes.ts) ---
  "bgm.menu": sound(0.4),
  "bgm.regular": sound(0.4),
  "bgm.daily": sound(0.4),
  "bgm.chaos": sound(0.4),
  "bgm.learning": sound(0.4),
  "bgm.gambling": sound(0.4),

  // --- Main menu ---
  "menu.daily": sound(),
  "menu.regular": sound(),
  "menu.chaos": sound(),
  "menu.learning": sound(),
  "menu.gambling": sound(),
  "menu.bubblePop": sound(),

  // --- Cards / money (triggered from the round timeline) ---
  "card.deal": sound(),
  "card.flip": sound(), // not in the original list; used by the face-down -> face-up flip
  "money.withdraw": sound(), // not in the original list; played when the bet leaves the bankroll

  // --- Deal button: variant picked by selectDealSound (bet size) ---
  "deal.low": sound(),
  "deal.mid": sound(),
  "deal.high": sound(),

  // --- Hit button: variant picked by selectHitSound (bet size / hand) ---
  "hit.default": sound(),
  "hit.highBet": sound(),
  "hit.hardHand": sound(),

  // --- Other buttons ---
  stand: sound(),
  double: sound(), // Double Down button
  surrender: sound(), // Surrender button
  nextRound: sound(),

  // --- Special round events (see config/messages.ts) ---
  "blackjack.natural": sound(0.9),
} satisfies Record<string, SoundDef>;

export type SoundKey = keyof typeof SOUNDS;

// ---------------------------------------------------------------------------
// Variant selectors. Tune the thresholds here.
// ---------------------------------------------------------------------------

/** Bet as a fraction of the player's total money (bankroll + bet) at which the deal sound escalates. */
export const DEAL_SOUND_THRESHOLDS = { mid: 0.2, high: 0.5 } as const;

export function selectDealSound(bet: number, bankrollBeforeBet: number): SoundKey {
  const fraction = bankrollBeforeBet > 0 ? bet / bankrollBeforeBet : 0;
  if (fraction >= DEAL_SOUND_THRESHOLDS.high) return "deal.high";
  if (fraction >= DEAL_SOUND_THRESHOLDS.mid) return "deal.mid";
  return "deal.low";
}

/** Bet fraction / hand total at which the hit sound switches away from the default. */
export const HIT_SOUND_THRESHOLDS = { highBetFraction: 0.5, hardHandScore: 17 } as const;

export function selectHitSound(ctx: {
  bet: number;
  bankrollBeforeBet: number;
  playerScore: number;
}): SoundKey {
  // TODO(sfx): more variants by hand (soft hands, 11 or less, etc.) if wanted.
  const fraction = ctx.bankrollBeforeBet > 0 ? ctx.bet / ctx.bankrollBeforeBet : 0;
  if (fraction >= HIT_SOUND_THRESHOLDS.highBetFraction) return "hit.highBet";
  if (ctx.playerScore >= HIT_SOUND_THRESHOLDS.hardHandScore) return "hit.hardHand";
  return "hit.default";
}
