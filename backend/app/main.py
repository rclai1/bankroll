"""Application entry point for the Bankroll API."""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers.blackjack_api import router as blackjack_router
from .routers.auth_endpoints import router as auth_router
from .routers.database import create_tables, router as database_router


app = FastAPI(title="Bankroll API", version="1.0.0")
allowed_origins = [
    origin.strip().rstrip("/")
    for origin in os.getenv("FRONTEND_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(database_router)
app.include_router(auth_router)
app.include_router(blackjack_router)


@app.on_event("startup")
def initialize_database() -> None:
    create_tables()
