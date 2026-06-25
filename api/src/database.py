import os, sqlite3
from datetime import datetime
from pathlib import Path

from .utils import TRASH_TAG_NAME, note_content_fingerprint, note_fingerprint

_config = None

def init_db(config):

    global _config
    _config = config

    conn = get_connection()
    cur = conn.cursor()

    cur.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        created_at TEXT NOT NULL
    )
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        is_important INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL
    )
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS note_tags (
        note_id INTEGER NOT NULL,
        tag_id INTEGER NOT NULL,
        PRIMARY KEY (note_id, tag_id),
        FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    )
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        note_id INTEGER NOT NULL,
        filename_original TEXT NOT NULL,
        filename_stored TEXT NOT NULL,
        uploaded_at TEXT NOT NULL,
        FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
    )
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS note_tombstones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        note_hash TEXT NOT NULL,
        content_hash TEXT,
        source_note_id INTEGER,
        deleted_at TEXT NOT NULL,
        UNIQUE(user_id, note_hash)
    )
    """)

    cur.execute("PRAGMA table_info(note_tombstones)")
    tombstone_columns = {row["name"] for row in cur.fetchall()}
    if "content_hash" not in tombstone_columns:
        cur.execute("ALTER TABLE note_tombstones ADD COLUMN content_hash TEXT")

    cur.execute("""
    CREATE INDEX IF NOT EXISTS idx_note_tombstones_user_hash
    ON note_tombstones(user_id, note_hash)
    """)

    cur.execute("""
    CREATE INDEX IF NOT EXISTS idx_note_tombstones_user_content_hash
    ON note_tombstones(user_id, content_hash)
    """)

    # -------------------------------------------
    # 全文検索用インデックス (未使用)
    # -------------------------------------------

    cur.execute("""
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        title,
        content,
        content='notes',
        content_rowid='id'
    )
    """)

    cur.execute("""
    CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
        INSERT INTO notes_fts(rowid, title, content)
        VALUES (new.id, new.title, new.content);
    END;
    """)

    cur.execute("""
    CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
        DELETE FROM notes_fts WHERE rowid = old.id;
    END;
    """)

    cur.execute("""
    CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
        DELETE FROM notes_fts WHERE rowid = old.id;
        INSERT INTO notes_fts(rowid, title, content)
        VALUES (new.id, new.title, new.content);
    END;
    """)

    cur.execute("""
        SELECT n.id, n.user_id, n.title, n.content, n.updated_at
        FROM notes n
        JOIN note_tags nt ON n.id = nt.note_id
        JOIN tags t ON nt.tag_id = t.id
        WHERE upper(t.name) = ?
    """, (TRASH_TAG_NAME,))
    for row in cur.fetchall():
        cur.execute("""
            INSERT INTO note_tombstones
                (user_id, note_hash, content_hash, source_note_id, deleted_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id, note_hash) DO UPDATE SET
                content_hash = excluded.content_hash,
                source_note_id = excluded.source_note_id,
                deleted_at = excluded.deleted_at
        """, (
            row["user_id"],
            note_fingerprint(row["title"], row["content"]),
            note_content_fingerprint(row["content"]),
            row["id"],
            row["updated_at"] or datetime.utcnow().isoformat(),
        ))

    conn.commit()
    conn.close()


def get_connection():

    if _config is None:
        raise RuntimeError("init_db(config) が呼ばれていません")

    db_cfg = _config.get("database", {})
    db_type = db_cfg.get("type", "sqlite")

    if db_type == "sqlite":

        ## db_path = _config["database"]["path"]
        ## os.makedirs(os.path.dirname(db_path), exist_ok=True)

        db_path = Path(db_cfg.get("path", "/data/simplynote.db"))
        db_path.parent.mkdir(parents=True, exist_ok=True)

        conn = sqlite3.connect(db_path, timeout=10.0, check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA foreign_keys=ON;")
        conn.row_factory = sqlite3.Row  # 辞書形式で取得

        return conn

    else:
        raise NotImplementedError(f"Unsupported database type: {db_type}")
