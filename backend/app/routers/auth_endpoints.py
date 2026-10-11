"""Registration and login endpoints."""

import hashlib
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from .auth import get_token_user_id, hash_password, issue_access_token, verify_password
from .database import auth_sessions, engine, users

router = APIRouter(prefix="/auth", tags=["authentication"])
bearer_scheme = HTTPBearer(auto_error=False)


def _start_session(user_id: int) -> str:
    token, expires_at = issue_access_token(user_id)
    with engine.begin() as connection:
        connection.execute(
            auth_sessions.insert().values(
                token_hash=hashlib.sha256(token.encode()).hexdigest(),
                user_id=user_id,
                expires_at=expires_at,
            )
        )
    return token


class CredentialsRequest(BaseModel):
    username: str = Field(min_length=1, max_length=50, strip_whitespace=True)
    password: str = Field(min_length=8, max_length=1024)


@router.post("/register", status_code=201)
def register(request: CredentialsRequest):
    """Create an account, storing a plain username and password hash."""
    password_fields = hash_password(request.password)
    try:
        with engine.begin() as connection:
            result = connection.execute(
                users.insert()
                .values(
                    username=request.username,
                    balance=10,
                    password=password_fields["password_hash"],
                    salt=password_fields["password_salt"],
                )
                .returning(users.c.id, users.c.username)
            )
            user = dict(result.mappings().one())
        token = _start_session(user["id"])
        return {**user, "access_token": token, "token_type": "bearer"}
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="Username already exists") from exc


@router.post("/login")
def login(request: CredentialsRequest):
    """Verify credentials and return the user's public account identity."""
    with engine.connect() as connection:
        user = connection.execute(
            select(users.c.id, users.c.username, users.c.password, users.c.salt)
            .where(users.c.username == request.username)
        ).mappings().one_or_none()

    if user is None or not verify_password(
        request.password, user["password"], user["salt"]
    ):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    token = _start_session(user["id"])
    return {
        "id": user["id"],
        "username": user["username"],
        "access_token": token,
        "token_type": "bearer",
    }


@router.get("/session")
def get_session(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
):
    if credentials is None:
        return None
    token = credentials.credentials
    user_id = get_token_user_id(token)
    if user_id is None:
        return None
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with engine.begin() as connection:
        user = connection.execute(
            select(users.c.id, users.c.username)
            .join(auth_sessions, users.c.id == auth_sessions.c.user_id)
            .where(
                auth_sessions.c.token_hash == token_hash,
                auth_sessions.c.expires_at > datetime.now(timezone.utc),
                users.c.id == user_id,
            )
        ).mappings().one_or_none()
        if user is None:
            connection.execute(auth_sessions.delete().where(auth_sessions.c.token_hash == token_hash))
            return None
        return dict(user)


@router.post("/logout", status_code=204)
def logout(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
):
    if credentials is not None:
        token_hash = hashlib.sha256(credentials.credentials.encode()).hexdigest()
        with engine.begin() as connection:
            connection.execute(auth_sessions.delete().where(auth_sessions.c.token_hash == token_hash))
