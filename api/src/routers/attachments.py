from fastapi import APIRouter, HTTPException, Request, Depends, UploadFile, File
from pathlib import Path
from datetime import datetime, timezone
import os
import shutil
import uuid
import logging

from ..database import get_connection
from ..auth import get_current_user, oauth2_scheme
from ..config import load_config

router = APIRouter(tags=["attachments"])
config = load_config()


@router.post("/notes/{note_id}/attachments")
def upload_attachment(
    note_id: int,
    request: Request,
    file: UploadFile = File(...),
    token: str = Depends(oauth2_scheme),
):

    conn = get_connection()
    cur = conn.cursor()

    current_user = get_current_user(token)
    user_id = current_user["id"]

    cur.execute("SELECT id FROM notes WHERE id=? AND user_id=?", (note_id, user_id))
    if not cur.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Note not found")

    upload_dir = config["upload"]["dir"]
    max_size_bytes = config["upload"]["max_size_mb"] * 1024 * 1024
    os.makedirs(upload_dir, exist_ok=True)

    # ファイル名衝突回避
    ext = Path(file.filename).suffix
    safe_name = f"{uuid.uuid4().hex}{ext}"
    dest_path = os.path.join(upload_dir, safe_name)

    # サイズ制限
    file.file.seek(0, os.SEEK_END)
    size = file.file.tell()
    file.file.seek(0)
    if size > max_size_bytes:
        raise HTTPException(status_code=400, detail=f"File exceeds {config['upload']['max_size_mb']}MB limit")

    # 保存
    file.file.seek(0)
    with open(dest_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    now = datetime.now(timezone.utc).isoformat()

    cur.execute(
        """
        INSERT INTO attachments (note_id, filename_original, filename_stored, uploaded_at)
        VALUES (?, ?, ?, ?)
        """,
        (note_id, file.filename, safe_name, now),
    )
    attachment_id = cur.lastrowid

    conn.commit()
    conn.close()

    return {
        "id": attachment_id,
        "filename": file.filename,
        "url": f"/files/{safe_name}",
    }


@router.delete("/attachments/{attachment_id}")
def delete_attachment(
    attachment_id: int,
    token: str = Depends(oauth2_scheme),
):

    conn = get_connection()
    cur = conn.cursor()

    current_user = get_current_user(token)
    user_id = current_user["id"]

    cur.execute("""
        SELECT a.filename_stored
        FROM attachments a
        JOIN notes n ON a.note_id = n.id
        WHERE a.id = ? AND n.user_id = ?
    """, (attachment_id, user_id))

    row = cur.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Attachment not found")

    filename_stored = row[0]
    upload_dir = config["upload"]["dir"]
    file_path = os.path.join(upload_dir, filename_stored)

    # DB削除
    cur.execute("DELETE FROM attachments WHERE id=?", (attachment_id,))
    conn.commit()
    conn.close()

    # ファイル削除（存在チェック付き）
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
    except Exception as e:
        # ログだけ出してHTTPエラーにはしない（DBとの整合性優先）
        logging.getLogger("attachments").warning(f"Failed to delete file {file_path}: {e}")

    return {"detail": "Attachment deleted successfully"}
