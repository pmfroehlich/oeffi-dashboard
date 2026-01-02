"""Service for managing owner authentication tokens in SQLite database."""
import sqlite3
import secrets
from typing import Optional, Tuple


class OwnerService:
    """Service for managing owners and their authentication tokens."""

    def __init__(self, db_path: str) -> None:
        """
        Initialize the owner service.

        Args:
            db_path: Path to the SQLite database file
        """
        self.db_path = db_path
        self._init_schema()

    # ========================================================================
    # Private Methods
    # ========================================================================

    def _connect(self) -> sqlite3.Connection:
        """
        Create and return a database connection.

        Returns:
            SQLite connection with Row factory enabled
        """
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self) -> None:
        """Initialize database schema if it doesn't exist."""
        with self._connect() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS owners (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    token TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_owners_token ON owners(token)")
            conn.commit()

    # ========================================================================
    # Public Methods
    # ========================================================================

    def create_owner(self) -> Tuple[int, str]:
        """
        Create a new owner with a unique authentication token.

        Returns:
            Tuple of (owner_id, token)
        """
        token = secrets.token_urlsafe(32)
        with self._connect() as conn:
            cur = conn.execute("INSERT INTO owners (token) VALUES (?)", (token,))
            owner_id = cur.lastrowid
            conn.commit()
        return owner_id, token

    def get_owner_id_by_token(self, token: str) -> Optional[int]:
        """
        Retrieve owner ID by authentication token.

        Args:
            token: The authentication token

        Returns:
            Owner ID if token is valid, None otherwise
        """
        if not token:
            return None
        with self._connect() as conn:
            row = conn.execute(
                "SELECT id FROM owners WHERE token = ? LIMIT 1", (token,)
            ).fetchone()
        return int(row["id"]) if row else None
