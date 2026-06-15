import sqlite3
import json
from pathlib import Path
from contextlib import contextmanager

DB_PATH = Path(__file__).parent / "hexis.db"


@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS workspaces (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT NOT NULL UNIQUE,
                notion_token TEXT,
                anthropic_key TEXT,
                openai_key TEXT
            )
        """)
        for col in ("notion_token", "anthropic_key", "openai_key", "gemini_key"):
            try:
                conn.execute(f"ALTER TABLE workspaces ADD COLUMN {col} TEXT")
            except Exception:
                pass
        conn.execute("""
            CREATE TABLE IF NOT EXISTS runs (
                id TEXT PRIMARY KEY,
                workflow_id TEXT NOT NULL,
                workspace_id TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                duration_ms INTEGER,
                status TEXT NOT NULL,
                input_snapshot TEXT,
                prompt_snapshot TEXT,
                output_content TEXT,
                model TEXT,
                token_count INTEGER,
                node_outputs TEXT,
                fingerprints TEXT
            )
        """)
        # migrate existing DBs
        for col in ("node_outputs", "fingerprints", "git_commit_hash"):
            try:
                conn.execute(f"ALTER TABLE runs ADD COLUMN {col} TEXT")
            except Exception:
                pass
