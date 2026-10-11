"""Exact finite-shoe blackjack advice for the actions supported by this game."""

from __future__ import annotations

from functools import lru_cache

# Ranks 2-9, ten-valued cards (10/J/Q/K), and aces. Suits do not affect play.
RANK_VALUES = (2, 3, 4, 5, 6, 7, 8, 9, 10, 11)
TEN_INDEX = 8
ACE_INDEX = 9
INITIAL_COUNTS = (4, 4, 4, 4, 4, 4, 4, 4, 16, 4)


def _rank_index(card: str) -> int:
    rank = card.split(" ", 1)[0]
    if rank in {"10", "J", "Q", "K"}:
        return TEN_INDEX
    if rank == "A":
        return ACE_INDEX
    try:
        value = int(rank)
    except ValueError as exc:
        raise ValueError(f"Unsupported card: {card}") from exc
    if value < 2 or value > 9:
        raise ValueError(f"Unsupported card: {card}")
    return value - 2


def _add_card(total: int, soft_aces: int, rank: int) -> tuple[int, int]:
    total += RANK_VALUES[rank]
    if rank == ACE_INDEX:
        soft_aces += 1
    while total > 21 and soft_aces:
        total -= 10
        soft_aces -= 1
    return total, soft_aces


def _outcome(player_total: int, dealer_total: int) -> float:
    if dealer_total > 21 or player_total > dealer_total:
        return 1.0
    if player_total < dealer_total:
        return -1.0
    return 0.0


@lru_cache(maxsize=250_000)
def _dealer_value(
    player_total: int,
    dealer_total: int,
    soft_aces: int,
    counts: tuple[int, ...],
) -> float:
    """Expected net return in bet units, with the dealer's hidden card dealt."""
    if dealer_total > 21 or dealer_total >= 17:
        return _outcome(player_total, dealer_total)

    cards_left = sum(counts)
    if cards_left == 0:
        return _outcome(player_total, dealer_total)

    value = 0.0
    for rank, count in enumerate(counts):
        if count == 0:
            continue
        next_counts = list(counts)
        next_counts[rank] -= 1
        next_total, next_soft = _add_card(dealer_total, soft_aces, rank)
        value += count / cards_left * _dealer_value(
            player_total, next_total, next_soft, tuple(next_counts)
        )
    return value


@lru_cache(maxsize=250_000)
def _stand_value(
    player_total: int,
    dealer_up: int,
    counts: tuple[int, ...],
    hole_weights: tuple[int, ...],
) -> float:
    """EV of standing, marginalizing the unknown hole card exactly."""
    weight_total = sum(hole_weights)
    if weight_total == 0:
        return 0.0

    expected = 0.0
    for hole_rank, weight in enumerate(hole_weights):
        if weight == 0:
            continue
        remaining = list(counts)
        remaining[hole_rank] -= 1
        dealer_total, soft_aces = _add_card(0, 0, dealer_up)
        dealer_total, soft_aces = _add_card(dealer_total, soft_aces, hole_rank)
        expected += weight / weight_total * _dealer_value(
            player_total, dealer_total, soft_aces, tuple(remaining)
        )
    return expected


@lru_cache(maxsize=250_000)
def _best_value(
    player_total: int,
    soft_aces: int,
    dealer_up: int,
    counts: tuple[int, ...],
    hole_weights: tuple[int, ...],
) -> float:
    stand_ev = _stand_value(player_total, dealer_up, counts, hole_weights)
    if player_total >= 21:
        return stand_ev
    return max(stand_ev, _hit_value(player_total, soft_aces, dealer_up, counts, hole_weights))


@lru_cache(maxsize=250_000)
def _hit_value(
    player_total: int,
    soft_aces: int,
    dealer_up: int,
    counts: tuple[int, ...],
    hole_weights: tuple[int, ...],
) -> float:
    """EV of hitting once, then choosing optimally from the visible state."""
    cards_left = sum(counts)
    weight_total = sum(hole_weights)
    drawable_slots = cards_left - 1  # one unseen card is the dealer's hole card
    if drawable_slots <= 0 or weight_total == 0:
        return -1.0

    denominator = drawable_slots * weight_total
    expected = 0.0
    for rank, count in enumerate(counts):
        # For each possible hole card, count this rank among cards the player can draw.
        draw_weight = count * weight_total - hole_weights[rank]
        if draw_weight <= 0:
            continue

        next_counts = list(counts)
        next_counts[rank] -= 1
        next_weights = tuple(
            weight * (count - (1 if hole_rank == rank else 0))
            for hole_rank, weight in enumerate(hole_weights)
        )
        next_total, next_soft = _add_card(player_total, soft_aces, rank)
        if next_total > 21:
            continuation = -1.0
        elif next_total == 21:
            continuation = _stand_value(next_total, dealer_up, tuple(next_counts), next_weights)
        else:
            continuation = _best_value(
                next_total, next_soft, dealer_up, tuple(next_counts), next_weights
            )
        expected += draw_weight / denominator * continuation
    return expected


def recommend_move(player_hand: list[str], dealer_upcard: str, bet_amount: float) -> dict[str, float | str]:
    """Return exact expected net dollars for Hit and Stand using visible information only."""
    if not player_hand:
        raise ValueError("Player hand is empty")

    counts = list(INITIAL_COUNTS)
    player_total = 0
    soft_aces = 0
    for card in player_hand:
        rank = _rank_index(card)
        counts[rank] -= 1
        if counts[rank] < 0:
            raise ValueError("Hand contains more cards than a single deck")
        player_total, soft_aces = _add_card(player_total, soft_aces, rank)

    up_rank = _rank_index(dealer_upcard)
    counts[up_rank] -= 1
    if counts[up_rank] < 0:
        raise ValueError("Visible cards exceed a single deck")

    # An active game means the dealer's initial blackjack check passed. Condition
    # the hidden-card prior on that observable fact without exposing the hole card.
    hole_weights = counts.copy()
    if up_rank == ACE_INDEX:
        hole_weights[TEN_INDEX] = 0
    elif up_rank == TEN_INDEX:
        hole_weights[ACE_INDEX] = 0

    count_tuple = tuple(counts)
    weight_tuple = tuple(hole_weights)
    stand_units = _stand_value(player_total, up_rank, count_tuple, weight_tuple)
    hit_units = _hit_value(player_total, soft_aces, up_rank, count_tuple, weight_tuple)
    best_move = "hit" if hit_units > stand_units else "stand"
    return {
        "best_move": best_move,
        "hit_ev": round(hit_units * bet_amount, 4),
        "stand_ev": round(stand_units * bet_amount, 4),
    }
