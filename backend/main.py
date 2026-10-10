"""Application entry point for the Bankroll API."""

from fastapi import FastAPI

from blackjack_api import router as blackjack_router
from auth_endpoints import router as auth_router
from database import create_tables, router as database_router


app = FastAPI(title="Bankroll API", version="1.0.0")
app.include_router(database_router)
app.include_router(auth_router)
app.include_router(blackjack_router)


@app.on_event("startup")
def initialize_database() -> None:
    create_tables()
