import type { CSSProperties } from "react";
import facesSheet from "@/assets/standard/PC _ Computer - Balatro - Playing Cards - Playing Cards.png";
import backsSheet from "@/assets/special/PC _ Computer - Balatro - Playing Cards - Card Backs, Enhancers and Seals.png";

const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const SUITS = ["hearts", "clubs", "diamonds", "spades"];

// Sprite cell size in the source sheets, and display scale.
const CELL_W = 71;
const CELL_H = 95;
const SCALE = 2;

export const CARD_W = CELL_W * SCALE;
export const CARD_H = CELL_H * SCALE;

function spriteStyle(
  sheet: { src: string; width: number; height: number },
  col: number,
  row: number,
): CSSProperties {
  return {
    backgroundImage: `url("${sheet.src}")`,
    backgroundSize: `${sheet.width * SCALE}px ${sheet.height * SCALE}px`,
    backgroundPosition: `-${col * CARD_W}px -${row * CARD_H}px`,
    imageRendering: "pixelated",
  };
}

export function EmptySlot() {
  return <div className="card-slot-empty" style={{ width: CARD_W, height: CARD_H }} />;
}

/**
 * A card that slides in when mounted (after `delay` seconds). With no `card`
 * it shows the back; when `card` is later provided on the same element it
 * flips face-up.
 */
export default function Card({ card, delay = 0 }: { card?: string; delay?: number }) {
  const [rank, , suit] = card ? card.split(" ") : [];
  const front = card
    ? spriteStyle(facesSheet, RANKS.indexOf(rank), SUITS.indexOf(suit))
    : undefined;

  return (
    <div
      className="card-slot deal-in"
      style={{ width: CARD_W, height: CARD_H, animationDelay: `${delay}s` }}
    >
      <div className={`card-flipper${card ? "" : " is-down"}`}>
        <div
          className="card-face card-front"
          role="img"
          aria-label={card ?? "Face-down card"}
          style={front}
        />
        <div
          className="card-face card-back"
          aria-hidden
          style={spriteStyle(backsSheet, 0, 0)}
        />
      </div>
    </div>
  );
}
