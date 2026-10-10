# Frameworks: sound, special messages, timing, modes

Everything below is wired up but empty. Filling in the values listed here is all
that is needed; no component code has to change.

## 1. Sound (`src/audio/`)

| File | Purpose |
| --- | --- |
| `src/audio/soundConfig.ts` | **Edit this.** Every sound key with its `src` (URL path) and `volume`. `src: null` = silent. Also holds the variant selectors and their thresholds. |
| `src/audio/audioManager.ts` | Playback engine (one-shots, looping BGM with crossfade, mute, autoplay-unlock). No edits needed. |
| `src/audio/useSound.ts` | `play(key)` and `useBgm(key)` helpers used by components. |
| `src/components/MuteToggle.tsx` | Mute button (bottom-right); persists in localStorage. |

Put audio files in `public/audio/` and reference them as `/audio/<file>`.

| Key (in `soundConfig.ts`) | Triggered from | Notes |
| --- | --- | --- |
| `bgm.menu` | `MainMenu.tsx` (`useBgm`) | Main menu music |
| `bgm.regular` / `bgm.daily` / `bgm.chaos` / `bgm.learning` / `bgm.gambling` | `Game.tsx` (`useBgm(MODES_BY_ID[mode].bgm)`) | Which key a mode uses is set by `bgm` in `src/config/modes.ts` |
| `menu.daily` / `menu.regular` / `menu.chaos` / `menu.learning` / `menu.gambling` | `MainMenu.tsx` button click | Which key a button uses is `clickSfx` in `src/config/modes.ts` |
| `menu.bubblePop` | `Scene.tsx` `pop()` | Bubble clicked |
| `card.deal` | `src/lib/roundSteps.ts` (every deal step) | |
| `card.flip` | `src/lib/roundSteps.ts` (every flip step) | Extra (not in the original list) |
| `money.withdraw` | `Game.tsx` `run("bet")` | Extra; bet leaves the bankroll |
| `deal.low` / `deal.mid` / `deal.high` | `Game.tsx` bet form submit via `selectDealSound(bet, bankroll)` | Tune `DEAL_SOUND_THRESHOLDS` (bet as a fraction of total money) |
| `hit.default` / `hit.highBet` / `hit.hardHand` | `Game.tsx` Hit button via `selectHitSound(...)` | Tune `HIT_SOUND_THRESHOLDS`; add more variants/`TODO(sfx)` in `selectHitSound` |
| `stand` | `Game.tsx` Stand button | |
| `nextRound` | `Game.tsx` "Next round" / "new game" button | |
| `blackjack.natural` | `Game.tsx` `settleRound`, via `ROUND_EVENTS[...].sfx` | Natural blackjack (player, dealer, or both) |

To add a new sound: add a key to `SOUNDS` in `soundConfig.ts`, then call
`play("your.key")` where it should fire (or reference it from a `sfx` field in
`messages.ts` / `modes.ts`).

## 2. Special messages (`src/config/messages.ts`)

`ROUND_EVENTS` has one entry per round outcome. Fields per entry:

- `banner`: main text. **Natural blackjack copy is a placeholder** (`playerNatural`, `dealerNatural`, `bothNatural`; marked `TODO(message)`).
- `subtitle`: optional smaller line under the banner (`null` = none).
- `sfx`: a `SoundKey` played when the result appears (naturals use `blackjack.natural`; others `null`).
- `effect`: `"natural"` enables the gold banner, screen flash and card glow.
- `tone`: `win` / `loss` / `push` banner colour.

`getRoundEvent(view)` in the same file decides which entry applies.

## 3. Timing (`src/config/timing.ts`)

All round pacing (bet withdrawal delay, deal interval, flip gaps, pause between
the dealer flipping and drawing, settle pause). Fixed values; independent of bet
size. The sequence itself is built in `src/lib/roundSteps.ts`.

## 4. Modes (`src/config/modes.ts`)

Per mode: `label`, `enabled` (only `regular` is true), `bgm` key, `clickSfx` key,
button `style`. Set `enabled: true` once a mode exists, and handle `mode` in
`Game.tsx` (currently every mode would run the regular rules).
