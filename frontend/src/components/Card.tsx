import type { CSSProperties } from "react";
import facesSheet from "@/assets/standard/balatro_std_faces.png";
import cardSheet from "@/assets/cards/balatro_cards.png";

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
 * A card that slides in (face-down) when it mounts and flips face-up when
 * `faceUp` becomes true. `card` may be undefined while the face is still
 * unknown to the client (the dealer's hole card).
 */
export default function Card({
  card,
  faceUp,
  glow = false,
}: {
  card?: string;
  faceUp: boolean;
  glow?: boolean;
}) {
  const [rank, , suit] = card ? card.split(" ") : [];
  const front = card
    ? spriteStyle(facesSheet, RANKS.indexOf(rank), SUITS.indexOf(suit))
    : undefined;

  return (
    <div
      className={`card-slot deal-in${glow ? " card-glow" : ""}`}
      style={{ width: CARD_W, height: CARD_H }}
    >
      <div className={`card-flipper${faceUp ? "" : " is-down"}`}>
        <div
          className="card-face card-front"
          role="img"
          aria-label={faceUp && card ? card : "Face-down card"}
          style={front}
        />
        <div className="card-face card-back" aria-hidden style={spriteStyle(cardSheet, 0, 0)} />
      </div>
    </div>
  );
}
