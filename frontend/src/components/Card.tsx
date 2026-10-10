import facesSheet from "@/assets/standard/PC _ Computer - Balatro - Playing Cards - Playing Cards.png";
import backsSheet from "@/assets/special/PC _ Computer - Balatro - Playing Cards - Card Backs, Enhancers and Seals.png";

const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const SUITS = ["hearts", "clubs", "diamonds", "spades"];

// Sprite cell size in the source sheets, and display scale.
const CELL_W = 71;
const CELL_H = 95;
const SCALE = 2;

function Sprite({
  src,
  sheetW,
  sheetH,
  col,
  row,
  label,
}: {
  src: string;
  sheetW: number;
  sheetH: number;
  col: number;
  row: number;
  label: string;
}) {
  return (
    <div
      role="img"
      aria-label={label}
      style={{
        width: CELL_W * SCALE,
        height: CELL_H * SCALE,
        backgroundImage: `url("${src}")`,
        backgroundSize: `${sheetW * SCALE}px ${sheetH * SCALE}px`,
        backgroundPosition: `-${col * CELL_W * SCALE}px -${row * CELL_H * SCALE}px`,
        imageRendering: "pixelated",
      }}
    />
  );
}

export default function Card({ card }: { card?: string }) {
  if (!card) {
    return (
      <Sprite
        src={backsSheet.src}
        sheetW={backsSheet.width}
        sheetH={backsSheet.height}
        col={0}
        row={0}
        label="Face-down card"
      />
    );
  }
  const [rank, , suit] = card.split(" ");
  return (
    <Sprite
      src={facesSheet.src}
      sheetW={facesSheet.width}
      sheetH={facesSheet.height}
      col={RANKS.indexOf(rank)}
      row={SUITS.indexOf(suit)}
      label={card}
    />
  );
}
