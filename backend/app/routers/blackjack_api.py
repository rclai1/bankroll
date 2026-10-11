"""Blackjack routes and in-memory game state.

A game has up to 3 players (index 0 is the human, the rest are CPUs driven by
agents from ``cpu_agents``) and a dealer. The human acts through
``hit/stand/double/surrender``; CPU turns are played one action per call to
``cpu_turn`` because each CPU action takes several seconds.
"""

from __future__ import annotations

import asyncio
import os
import random
import uuid
import json
from dataclasses import dataclass, field
from typing import Literal

from google import genai
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from .strategy import recommend_move
from .database import get_daily_game, save_daily_score

from .cpu_agents import (
    MIN_BET,
    Action,
    CpuAgent,
    CpuContext,
    bet_for_choice,
    get_cpu_agent,
    timed_cpu_action,
    timed_cpu_bet,
)

router = APIRouter()
RANKS = ("2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A")
SUITS = ("clubs", "diamonds", "hearts", "spades")
MAX_PLAYERS = 3

PlayerStatus = Literal["active", "stood", "double_down", "surrender", "bust", "out"]


@dataclass
class Player:
    kind: Literal["human", "cpu"]
    bankroll: float
    bet_amount: float = 0.0
    hand: list[str] = field(default_factory=list)
    player_status: PlayerStatus = "active"
    result: str | None = None  # win | loss | push | blackjack | surrender
    agent: CpuAgent | None = field(default=None, repr=False)


@dataclass
class Game:
    game_id: str
    players: list[Player]
    deck: list[str] = field(default_factory=list)
    dealer_hand: list[str] = field(default_factory=list)
    pot_amount: float = 0.0
    status: Literal["waiting_for_bet", "playing", "finished"] = "waiting_for_bet"
    current_player: int | None = None
    events: list[dict] = field(default_factory=list)  # events produced by the latest request
    round_log: list[dict] = field(default_factory=list)  # every event this round
    busy: bool = False  # a bet or CPU turn is in flight
    round: int = 0  # number of the current (or latest) round; 0 before the first deal
    rng: random.Random = field(default_factory=random.Random)
    daily_row_id: int | None = None
    daily_user_id: int | None = None
    daily_seed: int | None = None


games: dict[str, Game] = {}


class NewGameRequest(BaseModel):
    bankroll: float = Field(default=100.0, gt=0, le=1_000_000)
    cpu_count: int = Field(default=0, ge=0, le=MAX_PLAYERS - 1)


class BetRequest(BaseModel):
    amount: float = Field(gt=0, le=1_000_000)


class EVExplanationRequest(BaseModel):
    player_hand: list[str]
    dealer_upcard: str
    player_total: int
    bet_amount: float
    bankroll: float
    advice: dict[str, float | str]


# ---------------------------------------------------------------------------
# Cards and scoring
# ---------------------------------------------------------------------------


def _new_deck(rng: random.Random | None = None) -> list[str]:
    deck = [f"{rank} of {suit}" for suit in SUITS for rank in RANKS]
    generator = rng or random.Random(os.urandom(8))
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
        game.deck = _new_deck(game.rng)
    return game.deck.pop()


# ---------------------------------------------------------------------------
# Round logic
# ---------------------------------------------------------------------------


def _log(game: Game, actor: str, action: str, index: int | None = None, **extra) -> None:
    event = {"actor": actor, "action": action, **({"index": index} if index is not None else {}), **extra}
    game.events.append(event)
    game.round_log.append(event)


def _settle(player: Player, result: str) -> None:
    """Record a player's result and pay out (the bet was already deducted)."""
    player.result = result
    if result == "win":
        player.bankroll += player.bet_amount * 2
    elif result == "blackjack":
        player.bankroll += player.bet_amount * 2.5
    elif result == "push":
        player.bankroll += player.bet_amount
    elif result == "surrender":
        player.bankroll += player.bet_amount / 2
    player.bankroll = round(player.bankroll, 2)


def _is_live(player: Player) -> bool:
    """Still waiting to be compared against the dealer."""
    return player.result is None and player.player_status in ("stood", "double_down")


def _resolve_round(game: Game) -> None:
    """Play the dealer's hand (if anyone is still in) and settle every live player."""
    if len(game.dealer_hand) > 1:
        _log(game, "dealer", "flip", card=game.dealer_hand[1])
    live = [p for p in game.players if _is_live(p)]
    if live:
        while _score(game.dealer_hand) < 17:
            card = _draw(game)
            game.dealer_hand.append(card)
            _log(game, "dealer", "hit", card=card)
        dealer_score = _score(game.dealer_hand)
        for player in live:
            player_score = _score(player.hand)
            if dealer_score > 21 or player_score > dealer_score:
                _settle(player, "win")
            elif player_score == dealer_score:
                _settle(player, "push")
            else:
                _settle(player, "loss")
    game.status = "finished"
    game.current_player = None


def _advance(game: Game) -> None:
    """Move to the next active player, or resolve the round when nobody is left."""
    start = 0 if game.current_player is None else game.current_player + 1
    for index in range(start, len(game.players)):
        player = game.players[index]
        if player.player_status == "active" and player.result is None:
            game.current_player = index
            return
    _resolve_round(game)


def _legal_actions(game: Game, index: int) -> list[Action]:
    player = game.players[index]
    if game.status != "playing" or player.player_status != "active" or player.result is not None:
        return []
    actions = [Action.HIT, Action.STAND]
    if len(player.hand) == 2:  # first action only
        if player.bankroll >= player.bet_amount:
            actions.append(Action.DOUBLE_DOWN)
        actions.append(Action.SURRENDER)
    return actions


def _apply_hit(game: Game, index: int) -> None:
    player = game.players[index]
    card = _draw(game)
    player.hand.append(card)
    _log(game, "player", "hit", index, card=card)
    score = _score(player.hand)
    if score > 21:
        player.player_status = "bust"
        _settle(player, "loss")
        _log(game, "player", "bust", index)
        _advance(game)
    elif score == 21:
        player.player_status = "stood"
        _log(game, "player", "stand", index)
        _advance(game)


def _apply_stand(game: Game, index: int) -> None:
    game.players[index].player_status = "stood"
    _log(game, "player", "stand", index)
    _advance(game)


def _apply_double(game: Game, index: int) -> None:
    player = game.players[index]
    player.bankroll = round(player.bankroll - player.bet_amount, 2)
    game.pot_amount = round(game.pot_amount + player.bet_amount, 2)
    player.bet_amount = round(player.bet_amount * 2, 2)
    card = _draw(game)
    player.hand.append(card)
    player.player_status = "double_down"
    _log(game, "player", "double_down", index, card=card)
    if _score(player.hand) > 21:
        _settle(player, "loss")
        _log(game, "player", "bust", index)
    _advance(game)


def _apply_surrender(game: Game, index: int) -> None:
    player = game.players[index]
    player.player_status = "surrender"
    _settle(player, "surrender")
    _log(game, "player", "surrender", index)
    _advance(game)


_APPLY = {
    Action.HIT: _apply_hit,
    Action.STAND: _apply_stand,
    Action.DOUBLE_DOWN: _apply_double,
    Action.SURRENDER: _apply_surrender,
}


def _cpu_context(game: Game, index: int, *, betting: bool = False) -> CpuContext:
    player = game.players[index]
    others = [
        {
            "index": i,
            "kind": other.kind,
            "bankroll": round(other.bankroll, 2),
            "bet_amount": other.bet_amount,
            "hand": [] if betting else list(other.hand),
            "score": 0 if betting else _score(other.hand),
            "player_status": other.player_status,
            "result": other.result,
        }
        for i, other in enumerate(game.players)
        if i != index
    ]
    return CpuContext(
        index=index,
        bankroll=round(player.bankroll, 2),
        bet_amount=0.0 if betting else player.bet_amount,
        hand=[] if betting else list(player.hand),
        score=0 if betting else _score(player.hand),
        # Only the face-up card; the hole card (index 1) is never given to agents.
        dealer_upcard=None if betting or not game.dealer_hand else game.dealer_hand[0],
        others=others,
        legal_actions=[] if betting else _legal_actions(game, index),
        # While betting, round_log still holds the previous (finished, fully public) round,
        # so a CPU learns how it ended, including the dealer's play.
        events=list(game.round_log),
        round_number=game.round,
        result=player.result,
    )


# ---------------------------------------------------------------------------
# View
# ---------------------------------------------------------------------------


def _view(game: Game) -> dict:
    reveal_dealer = game.status != "playing"
    players = []
    for index, player in enumerate(game.players):
        players.append(
            {
                "index": index,
                "kind": player.kind,
                "bankroll": round(player.bankroll, 2),
                "bet_amount": round(player.bet_amount, 2),
                "hand": player.hand,
                "score": _score(player.hand) if player.hand else 0,
                "player_status": player.player_status,
                "result": player.result,
                "legal_actions": [a.value for a in _legal_actions(game, index)],
            }
        )
    return {
        "game_id": game.game_id,
        "status": game.status,
        "pot_amount": round(game.pot_amount, 2),
        "current_player": game.current_player,
        "players": players,
        "dealer_hand": game.dealer_hand if reveal_dealer else game.dealer_hand[:1],
        "dealer_score": _score(game.dealer_hand) if reveal_dealer and game.dealer_hand else None,
        "events": game.events,
    }


def _get_game(game_id: str) -> Game:
    game = games.get(game_id)
    if game is None:
        raise HTTPException(status_code=404, detail="Game not found")
    return game


def _ensure_daily_open(game: Game) -> None:
    if game.daily_row_id is None:
        return
    from .database import engine, get_seed
    from sqlalchemy import text

    with engine.connect() as connection:
        cashed_out = connection.execute(
            text("SELECT cash_out FROM games WHERE id = :id"), {"id": game.daily_row_id}
        ).scalar_one_or_none()
    if cashed_out is not False:
        raise HTTPException(status_code=409, detail="Daily game has been cashed out")
    if game.daily_seed != get_seed()["seed"]:
        raise HTTPException(status_code=409, detail="Daily seed has reset; reload Daily Mode")


def _persist_daily_round(game: Game) -> None:
    if game.daily_row_id is not None and game.status == "finished":
        save_daily_score(game.daily_row_id, game.players[0].bankroll)


def _require_human_turn(game: Game) -> None:
    if game.status != "playing":
        raise HTTPException(status_code=409, detail="There is no active round")
    if game.current_player != 0:
        raise HTTPException(status_code=409, detail="Not your turn")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post("/games", status_code=201)
def create_game(request: NewGameRequest = NewGameRequest()):
    """Create a session; every seat starts with the same bankroll (default $100)."""
    bankroll = round(request.bankroll, 2)
    players = [Player(kind="human", bankroll=bankroll)]
    players += [
        Player(kind="cpu", bankroll=bankroll, agent=get_cpu_agent()) for _ in range(request.cpu_count)
    ]
    game = Game(game_id=str(uuid.uuid4()), players=players)
    games[game.game_id] = game
    return _view(game)


@router.post("/daily/{user_id}")
def create_daily_game(user_id: int):
    """Resume or create a daily session with the server's current seed."""
    daily = get_daily_game(user_id)
    if daily["cash_out"]:
        return {"cash_out": True, "score": daily["curr_money"], "seed": daily["seed"]}
    existing = next(
        (game for game in games.values()
         if game.daily_row_id == daily["id"] and game.daily_seed == daily["seed"]),
        None,
    )
    if existing is not None:
        return {**_view(existing), "cash_out": False, "seed": daily["seed"]}
    game_id = str(uuid.uuid4())
    game = Game(
        game_id=game_id,
        players=[Player(kind="human", bankroll=round(float(daily["curr_money"]), 2))],
        rng=random.Random(int(daily["seed"])),
        daily_row_id=int(daily["id"]),
        daily_user_id=user_id,
        daily_seed=int(daily["seed"]),
    )
    games[game_id] = game
    return {**_view(game), "cash_out": False, "seed": daily["seed"]}


@router.get("/games/{game_id}")
def get_game(game_id: str):
    return _view(_get_game(game_id))


@router.get("/games/{game_id}/advice")
def get_game_advice(game_id: str):
    """Return the best hit/stand choice and net EVs for the current hand."""
    game = _get_game(game_id)
    if len(game.players) > 1:
        # The calculation assumes the only visible cards are the player's and the dealer's upcard.
        raise HTTPException(status_code=409, detail="Advice is only available in games without CPU players")
    human = game.players[0]
    if game.status != "playing" or game.current_player != 0 or len(game.dealer_hand) < 2:
        raise HTTPException(status_code=409, detail="Advice is available during the player's turn")

    advice = recommend_move(human.hand, game.dealer_hand[0], human.bet_amount)
    return {**advice, "bet_amount": round(human.bet_amount, 2)}


@router.post("/explain-ev")
def explain_ev(request: EVExplanationRequest):
    """Ask Gemini to explain the game's EV values using the current visible state."""
    api_key = os.environ.get("GEMINI_KEY") or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="Gemini is not configured. Set GEMINI_KEY in the project .env file and restart the backend.",
        )

    prompt = (
        "Explain this blackjack expected-value calculation for a curious blackjack player. "
        "Use the supplied facts accurately and do not recalculate or invent probabilities. Explain EV as a "
        "long-run average over repeated hands, that positive/negative values are net dollars relative to the "
        "already-placed bet, compare both choices, and say which is higher. Explain the actual method: exact "
        "enumeration for a single 52-card deck (2-9 four each, 10/J/Q/K sixteen total, aces four), accounting "
        "for visible player cards and dealer upcard, averaging over possible hidden dealer cards, dealer draws "
        "to at least 17, and for Hit considering each possible next card then the better of Hit/Stand from that "
        "resulting state. The calculation conditions the hidden-card possibilities on the fact this hand is "
        "still active (dealer did not start with blackjack). State that EV is not a prediction of this one hand "
        "and assumes this game's hit/stand rules; suits do not affect values. Be very concise and accessible "
        "with your explanation. "
        "When math, ensure every LaTeX "
        "expression is syntactically valid and fully enclosed: use $...$ for inline math and $$...$$ for display math. "
        "Do not put plain text inside mathematical expressions, such as within $..$ or $$..$$."
        "Check that all braces and parentheses are balanced before responding. Do not use backslashes. Make sure dollar amounts have $ (dollar sign). \n\n"
        f"Current hand facts: {json.dumps(request.dict())}"
    )
    try:
        client = genai.Client(api_key=api_key)
        interaction = client.interactions.create(
            model="gemini-3.8-flash",
            input=prompt,
            generation_config={
                "thinking_level": "medium"
            }
        )
        explanation = interaction.output_text.strip()
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Gemini could not explain this calculation. Please try again.") from exc

    if not explanation:
        raise HTTPException(status_code=502, detail="Gemini returned an empty explanation. Please try again.")
    return {"explanation": explanation}


@router.post("/games/{game_id}/bet")
async def bet(game_id: str, request: BetRequest):
    """Place the human's bet (CPUs choose theirs), deal, and settle any naturals."""
    game = _get_game(game_id)
    human = game.players[0]
    _ensure_daily_open(game)
    if game.status == "playing":
        raise HTTPException(status_code=409, detail="Finish the current round first")
    if game.busy:
        raise HTTPException(status_code=409, detail="A round is already being dealt")
    if human.bankroll <= 0:
        raise HTTPException(status_code=400, detail="You are out of money")
    if request.amount > human.bankroll:
        raise HTTPException(status_code=400, detail="Bet exceeds available bankroll")
    if request.amount < min(MIN_BET, human.bankroll):
        raise HTTPException(status_code=400, detail=f"Minimum bet is ${min(MIN_BET, human.bankroll):.2f}")

    game.busy = True
    try:
        # CPU bet choices are requested concurrently (max wait enforced per CPU).
        cpu_seats = [i for i, p in enumerate(game.players) if p.kind == "cpu" and p.bankroll > 0]
        choices = await asyncio.gather(
            *(timed_cpu_bet(game.players[i].agent, _cpu_context(game, i, betting=True)) for i in cpu_seats)
        )
        _start_round(game, round(request.amount, 2), dict(zip(cpu_seats, choices)))
    finally:
        game.busy = False
    _persist_daily_round(game)
    return _view(game)


def _start_round(game: Game, human_amount: float, cpu_choices: dict) -> None:
    game.round += 1
    game.events = []
    game.round_log = []
    game.deck = _new_deck(game.rng)
    game.dealer_hand = []
    game.current_player = None

    seated: list[Player] = []
    for index, player in enumerate(game.players):
        player.hand = []
        player.result = None
        player.bet_amount = 0.0
        if index == 0:
            player.bet_amount = human_amount
        elif index in cpu_choices:
            player.bet_amount = bet_for_choice(cpu_choices[index], player.bankroll)
        else:
            player.player_status = "out"
            continue
        player.bankroll = round(player.bankroll - player.bet_amount, 2)
        player.player_status = "active"
        seated.append(player)
        _log(game, "player", "bet", index, amount=player.bet_amount)

    game.pot_amount = round(sum(p.bet_amount for p in seated), 2)
    # Deal order: each seated player in seat order, then the dealer.
    for player in seated:
        player.hand = [_draw(game), _draw(game)]
    game.dealer_hand = [_draw(game), _draw(game)]
    game.status = "playing"

    dealer_natural = _is_natural_blackjack(game.dealer_hand)
    for player in seated:
        player_natural = _is_natural_blackjack(player.hand)
        if dealer_natural:
            player.player_status = "stood"
            _settle(player, "push" if player_natural else "loss")
        elif player_natural:
            player.player_status = "stood"
            _settle(player, "blackjack")
    _advance(game)


@router.post("/games/{game_id}/hit")
def hit(game_id: str):
    """Draw one card for the human."""
    game = _get_game(game_id)
    _ensure_daily_open(game)
    _require_human_turn(game)
    game.events = []
    _apply_hit(game, 0)
    _persist_daily_round(game)
    return _view(game)


@router.post("/games/{game_id}/stand")
def stand(game_id: str):
    """Stand; the next player (or the dealer) goes."""
    game = _get_game(game_id)
    _ensure_daily_open(game)
    _require_human_turn(game)
    game.events = []
    _apply_stand(game, 0)
    _persist_daily_round(game)
    return _view(game)


@router.post("/games/{game_id}/double")
def double_down(game_id: str):
    """Double the bet, take exactly one more card, then stand."""
    game = _get_game(game_id)
    _ensure_daily_open(game)
    _require_human_turn(game)
    human = game.players[0]
    if len(human.hand) != 2:
        raise HTTPException(status_code=409, detail="You can only double down on your first action")
    if human.bankroll < human.bet_amount:
        raise HTTPException(status_code=400, detail="Not enough bankroll to double down")
    game.events = []
    _apply_double(game, 0)
    _persist_daily_round(game)
    return _view(game)


@router.post("/games/{game_id}/surrender")
def surrender(game_id: str):
    """Give up the hand and get half the bet back."""
    game = _get_game(game_id)
    _ensure_daily_open(game)
    _require_human_turn(game)
    if len(game.players[0].hand) != 2:
        raise HTTPException(status_code=409, detail="You can only surrender on your first action")
    game.events = []
    _apply_surrender(game, 0)
    _persist_daily_round(game)
    return _view(game)


@router.post("/games/{game_id}/cpu_turn")
async def cpu_turn(game_id: str):
    """Play exactly one action for the CPU whose turn it is (takes ~3-15 s)."""
    game = _get_game(game_id)
    index = game.current_player
    if game.status != "playing" or index is None or game.players[index].kind != "cpu":
        raise HTTPException(status_code=409, detail="It is not a CPU's turn")
    if game.busy:
        raise HTTPException(status_code=409, detail="CPU is acting")

    game.busy = True
    try:
        game.events = []
        player = game.players[index]
        action = await timed_cpu_action(player.agent, _cpu_context(game, index))
        _APPLY[action](game, index)
    finally:
        game.busy = False
    return _view(game)
