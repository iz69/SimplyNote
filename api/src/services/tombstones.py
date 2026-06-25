from datetime import datetime, timezone

from ..utils import note_content_fingerprint, note_fingerprint


def add_note_tombstone(cur, user_id: int, title: str, content: str, source_note_id: int | None = None):
    deleted_at = datetime.now(timezone.utc).isoformat()
    note_hash = note_fingerprint(title, content)
    content_hash = note_content_fingerprint(content)
    cur.execute("""
        INSERT INTO note_tombstones
            (user_id, note_hash, content_hash, source_note_id, deleted_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, note_hash) DO UPDATE SET
            content_hash = excluded.content_hash,
            source_note_id = excluded.source_note_id,
            deleted_at = excluded.deleted_at
    """, (user_id, note_hash, content_hash, source_note_id, deleted_at))


def note_tombstone_exists(cur, user_id: int, title: str, content: str) -> bool:
    note_hash = note_fingerprint(title, content)
    content_hash = note_content_fingerprint(content)
    cur.execute("""
        SELECT 1
        FROM note_tombstones
        WHERE user_id = ?
          AND (note_hash = ? OR content_hash = ?)
        LIMIT 1
    """, (user_id, note_hash, content_hash))
    return cur.fetchone() is not None
