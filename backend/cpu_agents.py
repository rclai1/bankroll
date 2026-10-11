"""CPU player framework: the seam where an AI (Google Gemini) plugs in.

A CPU seat owns a ``CpuAgent``. The game gives it a ``CpuContext`` (only what a
real player could see: never the dealer's hole card) and the agent answers with
a ``BetChoice`` or an ``Action``. The server, not the agent, enforces rules:

* ``timed_cpu_action`` gives an agent at most ``CPU_MAX_ACTION_SECONDS``; on
  timeout, an exception, or an illegal answer the CPU simply stands.
* It also holds the answer back so a CPU never acts faster than
  ``CPU_MIN_ACTION_SECONDS`` (gives the UI a believable "thinking" time).
* ``timed_cpu_bet`` is the same for bets (fallback: minimum bet, no minimum delay).

Agents must not block the event loop: wrap any synchronous SDK call in
``asyncio.to_thread`` or the timeout cannot interrupt it.

``GeminiCpuAgent`` keeps one Gemini conversation per seat (a chain of
``interaction.id`` values), so a CPU remembers its own earlier bets and plays
but never sees another seat's reasoning. All seats share one HTTP client.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Protocol

from dotenv import load_dotenv

# Same project-root .env that database.py reads.
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

logger = logging.getLogger("cpu_agents")

MIN_BET = 10.0
CPU_MIN_ACTION_SECONDS = 3.0
CPU_MAX_ACTION_SECONDS = 15.0

GEMINI_MODEL = "gemini-3.1-flash-lite"
# A seat starts a fresh conversation after this many calls (bets + actions) to
# keep token use and latency bounded. Safe because every prompt is a full snapshot.
GEMINI_MAX_CHAIN_TURNS = 40
# How hard the model "thinks" before answering; lower is faster. One of
# minimal | low | medium | high. Override with env GEMINI_THINKING_LEVEL
# ("default" or empty = leave it to the API).
GEMINI_THINKING_LEVEL = "low"
_THINKING_LEVELS = ("minimal", "low", "medium", "high")
# How many times the SDK re-sends a failed request on its own (default in the
# SDK is 3, i.e. up to 4 requests per call, which can outlast our 15 s cap and
# spend extra rate limit). 0 = never retry; the game already has its own
# fallbacks. Override with env GEMINI_SDK_RETRIES.
GEMINI_SDK_RETRIES = 0


class BetChoice(str, Enum):
    MIN = "min"
    PCT_25 = "25%"
    PCT_50 = "50%"
    PCT_75 = "75%"
    ALL_IN = "all_in"


class Action(str, Enum):
    HIT = "hit"
    STAND = "stand"
    DOUBLE_DOWN = "double_down"
    SURRENDER = "surrender"


_BET_FRACTIONS = {BetChoice.PCT_25: 0.25, BetChoice.PCT_50: 0.5, BetChoice.PCT_75: 0.75}


def bet_for_choice(choice: BetChoice, bankroll: float) -> float:
    """Turn a choice into an amount in ``[min(MIN_BET, bankroll), bankroll]``."""
    floor = min(MIN_BET, bankroll)
    if choice is BetChoice.ALL_IN:
        amount = bankroll
    elif choice is BetChoice.MIN:
        amount = floor
    else:
        amount = bankroll * _BET_FRACTIONS[choice]
    return round(min(bankroll, max(floor, amount)), 2)


@dataclass
class CpuContext:
    """Everything an agent is allowed to see when deciding."""

    index: int
    bankroll: float
    bet_amount: float
    hand: list[str]
    score: int
    # The dealer's face-up card only; the hole card is never exposed.
    dealer_upcard: str | None
    # Other seats' public info: index, kind, bankroll, bet_amount, hand, score, player_status, result.
    others: list[dict]
    legal_actions: list[Action]
    # Events of the current round so far (bets, hits, stands...). When choosing a
    # bet this is the previous round's full log, including the dealer's play.
    events: list[dict] = field(default_factory=list)
    # Which round `events` belong to (lets an agent tell what it has already seen).
    round_number: int = 0
    # This seat's result in the latest round (win/loss/push/blackjack/surrender) or None.
    result: str | None = None


class CpuAgent(Protocol):
    async def choose_bet(self, ctx: CpuContext) -> BetChoice: ...

    async def choose_action(self, ctx: CpuContext) -> Action: ...


class DefaultCpuAgent:
    """Placeholder: bets the minimum, hits below 17, otherwise stands."""

    async def choose_bet(self, ctx: CpuContext) -> BetChoice:
        return BetChoice.MIN

    async def choose_action(self, ctx: CpuContext) -> Action:
        if ctx.score < 17 and Action.HIT in ctx.legal_actions:
            return Action.HIT
        return Action.STAND


# ---------------------------------------------------------------------------
# Gemini
# ---------------------------------------------------------------------------

SYSTEM_INSTRUCTION = (
    "You are a human-like blackjack player sitting at a table with a dealer and other players. "
    "Your goal is to grow your bankroll over many rounds. Play like a thoughtful person at a casino table.\n"
    "Rules: the dealer draws to 17 and stands on 17 or more. A natural blackjack pays 3:2. "
    "You only see the dealer's face-up card, never the hole card.\n"
    "Bet options (the choice you give is one of these exact values): "
    "'min' = the $10 minimum bet (or your whole bankroll if you have less than $10), "
    "'25%', '50%', '75%' = that share of your bankroll, 'all_in' = your whole bankroll.\n"
    "Actions: 'hit' = take a card, 'stand' = keep your hand, "
    "'double_down' = double your bet and receive exactly one more card, "
    "'surrender' = give up and get half your bet back. "
    "double_down and surrender are only possible on your first action.\n"
    "Each message describes the current situation and what happened since your last turn. "
    "Answer only with the requested JSON."
)

_client: Any = None


class _RedactKeys(logging.Filter):
    """Safety net: never let an API key in a URL reach the log."""

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        redacted = re.sub(r"(key=)[^&\s\"]+", r"\1REDACTED", message)
        if redacted != message:
            record.msg, record.args = redacted, ()
        return True


def _configure_logging() -> None:
    """Show this module's INFO lines (per-call latency) on the server console.

    Level comes from env CPU_AGENT_LOG_LEVEL (default INFO). Unless
    CPU_AGENT_LOG_HTTP=0, the HTTP client's own log is shown too: one line per
    request the SDK actually sends, so any retry is visible. Only done once, and
    only when the real Gemini agent is used.
    """
    if logger.handlers:
        return
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    handler.addFilter(_RedactKeys())
    level = os.getenv("CPU_AGENT_LOG_LEVEL", "INFO").upper()
    targets = [logger]
    if os.getenv("CPU_AGENT_LOG_HTTP", "1") != "0":
        targets.append(logging.getLogger("httpx"))
    for target in targets:
        target.addHandler(handler)
        target.setLevel(level)
        target.propagate = False


def _sdk_retries() -> int:
    value = os.getenv("GEMINI_SDK_RETRIES", str(GEMINI_SDK_RETRIES)).strip()
    try:
        return max(0, int(value))
    except ValueError:
        logger.warning("Ignoring invalid GEMINI_SDK_RETRIES %r; using %d", value, GEMINI_SDK_RETRIES)
        return GEMINI_SDK_RETRIES


def _thinking_level() -> str | None:
    """The thinking level to send, or None to leave it to the API."""
    value = os.getenv("GEMINI_THINKING_LEVEL", GEMINI_THINKING_LEVEL).strip().lower()
    if value in ("", "default", "none"):
        return None
    if value not in _THINKING_LEVELS:
        logger.warning("Ignoring invalid GEMINI_THINKING_LEVEL %r (use one of %s)", value, ", ".join(_THINKING_LEVELS))
        return None
    return value


def _get_client() -> Any:
    """The one Gemini client shared by every CPU seat (conversations live in interaction ids, not here)."""
    global _client
    if _client is None:
        from google import genai  # imported lazily so the default agent works without the package
        from google.genai import types

        # The project .env names the key GEMINI_KEY; the SDK's own default is GEMINI_API_KEY.
        api_key = os.getenv("GEMINI_KEY") or os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_KEY was not found in the project .env file")
        _client = _build_client(genai, types, api_key)
    return _client


def _build_client(genai: Any, types: Any, api_key: str) -> Any:
    """A Gemini client whose Interactions calls retry ``_sdk_retries()`` times (default: never)."""
    retries = _sdk_retries()
    # The public retry option cannot go below one retry for Interactions calls
    # (attempts 0 and 1 both become max_retries=1), so set the count directly afterwards.
    client = genai.Client(
        api_key=api_key,
        http_options=types.HttpOptions(retry_options=types.HttpRetryOptions(attempts=max(1, retries))),
    )
    try:
        client.aio.interactions.sdk_configuration.retry_config.max_retries = retries
    except AttributeError:
        logger.warning("Could not change the SDK retry count; the SDK default (about 3 retries) stays in effect")
    return client


def _schema(field_name: str, values: list[str]) -> dict:
    return {
        "type": "object",
        "properties": {field_name: {"type": "string", "enum": values}},
        "required": [field_name],
    }


def _money(value: float) -> str:
    return f"${value:,.2f}"


def _seat_name(index: int, me: int, kinds: dict[int, str]) -> str:
    if index == me:
        return "You"
    return f"Seat {index} ({kinds.get(index, 'player')})"


def describe_event(event: dict, me: int, kinds: dict[int, str]) -> str:
    action = event.get("action")
    card = event.get("card")
    if event.get("actor") == "dealer":
        if action == "flip":
            return f"Dealer reveals the hole card: {card}"
        if action == "hit":
            return f"Dealer draws {card}"
        return f"Dealer {action}"
    who = _seat_name(event.get("index", -1), me, kinds)
    if action == "bet":
        return f"{who} bet {_money(event.get('amount', 0))}"
    if action == "hit":
        return f"{who} hit and drew {card}"
    if action == "double_down":
        return f"{who} doubled down and drew {card}"
    if action == "bust":
        return f"{who} went bust"
    if action == "stand":
        return f"{who} stood"
    return f"{who} {action}"


class GeminiCpuAgent:
    """One CPU seat driven by Gemini, with its own conversation chain.

    Both bets and actions go through the same chain (``previous_interaction_id``),
    so the seat remembers how it bet when it chooses to hit or stand. Each prompt
    still contains a full snapshot of the situation, so if the chain is lost
    (expired id, error) the next turn just starts a fresh one.
    """

    def __init__(self, client: Any = None, model: str = GEMINI_MODEL) -> None:
        if client is None:
            _configure_logging()
        self._client = client if client is not None else _get_client()
        self._model = model
        self._last_id: str | None = None
        self._turns = 0
        # What this seat has already been told, so prompts only carry what is new.
        self._seen_round: int | None = None
        self._seen_events = 0

    # -- prompts ---------------------------------------------------------

    def _new_events(self, ctx: CpuContext) -> list[dict]:
        if ctx.round_number == self._seen_round:
            return ctx.events[self._seen_events :]
        return ctx.events

    @staticmethod
    def _table(ctx: CpuContext) -> str:
        lines = []
        for other in ctx.others:
            line = (
                f"Seat {other['index']} ({other['kind']}): bankroll {_money(other['bankroll'])}, "
                f"bet {_money(other['bet_amount'])}, status {other['player_status']}"
            )
            if other.get("hand"):
                line += f", hand {', '.join(other['hand'])} (score {other['score']})"
            if other.get("result"):
                line += f", result {other['result']}"
            lines.append(line)
        return "\n".join(lines) if lines else "No other players."

    def build_prompt(self, ctx: CpuContext, *, betting: bool = False) -> str:
        kinds = {o["index"]: o["kind"] for o in ctx.others}
        events = [describe_event(e, ctx.index, kinds) for e in self._new_events(ctx)]
        since = "\n".join(f"- {e}" for e in events) if events else "- Nothing new."
        header = f"Your bankroll: {_money(ctx.bankroll)}."
        if betting:
            last = f" Your result last round: {ctx.result}." if ctx.result else ""
            return (
                f"New round. {header}{last}\n"
                f"Since your last turn:\n{since}\n"
                f"Other players:\n{self._table(ctx)}\n"
                'Choose your bet. Answer as JSON: {"choice": "<min|25%|50%|75%|all_in>"}.'
            )
        options = ", ".join(a.value for a in ctx.legal_actions)
        return (
            f"{header} Your bet: {_money(ctx.bet_amount)}.\n"
            f"Your hand: {', '.join(ctx.hand)} (score {ctx.score}). Dealer shows: {ctx.dealer_upcard}.\n"
            f"Since your last turn:\n{since}\n"
            f"Other players:\n{self._table(ctx)}\n"
            f'Choose your action from: {options}. Answer as JSON: {{"action": "<one of those>"}}.'
        )

    # -- API call --------------------------------------------------------

    async def _ask(self, prompt: str, schema: dict, *, kind: str, seat: int) -> dict:
        if self._turns >= GEMINI_MAX_CHAIN_TURNS:
            self._last_id, self._turns = None, 0
        request: dict[str, Any] = {
            "model": self._model,
            "input": prompt,
            "system_instruction": SYSTEM_INSTRUCTION,
            "store": True,  # chaining with previous_interaction_id needs stored interactions
            "response_format": {"type": "text", "mime_type": "application/json", "schema": schema},
            # Give up a little before the server-side cap so the SDK call is cancelled cleanly.
            "timeout": max(1.0, CPU_MAX_ACTION_SECONDS - 1.0),
        }
        level = _thinking_level()
        if level:
            request["generation_config"] = {"thinking_level": level}
        if self._last_id:
            request["previous_interaction_id"] = self._last_id
        label = f"{kind} (seat {seat}, chain turn {self._turns + 1}, thinking {level or 'default'}, {len(prompt)} chars)"
        started = time.monotonic()
        try:
            interaction = await self._client.aio.interactions.create(**request)
        except asyncio.CancelledError:
            # Our own CPU_MAX_ACTION_SECONDS cap fired (asyncio.wait_for cancels the call).
            logger.warning("Gemini %s cancelled after %.2fs (hit the %.0fs CPU cap)", label, time.monotonic() - started, CPU_MAX_ACTION_SECONDS)
            raise
        except Exception as exc:
            logger.warning("Gemini %s failed after %.2fs: %s: %s", label, time.monotonic() - started, type(exc).__name__, exc)
            # A 4xx while continuing a chain most likely means the stored interaction is gone.
            status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
            if self._last_id and status in (400, 404):
                logger.warning("Gemini rejected the saved conversation id; starting a new chain")
                self._last_id, self._turns = None, 0
            raise
        logger.info("Gemini %s answered in %.2fs", label, time.monotonic() - started)
        # Only advance the chain once the model really answered (a cancelled/failed call leaves it alone).
        self._last_id = interaction.id
        self._turns += 1
        return json.loads(interaction.output_text)

    def _mark_seen(self, ctx: CpuContext) -> None:
        self._seen_round = ctx.round_number
        self._seen_events = len(ctx.events)

    async def choose_bet(self, ctx: CpuContext) -> BetChoice:
        data = await self._ask(
            self.build_prompt(ctx, betting=True),
            _schema("choice", [c.value for c in BetChoice]),
            kind="bet",
            seat=ctx.index,
        )
        self._mark_seen(ctx)
        return BetChoice(data["choice"])

    async def choose_action(self, ctx: CpuContext) -> Action:
        if not ctx.legal_actions:
            return Action.STAND
        data = await self._ask(
            self.build_prompt(ctx),
            _schema("action", [a.value for a in ctx.legal_actions]),
            kind="action",
            seat=ctx.index,
        )
        self._mark_seen(ctx)
        return Action(data["action"])


def get_cpu_agent() -> CpuAgent:
    """Pick the agent for a new CPU seat from env ``CPU_AGENT`` (default | gemini).

    If Gemini is requested but unavailable (no key, package missing), the game
    still starts and that seat uses the default agent.
    """
    if os.getenv("CPU_AGENT", "default").lower() == "gemini":
        try:
            return GeminiCpuAgent()
        except Exception as exc:
            logger.warning("Gemini CPU agent unavailable (%s: %s); using the default agent", type(exc).__name__, exc)
    return DefaultCpuAgent()


# ---------------------------------------------------------------------------
# Timing / fallbacks
# ---------------------------------------------------------------------------


async def timed_cpu_action(agent: CpuAgent, ctx: CpuContext) -> Action:
    """Agent's action within the time window; stands on timeout/error/illegal move."""
    started = time.monotonic()
    try:
        action = await asyncio.wait_for(agent.choose_action(ctx), timeout=CPU_MAX_ACTION_SECONDS)
        if not isinstance(action, Action) or action not in ctx.legal_actions:
            logger.warning("CPU %s gave an illegal action %r; standing", ctx.index, action)
            action = Action.STAND
    except Exception as exc:  # includes asyncio timeout
        logger.warning("CPU %s action failed (%s: %s); standing", ctx.index, type(exc).__name__, exc)
        action = Action.STAND
    remaining = CPU_MIN_ACTION_SECONDS - (time.monotonic() - started)
    if remaining > 0:
        await asyncio.sleep(remaining)
    return action


async def timed_cpu_bet(agent: CpuAgent, ctx: CpuContext) -> BetChoice:
    """Agent's bet choice within the max window; falls back to the minimum bet."""
    try:
        choice = await asyncio.wait_for(agent.choose_bet(ctx), timeout=CPU_MAX_ACTION_SECONDS)
        if not isinstance(choice, BetChoice):
            logger.warning("CPU %s gave an invalid bet %r; betting the minimum", ctx.index, choice)
            choice = BetChoice.MIN
    except Exception as exc:
        logger.warning("CPU %s bet failed (%s: %s); betting the minimum", ctx.index, type(exc).__name__, exc)
        choice = BetChoice.MIN
    return choice
