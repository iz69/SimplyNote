from fastapi import APIRouter, HTTPException, Depends

from ..database import get_connection
from ..auth import get_current_user, oauth2_scheme
from ..utils import normalize_tag_name
from ..services.maintenance import run_maintenance

router = APIRouter(tags=["tags"])


@router.post("/notes/{note_id}/tags")
def add_tag(note_id: int, tag: dict, token: str = Depends(oauth2_scheme)):

    conn = get_connection()
    cur = conn.cursor()

    current_user = get_current_user(token)
    user_id = current_user["id"]

    cur.execute("SELECT id FROM notes WHERE id=? AND user_id=?", (note_id, user_id))
    if not cur.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Note not found")

    # タグの正規化
    tag_name = normalize_tag_name(tag.get("name"))
    if not tag_name:
        conn.close()
        raise HTTPException(status_code=400, detail="Tag name required")

    # タグ作成
    cur.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (tag_name,))
    cur.execute("SELECT id FROM tags WHERE name=?", (tag_name,))
    tag_id = cur.fetchone()[0]

    # note_tags 関連付け
    cur.execute("INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)", (note_id, tag_id))

    conn.commit()

    run_maintenance(user_id=user_id)

    # タグ一覧を返す
    cur.execute("""
        SELECT t.name FROM tags t
        JOIN note_tags nt ON t.id = nt.tag_id
        WHERE nt.note_id=?
    """, (note_id,))
    tags = [row[0] for row in cur.fetchall()]

    conn.close()

    return {"note_id": note_id, "tags": tags}


@router.delete("/notes/{note_id}/tags/{tag_name}")
def remove_tag(note_id: int, tag_name: str, token: str = Depends(oauth2_scheme)):

    conn = get_connection()
    cur = conn.cursor()

    current_user = get_current_user(token)
    user_id = current_user["id"]

    cur.execute("SELECT id FROM notes WHERE id=? AND user_id=?", (note_id, user_id))
    if not cur.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Note not found")

    # タグID
    cur.execute("SELECT id FROM tags WHERE name=?", (tag_name,))
    tag_row = cur.fetchone()
    if not tag_row:
        conn.close()
        raise HTTPException(status_code=404, detail="Tag not found")
    tag_id = tag_row[0]

    # note_tags
    cur.execute("DELETE FROM note_tags WHERE note_id=? AND tag_id=?", (note_id, tag_id))
    conn.commit()

    run_maintenance(user_id=user_id)

    # タグ一覧を返す
    cur.execute("""
        SELECT t.name FROM tags t
        JOIN note_tags nt ON t.id = nt.tag_id
        WHERE nt.note_id=?
    """, (note_id,))
    tags = [row[0] for row in cur.fetchall()]

    conn.close()

    return {"note_id": note_id, "tags": tags}


@router.get("/tags")
def get_all_tags(token: str = Depends(oauth2_scheme)):
    conn = get_connection()
    cur = conn.cursor()

    current_user = get_current_user(token)
    user_id = current_user["id"]

    # ノート数にtrashタグを持つノートを含めない
    cur.execute("""
        SELECT t.name,
               COUNT(nt.note_id) AS note_count
        FROM tags t
        JOIN note_tags nt ON t.id = nt.tag_id
        JOIN notes n ON nt.note_id = n.id
        WHERE n.user_id = ?
          AND nt.note_id NOT IN (
              SELECT nt2.note_id
              FROM note_tags nt2
              JOIN tags t2 ON nt2.tag_id = t2.id
              WHERE LOWER(t2.name) = 'trash'
          )
        GROUP BY t.id
        ORDER BY t.name COLLATE NOCASE
    """, (user_id,))

    tags = [{"name": row[0], "note_count": row[1]} for row in cur.fetchall()]

    conn.close()
    return tags
