import type { CSSProperties } from "react";
import Card, { EmptySlot, cardSize } from "./Card";
import { formatMoney } from "./Money";
import type { SeatShown } from "@/hooks/useRoundTimeline";
import type { GameResult, Player } from "@/lib/blackjackApi";
import { isNatural, score } from "@/lib/scoring";
import { CARD_SCALE } from "@/config/layout";

const RESULT_LABEL: Record<NonNullable<GameResult>, string> = {
  win: "Win",
  loss: "Lose",
  push: "Push",
  blackjack: "Blackjack!",
  surrender: "Surrendered",
};

/** What to say under the seat; only describes what the player has already seen happen. */
function seatLabel(player: Player, shown: SeatShown, thinking: boolean, settled: boolean): string | null {
  if (player.player_status === "out") return "Out of money";
  if (thinking) return "Thinking…";
  if (settled && player.result) return RESULT_LABEL[player.result];
  // Hide what a CPU did until its cards have been dealt and flipped.
  if (player.hand.length === 0 || shown.revealed < player.hand.length) return null;
  if (isNatural(player.hand)) return "Blackjack!";
  switch (player.player_status) {
    case "stood":
      return "Stand";
    case "double_down":
      return "Doubled down";
    case "surrender":
      return "Surrendered";
    case "bust":
      return "Bust!";
    default:
      return null;
  }
}

/** A CPU at the left or right edge of the table, cards lying sideways. */
export default function CpuSeat({
  player,
  side,
  shown,
  thinking,
  settled,
  round,
}: {
  player: Player;
  side: "left" | "right";
  shown: SeatShown;
  thinking: boolean;
  settled: boolean;
  round: number;
}) {
  const { width, height } = cardSize(CARD_SCALE.side);
  const cards = player.hand.slice(0, shown.dealt);
  const visibleScore = shown.revealed > 0 ? score(player.hand.slice(0, shown.revealed)) : null;
  const label = seatLabel(player, shown, thinking, settled);
  const cardVars = {
    "--cw": `${width}px`,
    "--ch": `${height}px`,
    "--rot": side === "left" ? "90deg" : "-90deg",
  } as CSSProperties;

  return (
    <div className={`seat-side seat-${side}${thinking ? " thinking" : ""}`} aria-label={`CPU ${player.index}`}>
      <h3 className="hand-title seat-title">
        CPU {player.index}
        {visibleScore !== null && <span className="score-badge">{visibleScore}</span>}
      </h3>
      <div className="seat-money">
        <span className="coin" />
        {formatMoney(shown.bankroll)}
        <span className="seat-bet">Bet {formatMoney(shown.bet)}</span>
      </div>

      <div className="seat-cards" style={cardVars}>
        {cards.length === 0 && player.player_status !== "out" && (
          <>
            <div className="side-card"><div className="side-card-inner"><EmptySlot scale={CARD_SCALE.side} /></div></div>
            <div className="side-card"><div className="side-card-inner"><EmptySlot scale={CARD_SCALE.side} /></div></div>
          </>
        )}
        {cards.map((c, i) => (
          <div key={`${round}-c${player.index}-${i}`} className={`side-card${i >= 3 ? " overlap" : ""}`}>
            <div className="side-card-inner">
              <Card card={c} faceUp={i < shown.revealed} scale={CARD_SCALE.side} />
            </div>
          </div>
        ))}
      </div>

      <div className="seat-status" aria-live="polite">
        {label ?? " "}
      </div>
    </div>
  );
}
