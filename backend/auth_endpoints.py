"""Registration and login endpoints."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from auth import hash_password, verify_password
from database import engine, users

router = APIRouter(prefix="/auth", tags=["authentication"])


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
                    password=password_fields["password_hash"],
                    salt=password_fields["password_salt"],
                )
                .returning(users.c.id, users.c.username)
            )
            return dict(result.mappings().one())
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

    return {"id": user["id"], "username": user["username"]}
