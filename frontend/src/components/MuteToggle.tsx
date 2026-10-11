import { useSyncExternalStore } from "react";
import { getMuted, setMuted, subscribeMuted } from "@/audio/audioManager";

export default function MuteToggle() {
  const muted = useSyncExternalStore(subscribeMuted, getMuted, () => false);
  return (
    <button
      className="btn mute-toggle"
      aria-label={muted ? "Unmute sound" : "Mute sound"}
      aria-pressed={muted}
      onClick={() => setMuted(!muted)}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}
