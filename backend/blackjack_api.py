"""Blackjack routes and in-memory game state."""

from __future__ import annotations

import random
import uuid
import json
from dataclasses import dataclass, field
from typing import Literal

import os

from google import genai
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from strategy import recommend_move

router = APIRouter()
RANKS = ("2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A")
SUITS = ("clubs", "diamonds", "hearts", "spades")


@dataclass
class Game:
    game_id: str
    bankroll: float
    deck: list[str] = field(default_factory=list)
    player_hand: list[str] = field(default_factory=list)
    dealer_hand: list[str] = field(default_factory=list)
    bet_amount: float = 0.0
    status: Literal["waiting_for_bet", "playing", "finished"] = "waiting_for_bet"
    result: str | None = None


games: dict[str, Game] = {}


class NewGameRequest(BaseModel):
    bankroll: float = Field(default=100.0, gt=0, le=1_000_000)


class BetRequest(BaseModel):
    amount: float = Field(gt=0, le=1_000_000)


class EVExplanationRequest(BaseModel):
    player_hand: list[str]
    dealer_upcard: str
    player_total: int
    bet_amount: float
    bankroll: float
    advice: dict[str, float | str]


def _new_deck() -> list[str]:
    seed = os.urandom(8)
    deck = [f"{rank} of {suit}" for suit in SUITS for rank in RANKS]
    generator = random.Random(seed)
    generator.shuffle(deck)
    return deck


def _value(card: str) -> int:
    rank = card.split(" ", 1)[0]
    if rank in ("J", "Q", "K"):
        return 10
    return 11 if rank == "A" else int(rank)


def _score(hand: list[str]) -> int:
    score = sum(_value(card) for card in hand)
    aces = sum(card.startswith("A ") for card in hand)
    while score > 21 and aces:
        score -= 10
        aces -= 1
    return score


def _is_natural_blackjack(hand: list[str]) -> bool:
    """Blackjack is only a 21 made with the original two-card hand."""
    return len(hand) == 2 and _score(hand) == 21


def _draw(game: Game) -> str:
    if not game.deck:
        game.deck = _new_deck()
    return game.deck.pop()


def _settle(game: Game, result: str) -> None:
    game.status = "finished"
    game.result = result
    if result == "win":
        game.bankroll += game.bet_amount * 2
    elif result == "blackjack":
        game.bankroll += game.bet_amount * 2.5
    elif result == "push":
        game.bankroll += game.bet_amount


def _resolve_round(game: Game) -> None:
    """Play and settle the dealer hand after the player stands or reaches 21."""
    while _score(game.dealer_hand) < 17:
        game.dealer_hand.append(_draw(game))

    player_score = _score(game.player_hand)
    dealer_score = _score(game.dealer_hand)
    if dealer_score > 21 or player_score > dealer_score:
        _settle(game, "win")
    elif player_score == dealer_score:
        _settle(game, "push")
    else:
        _settle(game, "loss")


def _view(game: Game) -> dict:
    reveal_dealer = game.status != "playing"
    return {
        "game_id": game.game_id,
        "bankroll": round(game.bankroll, 2),
        "bet_amount": round(game.bet_amount, 2),
        "status": game.status,
        "player_hand": game.player_hand,
        "player_score": _score(game.player_hand) if game.player_hand else 0,
        "dealer_hand": game.dealer_hand if reveal_dealer else game.dealer_hand[:1],
        "dealer_score": _score(game.dealer_hand) if reveal_dealer and game.dealer_hand else None,
        "result": game.result,
    }


def _get_game(game_id: str) -> Game:
    game = games.get(game_id)
    if game is None:
        raise HTTPException(status_code=404, detail="Game not found")
    return game


@router.post("/games", status_code=201)
def create_game(request: NewGameRequest = NewGameRequest()):
    """Create a session with a starting bankroll (defaults to $100)."""
    game_id = str(uuid.uuid4())
    game = Game(game_id=game_id, bankroll=round(request.bankroll, 2))
    games[game_id] = game
    return _view(game)


@router.get("/games/{game_id}")
def get_game(game_id: str):
    return _view(_get_game(game_id))


@router.get("/games/{game_id}/advice")
def get_game_advice(game_id: str):
    """Return the best hit/stand choice and net EVs for the current hand."""
    game = _get_game(game_id)
    if game.status != "playing" or len(game.dealer_hand) < 2:
        raise HTTPException(status_code=409, detail="Advice is available during the player's turn")

    advice = recommend_move(game.player_hand, game.dealer_hand[0], game.bet_amount)
    return {**advice, "bet_amount": round(game.bet_amount, 2)}


@router.post("/explain-ev")
def explain_ev(request: EVExplanationRequest):
    """Ask Gemini to explain the game's EV values using the current visible state."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="Gemini is not configured. Set GEMINI_API_KEY in the environment and restart the backend.",
        )

    prompt = (
        "Explain this blackjack expected-value calculation for a curious average player, in plain language. "
        "Use the supplied facts accurately and do not recalculate or invent probabilities. Explain EV as a "
        "long-run average over repeated hands, that positive/negative values are net dollars relative to the "
        "already-placed bet, compare both choices, and say which is higher. Explain the actual method: exact "
        "enumeration for a single 52-card deck (2-9 four each, 10/J/Q/K sixteen total, aces four), accounting "
        "for visible player cards and dealer upcard, averaging over possible hidden dealer cards, dealer draws "
        "to at least 17, and for Hit considering each possible next card then the better of Hit/Stand from that "
        "resulting state. The calculation conditions the hidden-card possibilities on the fact this hand is "
        "still active (dealer did not start with blackjack). State that EV is not a prediction of this one hand "
        "and assumes this game's hit/stand rules; suits do not affect values. Keep it concise and accessible.\n\n"
        f"Current hand facts: {json.dumps(request.dict())}"
    )
    try:
        client = genai.Client()
        interaction = client.interactions.create(
            model="gemini-3.8-flash",
            input=prompt,
        )
        explanation = interaction.output_text.strip()
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Gemini could not explain this calculation. Please try again.") from exc

    if not explanation:
        raise HTTPException(status_code=502, detail="Gemini returned an empty explanation. Please try again.")
    return {"explanation": explanation}


@router.post("/games/{game_id}/bet")
def bet(game_id: str, request: BetRequest):
    """Place a bet and deal; a natural blackjack pays 3:2."""
    game = _get_game(game_id)
    if game.status == "playing":
        raise HTTPException(status_code=409, detail="Finish the current round first")
    if request.amount > game.bankroll:
        raise HTTPException(status_code=400, detail="Bet exceeds available bankroll")
    game.bankroll = round(game.bankroll - request.amount, 2)
    game.bet_amount = round(request.amount, 2)
    game.deck = _new_deck()
    game.player_hand = [_draw(game), _draw(game)]
    game.dealer_hand = [_draw(game), _draw(game)]
    game.result = None
    game.status = "playing"
    player_blackjack = _is_natural_blackjack(game.player_hand)
    dealer_blackjack = _is_natural_blackjack(game.dealer_hand)
    if player_blackjack and dealer_blackjack:
        _settle(game, "push")
    elif player_blackjack:
        _settle(game, "blackjack")
    elif dealer_blackjack:
        _settle(game, "loss")
    return _view(game)


@router.post("/games/{game_id}/hit")
def hit(game_id: str):
    """Draw one card for the player."""
    game = _get_game(game_id)
    if game.status != "playing":
        raise HTTPException(status_code=409, detail="There is no active round")
    game.player_hand.append(_draw(game))
    player_score = _score(game.player_hand)
    if player_score > 21:
        _settle(game, "loss")
    elif player_score == 21:
        _resolve_round(game)
    return _view(game)


@router.post("/games/{game_id}/stand")
def stand(game_id: str):
    """Stand, play the dealer hand to 17, and settle the round."""
    game = _get_game(game_id)
    if game.status != "playing":
        raise HTTPException(status_code=409, detail="There is no active round")
    _resolve_round(game)
    return _view(game)
