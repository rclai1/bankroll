import { useEffect, useRef, useState } from "react";

export function formatMoney(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Counts smoothly from the previous value to `value`, starting after `delay` ms. */
export function AnimatedMoney({
  value,
  delay = 0,
  duration = 900,
}: {
  value: number;
  delay?: number;
  duration?: number;
}) {
  const [display, setDisplay] = useState(value);
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  const shown = useRef(value);

  useEffect(() => {
    const from = shown.current;
    if (from === value) return;
    let raf = 0;
    let start = 0;

    const step = (t: number) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      shown.current = p < 1 ? from + (value - from) * eased : value;
      setDisplay(shown.current);
      if (p < 1) {
        raf = requestAnimationFrame(step);
      } else {
        setDir(null);
      }
    };

    const timer = setTimeout(() => {
      setDir(value > from ? "up" : "down");
      raf = requestAnimationFrame(step);
    }, delay);

    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [value, delay, duration]);

  return <span className={`money${dir ? ` ${dir}` : ""}`}>{formatMoney(display)}</span>;
}

export interface FloatMoney {
  id: number;
  text: string;
  kind: "win" | "loss";
  /** Which popup area shows it: the bankroll panel or the table. */
  where: "bank" | "table";
  delay: number;
}

/** Floating "+$20" / "-$10" popups; render inside a `position: relative` parent. */
export function FloatingMoney({ items }: { items: FloatMoney[] }) {
  return (
    <>
      {items.map((f) => (
        <span
          key={f.id}
          className={`float-money ${f.kind}`}
          style={{ animationDelay: `${f.delay}ms`, animationFillMode: "both" }}
        >
          {f.text}
        </span>
      ))}
    </>
  );
}
