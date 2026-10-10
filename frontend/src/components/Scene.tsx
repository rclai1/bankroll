import type { ReactNode } from "react";

// Fixed positions (no randomness) so server and client render identically.
const BUBBLES = [
  { left: "6%", top: "14%", size: 90, delay: 0 },
  { left: "18%", top: "62%", size: 46, delay: 1.5 },
  { left: "30%", top: "30%", size: 28, delay: 3 },
  { left: "52%", top: "8%", size: 60, delay: 2 },
  { left: "70%", top: "55%", size: 110, delay: 0.8 },
  { left: "88%", top: "28%", size: 40, delay: 2.6 },
  { left: "92%", top: "75%", size: 70, delay: 1.1 },
  { left: "42%", top: "78%", size: 34, delay: 3.4 },
];

export default function Scene({ children }: { children: ReactNode }) {
  return (
    <div className="aero-scene">
      {BUBBLES.map((b, i) => (
        <span
          key={i}
          className="bubble"
          style={{
            left: b.left,
            top: b.top,
            width: b.size,
            height: b.size,
            animationDelay: `${b.delay}s`,
          }}
        />
      ))}
      <div className="aero-content">{children}</div>
    </div>
  );
}
