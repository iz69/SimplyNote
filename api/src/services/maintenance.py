import logging

from ..database import get_connection
from ..config import load_config
from ..utils import TRASH_TAG_NAME
from .tombstones import add_note_tombstone

config = load_config()
logger = logging.getLogger("maintenance")


def purge_expired_trashed_notes(cur, user_id=None):
    """期限切れのゴミ箱ノートを削除"""

    trash_conf = (config or {}).get("trash", {})

    if trash_conf.get("enabled") and trash_conf.get("auto_empty_days", 0) > 0:
        days = int(trash_conf["auto_empty_days"])

        if user_id:
            cur.execute("""
                SELECT n.id, n.user_id, n.title, n.content
                FROM notes n
                JOIN note_tags nt ON n.id = nt.note_id
                JOIN tags t ON nt.tag_id = t.id
                WHERE upper(t.name) = ?
                  AND n.user_id = ?
                  AND n.updated_at < datetime('now', ?)
            """, (TRASH_TAG_NAME, user_id, f'-{days} days'))

        else:
            cur.execute("""
                SELECT n.id, n.user_id, n.title, n.content
                FROM notes n
                JOIN note_tags nt ON n.id = nt.note_id
                JOIN tags t ON nt.tag_id = t.id
                WHERE upper(t.name) = ?
                  AND n.updated_at < datetime('now', ?)
            """, (TRASH_TAG_NAME, f'-{days} days'))

        rows = cur.fetchall()
        for row in rows:
            add_note_tombstone(cur, row["user_id"], row["title"], row["content"], row["id"])

        cnt = 0
        if rows:
            placeholders = ",".join(["?"] * len(rows))
            cur.execute(
                f"DELETE FROM notes WHERE id IN ({placeholders})",
                [row["id"] for row in rows],
            )
            cnt = cur.rowcount or 0

        if cnt > 0:
            logger.info(f"🗑️ Deleted {cnt} trashed notes older than {days} days")


def remove_orphan_note_tags(cur):
    """孤立したnote_tagsを削除"""
    cur.execute("""
        DELETE FROM note_tags
        WHERE note_id NOT IN (SELECT id FROM notes)
    """)
    cnt = cur.rowcount or 0
    if cnt > 0:
        logger.info(f"🧹 Deleted {cnt} orphaned note_tags")


def remove_unused_tags(cur):
    """未使用タグを削除"""
    cur.execute("""
        DELETE FROM tags
        WHERE id NOT IN (SELECT DISTINCT tag_id FROM note_tags)
    """)
    cnt = cur.rowcount or 0
    if cnt > 0:
        logger.info(f"🧽 Deleted {cnt} unused tags")


def run_maintenance(user_id=None):
    """メンテナンス処理を実行"""

    conn = get_connection()
    cur = conn.cursor()

    # 順番はこの通りで
    purge_expired_trashed_notes(cur, user_id=user_id)
    remove_orphan_note_tags(cur)
    remove_unused_tags(cur)

    conn.commit()
    conn.close()
