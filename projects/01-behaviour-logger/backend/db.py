import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "events.db"


def get_connection():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT,
            event_type TEXT NOT NULL,
            element_id TEXT,
            scroll_depth INTEGER,
            reaction_type TEXT,
            timestamp TEXT NOT NULL
        )
        """
    )
    # Migrate existing schema: add reaction_type column if it doesn't exist
    try:
        cur.execute("ALTER TABLE events ADD COLUMN reaction_type TEXT")
    except sqlite3.OperationalError:
        # Column already exists, ignore
        pass
    conn.commit()
    conn.close()