import { MODES, type ModeId } from "@/config/modes";
import { play, useBgm } from "@/audio/useSound";

export default function MainMenu({ onStart }: { onStart: (mode: ModeId) => void }) {
  useBgm("bgm.menu");

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="glass fade-in flex flex-col items-center gap-8 px-8 py-12 sm:px-20">
        <h1 className="title-text text-5xl sm:text-7xl">title pending</h1>
        <nav className="flex w-72 flex-col gap-3" aria-label="Game modes">
          {MODES.map((mode) => (
            <button
              key={mode.id}
              className={`btn btn-${mode.style} mode-button`}
              disabled={!mode.enabled}
              onClick={() => {
                play(mode.clickSfx);
                onStart(mode.id);
              }}
            >
              {mode.label}
              {!mode.enabled && <span className="mode-tag">Coming soon</span>}
            </button>
          ))}
        </nav>
      </div>
    </main>
  );
}
