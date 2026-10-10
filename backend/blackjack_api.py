"""Small in-memory blackjack API built with FastAPI.

Run with ``uvicorn blackjack_api:app --reload``. Each game is identified by a
game_id returned from ``POST /games``. Use persistent storage for multiple workers.
"""

from __future__ import annotations

import random
import uuid
from dataclasses import dataclass, field
from typing import Literal

import os

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="Blackjack API", version="1.0.0")
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


@app.post("/games", status_code=201)
def create_game(request: NewGameRequest = NewGameRequest()):
    """Create a session with a starting bankroll (defaults to $100)."""
    game_id = str(uuid.uuid4())
    game = Game(game_id=game_id, bankroll=round(request.bankroll, 2))
    games[game_id] = game
    return _view(game)


@app.get("/games/{game_id}")
def get_game(game_id: str):
    return _view(_get_game(game_id))


@app.post("/games/{game_id}/bet")
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
    player_blackjack = _score(game.player_hand) == 21
    dealer_blackjack = _score(game.dealer_hand) == 21
    if player_blackjack and dealer_blackjack:
        _settle(game, "push")
    elif player_blackjack:
        _settle(game, "blackjack")
    elif dealer_blackjack:
        _settle(game, "loss")
    return _view(game)


@app.post("/games/{game_id}/hit")
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


@app.post("/games/{game_id}/stand")
def stand(game_id: str):
    """Stand, play the dealer hand to 17, and settle the round."""
    game = _get_game(game_id)
    if game.status != "playing":
        raise HTTPException(status_code=409, detail="There is no active round")
    _resolve_round(game)
    return _view(game)
