"""Password hashing, deliberately free of any configuration dependencies.

Kept separate from auth.py so that tools which only need to hash a password —
notably migration/import_to_postgres.py — don't have to supply a JWT secret or a
database URL just to import it.

Uses PBKDF2-HMAC-SHA256 from the stdlib. scrypt would be the stronger choice on
paper, but `hashlib.scrypt` is only present when Python was built against an
OpenSSL that exposes it — macOS system Python is a common build where it is
missing, and the import script has to run there. PBKDF2 is always available, and
at this iteration count (OWASP's current PBKDF2-SHA256 guidance) it is a sound
choice for an app with a handful of accounts.

Stored format:  pbkdf2_sha256$<iterations>$<salt_b64>$<hash_b64>
"""

import base64
import hashlib
import hmac
import secrets

_ALGORITHM = "pbkdf2_sha256"
_ITERATIONS = 600_000
_SALT_BYTES = 16
_DKLEN = 32


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(_SALT_BYTES)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, _ITERATIONS, dklen=_DKLEN
    )
    return "{}${}${}${}".format(
        _ALGORITHM,
        _ITERATIONS,
        base64.b64encode(salt).decode(),
        base64.b64encode(digest).decode(),
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, iterations, salt_b64, hash_b64 = stored.split("$")
        if algorithm != _ALGORITHM:
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(hash_b64)
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt, int(iterations), dklen=len(expected)
        )
    except (ValueError, TypeError):
        return False
    # Constant-time: a timing difference here would leak the hash prefix.
    return hmac.compare_digest(digest, expected)
