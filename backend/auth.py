"""Self-hosted auth — replaces Supabase Auth.

Password hashing lives in passwords.py, which has no config dependencies.
Tokens are HS256 JWTs signed with JWT_SECRET.

Supabase's bcrypt password hashes are not transferable here, so passwords are set
during import (see migration/import_to_postgres.py).
"""

import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from dotenv import load_dotenv
from fastapi import HTTPException, Request

import db
from passwords import hash_password, verify_password  # noqa: F401 — re-exported

load_dotenv()

JWT_SECRET = os.getenv("JWT_SECRET")
if not JWT_SECRET or len(JWT_SECRET) < 32:
    raise RuntimeError(
        "JWT_SECRET must be set to a random string of at least 32 characters. "
        "Generate one with: python3 -c 'import secrets; print(secrets.token_urlsafe(48))'"
    )

JWT_ALGORITHM = "HS256"
TOKEN_TTL_DAYS = int(os.getenv("TOKEN_TTL_DAYS", "30"))


def create_token(user_id: str, email: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "email": email,
        "iat": now,
        "exp": now + timedelta(days=TOKEN_TTL_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


class AuthUser:
    """Stands in for the Supabase user object. Route handlers only ever read
    `.id`, so this keeps every `user.id` call site working untouched."""

    __slots__ = ("id", "email")

    def __init__(self, id: str, email: str):
        self.id = id
        self.email = email


async def get_current_user(request: Request) -> AuthUser:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = auth_header.split(" ", 1)[1].strip()
    payload = decode_token(token)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")
    # Confirm the account still exists — a deleted user must not keep a live token.
    row = db.query_one("SELECT id, email FROM users WHERE id = %s", (user_id,))
    if not row:
        raise HTTPException(status_code=401, detail="Invalid token")
    return AuthUser(str(row["id"]), row["email"])


def authenticate(email: str, password: str) -> Optional[dict]:
    row = db.query_one(
        "SELECT id, email, password_hash FROM users WHERE lower(email) = lower(%s)",
        (email.strip(),),
    )
    if not row or not verify_password(password, row["password_hash"]):
        return None
    return row
