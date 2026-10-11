import { useEffect, useState } from "react";
import { MODES, type ModeDef, type ModeId } from "@/config/modes";
import { CPU_COUNTS, type CpuCount } from "@/config/layout";
import { play, useBgm } from "@/audio/useSound";

export default function MainMenu({ onStart }: { onStart: (mode: ModeId, cpuCount: CpuCount) => void }) {
  useBgm("bgm.menu");

  // The mode waiting for a CPU count, and the count chosen in the pop-up.
  const [pending, setPending] = useState<ModeDef | null>(null);
  const [cpuCount, setCpuCount] = useState<CpuCount>(0);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPending(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending]);

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
                if (mode.askCpuCount) setPending(mode);
                else onStart(mode.id, 0);
              }}
            >
              {mode.label}
              {!mode.enabled && <span className="mode-tag">Coming soon</span>}
            </button>
          ))}
        </nav>
      </div>

      {pending && (
        <div className="modal-backdrop" onClick={() => setPending(null)}>
          <div
            className="glass modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cpu-count-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="cpu-count-title" className="title-text modal-title">
              How many CPUs?
            </h2>
            <div className="cpu-options" role="radiogroup" aria-labelledby="cpu-count-title">
              {CPU_COUNTS.map((n) => (
                <button
                  key={n}
                  role="radio"
                  aria-checked={cpuCount === n}
                  className={`btn cpu-option${cpuCount === n ? " selected" : ""}`}
                  onClick={() => setCpuCount(n)}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn btn-orange btn-md" onClick={() => setPending(null)}>
                Back
              </button>
              <button className="btn btn-green btn-md" autoFocus onClick={() => onStart(pending.id, cpuCount)}>
                Start Game
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
