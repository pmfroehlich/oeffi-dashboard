"""Service for managing dashboard data in SQLite database."""
import json
import secrets
import sqlite3
from typing import Optional, Dict, List, Any


class DashboardService:
    """Service for CRUD operations on dashboards stored in SQLite."""

    def __init__(self, db_path: str) -> None:
        """
        Initialize the dashboard service.

        Args:
            db_path: Path to the SQLite database file (e.g., "data/app.db")
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
                CREATE TABLE IF NOT EXISTS dashboards (
                    id TEXT PRIMARY KEY,
                    owner_id INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    config TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_dashboards_owner ON dashboards(owner_id)")
            conn.commit()

    def _new_id(self) -> str:
        """
        Generate a new unique dashboard ID.

        Returns:
            A 32-character hexadecimal string
        """
        return secrets.token_hex(16)

    # ========================================================================
    # Public Methods (CRUD operations)
    # ========================================================================

    def create_dashboard(self, owner_id: int, name: str) -> str:
        """
        Create a new dashboard for an owner.

        Args:
            owner_id: The owner's ID
            name: The dashboard name

        Returns:
            The newly created dashboard ID
        """
        dash_id = self._new_id()
        config = {"name": name, "stations": [], "columns": None}
        with self._connect() as conn:
            conn.execute("""
                INSERT INTO dashboards (id, owner_id, name, config, updated_at)
                VALUES (?, ?, ?, ?, datetime('now'))
            """, (dash_id, owner_id, name, json.dumps(config)))
            conn.commit()
        return dash_id

    def get_dashboard(self, owner_id: int, dash_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve a dashboard by ID, ensuring it belongs to the owner.

        Args:
            owner_id: The owner's ID
            dash_id: The dashboard ID

        Returns:
            Dictionary with dashboard data, or None if not found
        """
        with self._connect() as conn:
            row = conn.execute("""
                SELECT id, owner_id, name, config, updated_at
                FROM dashboards
                WHERE id = ? AND owner_id = ?
                LIMIT 1
            """, (dash_id, owner_id)).fetchone()

        if not row:
            return None

        out = dict(row)
        if isinstance(out.get("config"), str):
            try:
                out["config"] = json.loads(out["config"])
            except (json.JSONDecodeError, TypeError):
                out["config"] = {}
        return out

    def list_dashboards(self, owner_id: int) -> List[Dict[str, Any]]:
        """
        List all dashboards for a given owner.

        Args:
            owner_id: The owner's ID

        Returns:
            List of dictionaries containing dashboard id, name, and updated_at
        """
        with self._connect() as conn:
            rows = conn.execute("""
                SELECT id, name, updated_at
                FROM dashboards
                WHERE owner_id = ?
                ORDER BY updated_at DESC
            """, (owner_id,)).fetchall()
            return [dict(r) for r in rows]

    def update_dashboard(
        self, owner_id: int, dash_id: str, name: str, config: Dict[str, Any]
    ) -> bool:
        """
        Update an existing dashboard.

        Args:
            owner_id: The owner's ID
            dash_id: The dashboard ID
            name: The new dashboard name
            config: The dashboard configuration dictionary

        Returns:
            True if the dashboard was updated, False otherwise
        """
        with self._connect() as conn:
            cur = conn.execute("""
                UPDATE dashboards
                SET name = ?, config = ?, updated_at = datetime('now')
                WHERE id = ? AND owner_id = ?
            """, (name, json.dumps(config), dash_id, owner_id))
            conn.commit()
            return cur.rowcount > 0

    def delete_dashboard(self, owner_id: int, dash_id: str) -> bool:
        """
        Delete a dashboard.

        Args:
            owner_id: The owner's ID
            dash_id: The dashboard ID

        Returns:
            True if the dashboard was deleted, False otherwise
        """
        with self._connect() as conn:
            cur = conn.execute("""
                DELETE FROM dashboards
                WHERE id = ? AND owner_id = ?
            """, (dash_id, owner_id))
            conn.commit()
            return cur.rowcount > 0
