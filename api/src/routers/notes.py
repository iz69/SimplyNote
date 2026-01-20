from fastapi import APIRouter, HTTPException, Request, Depends, BackgroundTasks
from typing import Optional
from datetime import datetime, timezone
import os

from ..database import get_connection
from ..models import NoteCreate, NoteUpdate, NoteOut
from ..auth import get_current_user, oauth2_scheme
from ..config import load_config
from ..utils import normalize_newlines
from ..services.maintenance import run_maintenance

router = APIRouter(prefix="/notes", tags=["notes"])
config = load_config()


@router.get("", response_model=list[NoteOut])
def get_notes(request: Request, tag: Optional[str] = None, token: str = Depends(oauth2_scheme)):
    conn = get_connection()
    cur = conn.cursor()

    current_user = get_current_user(token)
    user_id = current_user["id"]

    if tag:
        # タグ検索 (未使用)
        cur.execute("""
            SELECT n.*,
                   GROUP_CONCAT(t2.name, ',') AS tags
            FROM notes n
            JOIN note_tags nt1 ON n.id = nt1.note_id
            JOIN tags t1 ON nt1.tag_id = t1.id
            LEFT JOIN note_tags nt2 ON n.id = nt2.note_id
            LEFT JOIN tags t2 ON nt2.tag_id = t2.id
            WHERE t1.name = ? AND n.user_id = ?
            GROUP BY n.id
            ORDER BY is_important DESC, updated_at DESC
        """, (tag, user_id))
    else:
        cur.execute("""
            SELECT n.*,
                   GROUP_CONCAT(t.name, ',') AS tags
            FROM notes n
            LEFT JOIN note_tags nt ON n.id = nt.note_id
            LEFT JOIN tags t ON nt.tag_id = t.id
            WHERE n.user_id = ?
            GROUP BY n.id
            ORDER BY is_important DESC, updated_at DESC
        """, (user_id,))

    notes = []
    for row in cur.fetchall():
        d = dict(row)
        d["tags"] = d["tags"].split(",") if d["tags"] else []

        # 添付ファイル
        cur2 = conn.cursor()
        cur2.execute(
            "SELECT id, filename_original, filename_stored FROM attachments WHERE note_id=?",
            (d["id"],),
        )
        files = [
            {
                "id": fid,
                "filename": fname,
                "url": f"/files/{stored}",
            }
            for fid, fname, stored in cur2.fetchall()
        ]
        cur2.close()
        d["files"] = files

        notes.append(d)

    conn.close()
    return notes


@router.get("/{note_id}", response_model=NoteOut)
def get_note(note_id: int, request: Request, token: str = Depends(oauth2_scheme)):
    conn = get_connection()
    cur = conn.cursor()

    current_user = get_current_user(token)
    user_id = current_user["id"]

    cur.execute("""
        SELECT n.*, GROUP_CONCAT(t.name, ',') AS tags
        FROM notes n
        LEFT JOIN note_tags nt ON n.id = nt.note_id
        LEFT JOIN tags t ON nt.tag_id = t.id
        WHERE n.id = ? AND n.user_id = ?
        GROUP BY n.id
    """, (note_id, user_id))
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Note not found")

    d = dict(row)

    # 重要マーク
    d["is_important"] = int(d["is_important"])

    # タグ
    d["tags"] = d["tags"].split(",") if d["tags"] else []

    # 添付ファイル
    cur.execute(
        "SELECT id, filename_original, filename_stored FROM attachments WHERE note_id=?",
        (note_id,),
    )
    files = [
        {
            "id": fid,
            "filename": fname,
            "url": f"/files/{stored}",
        }
        for fid, fname, stored in cur.fetchall()
    ]
    d["files"] = files

    conn.close()
    return d


@router.post("", response_model=NoteOut)
def create_note(note: NoteCreate, token: str = Depends(oauth2_scheme)):

    conn = get_connection()
    cur = conn.cursor()

    current_user = get_current_user(token)
    user_id = current_user["id"]

    now = datetime.now(timezone.utc).isoformat()

    # 改行コードの正規化
    content = normalize_newlines(note.content)

    cur.execute(
        "INSERT INTO notes (user_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        (user_id, note.title, content, now, now),
    )
    note_id = cur.lastrowid

    conn.commit()
    conn.close()

    # 添付ファイルとタグは別でAPIで
    return {
        "id": note_id,
        "title": note.title,
        "content": content,
        "is_important": 0,
        "tags": [],
        "files": [],
        "created_at": now,
        "updated_at": now,
    }


@router.put("/{note_id}", response_model=NoteOut)
def update_note(
    note_id: int,
    note: NoteUpdate,
    request: Request,
    token: str = Depends(oauth2_scheme),
):

    conn = get_connection()
    cur = conn.cursor()

    current_user = get_current_user(token)
    user_id = current_user["id"]

    now = datetime.now(timezone.utc).isoformat()

    # ノートの存在チェックとis_importantの取得
    cur.execute("SELECT is_important FROM notes WHERE id=? AND user_id=?", (note_id, user_id))
    row = cur.fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Note not found")
    is_important = int(row[0])

    # 改行コードの正規化
    content = normalize_newlines(note.content)

    # 更新
    cur.execute(
        "UPDATE notes SET title=?, content=?, updated_at=? WHERE id=? AND user_id=?",
        (note.title, content, now, note_id, user_id),
    )

    # 添付ファイル
    cur.execute("SELECT id, filename_original, filename_stored FROM attachments WHERE note_id=?", (note_id,))
    files = [
        {"id": fid, "filename": fname, "url": f"/files/{stored}"}
        for fid, fname, stored in cur.fetchall()
    ]

    # タグ情報
    cur.execute("SELECT t.name FROM tags t JOIN note_tags nt ON t.id = nt.tag_id WHERE nt.note_id = ?", (note_id,))
    tags = [row[0] for row in cur.fetchall()]

    conn.commit()
    conn.close()

    return {
        "id": note_id,
        "title": note.title,
        "content": content,
        "is_important": is_important,
        "tags": tags,
        "files": files,
        "updated_at": now,
    }


@router.delete("/{note_id}")
def delete_note(
    note_id: int,
    token: str = Depends(oauth2_scheme),
    background: BackgroundTasks = None
):
    conn = get_connection()
    cur = conn.cursor()

    current_user = get_current_user(token)
    user_id = current_user["id"]

    cur.execute("SELECT id FROM notes WHERE id=? AND user_id=?", (note_id, user_id))
    if not cur.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Note not found")

    deleted, files = _delete_notes_and_attachments(conn, cur, user_id, [note_id])
    conn.close()

    if background is not None:
        background.add_task(run_maintenance, user_id)

    for filename in files:
        path = os.path.join(config["upload"]["dir"], filename)
        try:
            if os.path.exists(path):
                os.remove(path)
        except Exception as e:
            print(f"⚠️ Failed to remove file {path}: {e}")

    if deleted == 0:
        raise HTTPException(status_code=404, detail="Note not found")

    return {"detail": "Note and attachments deleted"}


@router.put("/{note_id}/important")
def toggle_important(note_id: int, token: str = Depends(oauth2_scheme)):

    conn = get_connection()
    cur = conn.cursor()

    # 認証ユーザ
    current_user = get_current_user(token)
    user_id = current_user["id"]

    # ノート所有チェック & 現在の is_important を取得
    cur.execute("""
        SELECT is_important
        FROM notes
        WHERE id = ? AND user_id = ?
    """, (note_id, user_id),)
    row = cur.fetchone()

    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Note not found")

    current_flag = row["is_important"] or 0
    new_flag = 0 if current_flag else 1

    # 更新
    cur.execute("""
        UPDATE notes
        SET is_important = ?
        WHERE id = ? AND user_id = ?
    """, (new_flag, note_id, user_id),)

    conn.commit()
    conn.close()

    return {"note_id": note_id, "is_important": new_flag}


def _delete_notes_and_attachments(conn, cur, user_id: int, note_ids: list[int]):
    """ノートと添付ファイルを削除（内部関数）"""
    if not note_ids:
        return 0, []

    placeholders = ",".join(["?"] * len(note_ids))

    # 実ファイル削除用に filename_stored を回収
    cur.execute(
        f"SELECT filename_stored FROM attachments WHERE note_id IN ({placeholders})",
        note_ids,
    )
    files = [row[0] for row in cur.fetchall()]

    # attachments -> notes の順で削除
    cur.execute(
        f"DELETE FROM attachments WHERE note_id IN ({placeholders})",
        note_ids,
    )
    cur.execute(
        f"DELETE FROM notes WHERE user_id=? AND id IN ({placeholders})",
        [user_id, *note_ids],
    )
    deleted = cur.rowcount

    conn.commit()
    return deleted, files


# この関数は他のルーターからも使われるためエクスポート
def delete_notes_and_attachments(conn, cur, user_id: int, note_ids: list[int]):
    return _delete_notes_and_attachments(conn, cur, user_id, note_ids)
