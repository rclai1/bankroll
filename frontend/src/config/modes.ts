import type { SoundKey } from "@/audio/soundConfig";

export type ModeId = "daily" | "regular" | "chaos" | "learning" | "gambling";

export interface ModeDef {
  id: ModeId;
  label: string;
  /** Only enabled modes can be started; the rest show "Coming soon". */
  enabled: boolean;
  /** Looping music while this mode's screen is open. Set `src` in audio/soundConfig.ts. */
  bgm: SoundKey;
  /** Click sound for this mode's menu button. Set `src` in audio/soundConfig.ts. */
  clickSfx: SoundKey;
  style: "green" | "aqua" | "orange";
}

export const MODES: ModeDef[] = [
  { id: "daily", label: "Daily", enabled: false, bgm: "bgm.daily", clickSfx: "menu.daily", style: "orange" },
  { id: "regular", label: "Regular Mode", enabled: true, bgm: "bgm.regular", clickSfx: "menu.regular", style: "green" },
  { id: "chaos", label: "Chaos Mode", enabled: false, bgm: "bgm.chaos", clickSfx: "menu.chaos", style: "orange" },
  { id: "learning", label: "Learning Mode", enabled: false, bgm: "bgm.learning", clickSfx: "menu.learning", style: "aqua" },
  // Unlock new card fronts/backs through a gambling system (not built yet).
  { id: "gambling", label: "Card Shop", enabled: false, bgm: "bgm.gambling", clickSfx: "menu.gambling", style: "aqua" },
];

export const MODES_BY_ID = Object.fromEntries(MODES.map((m) => [m.id, m])) as Record<ModeId, ModeDef>;
