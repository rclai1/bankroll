import { useEffect } from "react";
import { playBgm } from "./audioManager";
import type { SoundKey } from "./soundConfig";

export { play } from "./audioManager";

/** Plays the given looping BGM while the calling screen is mounted (until another screen sets its own). */
export function useBgm(key: SoundKey) {
  useEffect(() => {
    playBgm(key);
  }, [key]);
}
