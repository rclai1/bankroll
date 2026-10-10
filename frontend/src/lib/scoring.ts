// Client-side port of the scoring helpers in backend/blackjack_api.py. Used so
// the displayed totals only count cards that have been flipped face-up.

export function cardValue(card: string): number {
  const rank = card.split(" ", 1)[0];
  if (rank === "J" || rank === "Q" || rank === "K") return 10;
  return rank === "A" ? 11 : Number(rank);
}

export function score(hand: readonly (string | undefined)[]): number {
  const cards = hand.filter((c): c is string => !!c);
  let total = cards.reduce((sum, c) => sum + cardValue(c), 0);
  let aces = cards.filter((c) => c.startsWith("A ")).length;
  while (total > 21 && aces) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

/** A natural blackjack is a 21 made with the original two cards. */
export function isNatural(hand: readonly string[]): boolean {
  return hand.length === 2 && score(hand) === 21;
}
