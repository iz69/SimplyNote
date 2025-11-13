import os, sqlite3
from datetime import datetime
from pathlib import Path

_config = None

def get_connection():

    if _config is None:
        raise RuntimeError("init_db(config) が呼ばれていません")

    db_cfg = _config.get("database", {})
    db_type = db_cfg.get("type", "sqlite")

    if db_type == "sqlite":

        db_path = Path(db_cfg.get("path", "./data/simplynote.db"))

        ## db_path = _config["database"]["path"]
        ## os.makedirs(os.path.dirname(db_path), exist_ok=True)

        db_path = Path(db_cfg.get("path", "./data/simplynote.db"))
        db_path.parent.mkdir(parents=True, exist_ok=True)

        conn = sqlite3.connect(db_path, timeout=10.0, check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.row_factory = sqlite3.Row  # 辞書形式で取得

        return conn

    else:
        raise NotImplementedError(f"Unsupported database type: {db_type}")


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

#    cur.execute("""
#    CREATE TABLE IF NOT EXISTS notes (
#        id INTEGER PRIMARY KEY AUTOINCREMENT,
#        user_id INTEGER NOT NULL,
#        title TEXT NOT NULL,
#        content TEXT NOT NULL,
#        is_important INTEGER NOT NULL DEFAULT 0,
#        created_at TEXT NOT NULL,
#        updated_at TEXT NOT NULL,
#        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
#    )
#    """)

    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='notes'")
    has_notes = cur.fetchone() is not None

    if has_notes:
        # カラムチェック
        cur.execute("PRAGMA table_info(notes)")
        columns = [row[1] for row in cur.fetchall()]

        if "is_important" not in columns:
            cur.execute("ALTER TABLE notes ADD COLUMN is_important INTEGER NOT NULL DEFAULT 0")

    else:
        cur.execute("""
            CREATE TABLE notes (
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

    conn.commit()
    conn.close()


