import { useRef, useState, type ReactNode } from "react";
import MuteToggle from "./MuteToggle";
import { play } from "@/audio/useSound";

interface BubbleState {
  id: number;
  left: string;
  top?: string; // only for the initial bobbing bubbles
  size: number;
  delay: number;
  duration: number; // seconds, for rising bubbles
  rising: boolean;
  popping: boolean;
}

// Fixed positions (no randomness) so server and client render identically.
const INITIAL_BUBBLES: BubbleState[] = [
  { left: "6%", top: "14%", size: 90, delay: 0 },
  { left: "18%", top: "62%", size: 46, delay: 1.5 },
  { left: "30%", top: "30%", size: 28, delay: 3 },
  { left: "52%", top: "8%", size: 60, delay: 2 },
  { left: "70%", top: "55%", size: 110, delay: 0.8 },
  { left: "88%", top: "28%", size: 40, delay: 2.6 },
  { left: "92%", top: "75%", size: 70, delay: 1.1 },
  { left: "42%", top: "78%", size: 34, delay: 3.4 },
].map((b, i) => ({ ...b, id: i, duration: 0, rising: false, popping: false }));

export default function Scene({
  children,
  interactive = false,
}: {
  children: ReactNode;
  /** Bubbles can be popped (main menu only). */
  interactive?: boolean;
}) {
  const [bubbles, setBubbles] = useState<BubbleState[]>(INITIAL_BUBBLES);
  const nextId = useRef(INITIAL_BUBBLES.length);

  // A new bubble that floats up from below the screen. Only called from
  // client events, so using Math.random here is safe for hydration.
  function spawnRising(): BubbleState {
    return {
      id: nextId.current++,
      left: `${5 + Math.random() * 90}%`,
      size: 30 + Math.random() * 90,
      delay: 0,
      duration: 9 + Math.random() * 7,
      rising: true,
      popping: false,
    };
  }

  function pop(id: number) {
    if (!interactive) return;
    const target = bubbles.find((b) => b.id === id);
    if (!target || target.popping) return;
    play("menu.bubblePop");
    setBubbles((list) => list.map((b) => (b.id === id ? { ...b, popping: true } : b)));
  }

  function onAnimationEnd(b: BubbleState) {
    // A popped bubble is replaced; a bubble that finished rising is recycled.
    if (b.popping || b.rising) {
      setBubbles((list) => list.map((x) => (x.id === b.id ? spawnRising() : x)));
    }
  }

  return (
    <div className="aero-scene">
      {bubbles.map((b) => (
        <span
          key={b.id}
          className={`bubble${interactive ? " interactive" : ""}${b.rising ? " rising" : ""}${b.popping ? " popping" : ""}`}
          style={{
            left: b.left,
            top: b.top,
            width: b.size,
            height: b.size,
            animationDelay: `${b.delay}s`,
            ...(b.rising ? { animationDuration: `${b.duration}s` } : null),
          }}
          onPointerDown={() => pop(b.id)}
          onAnimationEnd={(e) => {
            // Ignore bubbling events from the bob animation or children.
            if (e.target === e.currentTarget && (b.popping || b.rising)) onAnimationEnd(b);
          }}
        />
      ))}
      <div className={`aero-content${interactive ? " passthrough" : ""}`}>{children}</div>
      <MuteToggle />
    </div>
  );
}
