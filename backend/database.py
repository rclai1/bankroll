"""Database-backed API for users and the leaderboard."""

import os
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import (
    Column,
    BigInteger,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    UniqueConstraint,
    create_engine,
    text,
)

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
connection = os.getenv("CONNECTION")
if not connection:
    raise RuntimeError("CONNECTION was not found in the project .env file")

# SQLAlchemy's PostgreSQL dialect uses ``postgresql://`` (the older
# ``postgres://`` spelling is still accepted in local environment files).
connection_url = connection.replace("postgres", "timescaledb", 1)
engine = create_engine(connection_url, pool_pre_ping=True)

metadata = MetaData()
users = Table(
    "users",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("balance", BigInteger, nullable=False),
    Column("username", String(50), nullable=False, unique=True),
    Column("password", Text, nullable=False),
    Column("salt", Text, nullable=False),
)
high_scores = Table(
    "high_scores",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    Column("score", Float, nullable=False),
    UniqueConstraint("user_id", name="uq_high_scores_user_id"),
)
seed_table = Table(
    "seeds",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("seed", BigInteger, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
)

router = APIRouter()


class CreateHighScoreRequest(BaseModel):
    user_id: int = Field(gt=0)
    score: float = Field(ge=0, allow_inf_nan=False)


def create_tables() -> None:
    """Create the API tables if this is a fresh database."""
    metadata.create_all(engine)


def _current_seed_reset(now: datetime) -> datetime:
    """Return the current daily reset boundary in UTC."""
    reset = now.astimezone(timezone.utc).replace(
        hour=3, minute=0, second=0, microsecond=0
    )
    if now.astimezone(timezone.utc) < reset:
        reset -= timedelta(days=1)
    return reset


@router.get("/seed")
def get_seed():
    """Return the singleton seed for the current UTC day starting at 03:00."""
    now = datetime.now(timezone.utc)
    reset_at = _current_seed_reset(now)
    with engine.begin() as connection:
        result = connection.execute(
            text(
                """INSERT INTO seeds (id, seed, created_at)
                   VALUES (1, :seed, :created_at)
                   ON CONFLICT (id) DO UPDATE
                   SET seed = EXCLUDED.seed, created_at = EXCLUDED.created_at
                   WHERE seeds.created_at < :reset_at
                   RETURNING seed, created_at"""
            ),
            {
                "seed": secrets.randbits(63),
                "created_at": reset_at,
                "reset_at": reset_at,
            },
        )
        row = result.mappings().one_or_none()
        if row is None:
            row = connection.execute(
                text("SELECT seed, created_at FROM seeds WHERE id = 1")
            ).mappings().one()
        return dict(row)


@router.post("/high_scores", status_code=201)
def create_high_score(request: CreateHighScoreRequest):
    """Create or replace this user's single high score."""
    with engine.begin() as connection:
        user_exists = connection.execute(
            text("SELECT 1 FROM users WHERE id = :user_id"), {"user_id": request.user_id}
        ).scalar_one_or_none()
        if user_exists is None:
            raise HTTPException(status_code=404, detail="User not found")

        # The unique user_id constraint makes the upsert atomic and guarantees
        # no user can have more than one row in high_scores.
        result = connection.execute(
            text(
                """INSERT INTO high_scores (user_id, score)
                   VALUES (:user_id, :score)
                   ON CONFLICT (user_id) DO UPDATE SET score = EXCLUDED.score
                   RETURNING id, user_id, score"""
            ),
            {"user_id": request.user_id, "score": request.score},
        )
        return dict(result.mappings().one())


@router.get("/high_scores")
def list_high_scores():
    """Return scores from highest to lowest, with their usernames."""
    with engine.connect() as connection:
        result = connection.execute(
            text(
                """SELECT high_scores.id, high_scores.user_id, users.username, high_scores.score
                   FROM high_scores
                   JOIN users ON users.id = high_scores.user_id
                   ORDER BY high_scores.score DESC, high_scores.id ASC"""
            )
        )
        return [dict(row) for row in result.mappings()]
