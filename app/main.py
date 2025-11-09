from fastapi import FastAPI, HTTPException, Request, Depends, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse
from .database import init_db, get_connection
from .models import NoteCreate, NoteUpdate, NoteOut
from .auth import hash_password, router as auth_router, oauth2_scheme
from .config import load_config
from pathlib import Path
from datetime import datetime
from typing import Optional
import os, logging, shutil, uuid
import unicodedata
import io, zipfile

BASE_PATH = os.getenv("BASE_PATH", "/").rstrip("/") + "/"

# ------------------------------------------------------------
# Middleware
# ------------------------------------------------------------
class RootPathFromXForwardedPrefix:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        headers = dict(scope.get("headers") or [])
        prefix = None
        for k, v in headers.items():                # ヘッダーは小文字・バイト列なので注意
            if k == b"x-forwarded-prefix":
                prefix = v.decode()
                break
        if prefix:
            scope["root_path"] = prefix             # FastAPI がこれを見てルートを補正する
        await self.app(scope, receive, send)

# ------------------------------------------------------------
# FastAPI
# ------------------------------------------------------------
app = FastAPI(title="SimplyNote API")

app.add_middleware(RootPathFromXForwardedPrefix)
app.include_router(auth_router, prefix="/auth", tags=["auth"])

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # ← 最初はこれでOK（あとで制限可）
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------------------------------------------------------
# 設定・ログ
# ------------------------------------------------------------
config = load_config()
logging.basicConfig(level=config["logging"]["level"])
logger = logging.getLogger("simplynote")


# ------------------------------------------------------------
# App.Middleware
# ------------------------------------------------------------
@app.middleware("http")
async def debug_request(request: Request, call_next):
#    logger.info(f"=== URL DEBUG INFO ===")
#    logger.info(f"=== method     {request.method}")
#    logger.info(f"=== url.path   {request.url.path}")
#    logger.info(f"=== url.query  {request.url.query}")
#    logger.info(f"=== base_url   {request.base_url}")
#    logger.info(f"=== x-forwarded-prefix {request.headers.get('x-forwarded-prefix')}")
#    logger.info(f"=== scope.root_path {request.scope.get('root_path')}")
#    logger.info(f"=== scope.path {request.scope.get('path')}")
#    logger.info(f"=== BASE_PATH  {BASE_PATH}")
    response = await call_next(request)
    return response

# ------------------------------------------------------------
# Startup
# ------------------------------------------------------------
@app.on_event("startup")
def startup():
    init_db()
    conn = get_connection()
    cur = conn.cursor()

    admin_user = os.getenv("ADMIN_USER", "admin").strip()
    admin_pass = os.getenv("ADMIN_PASS", "password").strip()[:72]

    if admin_user and admin_pass:
        cur.execute("SELECT id FROM users WHERE username=?", (admin_user,))
        if not cur.fetchone():
            cur.execute(
                "INSERT INTO users (username, password, created_at) VALUES (?, ?, ?)",
                (admin_user, hash_password(admin_pass), datetime.utcnow().isoformat()),
            )
            conn.commit()
            logger.info(f"✅ Created default admin user: {admin_user}")

    conn.close()

    upload_dir = os.path.abspath(config["upload"]["dir"])
    os.makedirs(upload_dir, exist_ok=True)
    logger.info(f"📂 File storage initialized: {upload_dir}")

    app.mount("/files", StaticFiles(directory=upload_dir), name="files")

    for route in app.routes:
        if hasattr(route, "app") and isinstance(route.app, StaticFiles):
            logger.info("=== StaticFiles mount  name: {route.name}, path: {route.path}, directory: {route.app.directory}")

# ------------------------------------------------------------
# Notes CRUD
# ------------------------------------------------------------

@app.get("/notes", response_model=list[NoteOut])
def get_notes(request: Request, tag: Optional[str] = None, token: str = Depends(oauth2_scheme)):
    conn = get_connection()
    cur = conn.cursor()

    if tag:
        # 特定タグが指定された場合：そのタグを持つノートだけ
        cur.execute("""
            SELECT n.*,
                   GROUP_CONCAT(t2.name, ',') AS tags
            FROM notes n
            JOIN note_tags nt1 ON n.id = nt1.note_id
            JOIN tags t1 ON nt1.tag_id = t1.id
            LEFT JOIN note_tags nt2 ON n.id = nt2.note_id
            LEFT JOIN tags t2 ON nt2.tag_id = t2.id
            WHERE t1.name = ?
            GROUP BY n.id
            ORDER BY n.updated_at DESC
        """, (tag,))
    else:
        # 全ノート
        cur.execute("""
            SELECT n.*,
                   GROUP_CONCAT(t.name, ',') AS tags
            FROM notes n
            LEFT JOIN note_tags nt ON n.id = nt.note_id
            LEFT JOIN tags t ON nt.tag_id = t.id
            GROUP BY n.id
            ORDER BY n.updated_at DESC
        """)

    notes = []
    for row in cur.fetchall():
        d = dict(row)
        d["tags"] = d["tags"].split(",") if d["tags"] else []

        # 添付ファイルを取得して追加
        cur2 = conn.cursor()
        cur2.execute(
            "SELECT id, filename_original, filename_stored FROM attachments WHERE note_id=?",
            (d["id"],),
        )
        files = [
            {
                "id": fid,
                "filename": fname,
                "url": f"{request.base_url}{BASE_PATH}files/{stored}",
            }
            for fid, fname, stored in cur2.fetchall()
        ]
        cur2.close()
        d["files"] = files

        notes.append(d)

    conn.close()
    return notes


@app.get("/notes/{note_id}", response_model=NoteOut)
def get_note(note_id: int, request: Request, token: str = Depends(oauth2_scheme)):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT n.*, GROUP_CONCAT(t.name, ',') AS tags
        FROM notes n
        LEFT JOIN note_tags nt ON n.id = nt.note_id
        LEFT JOIN tags t ON nt.tag_id = t.id
        WHERE n.id = ?
        GROUP BY n.id
    """, (note_id,))
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Note not found")

    d = dict(row)
    d["tags"] = d["tags"].split(",") if d["tags"] else []

    # 添付ファイルを取得して追加
    cur.execute(
        "SELECT id, filename_original, filename_stored FROM attachments WHERE note_id=?",
        (note_id,),
    )
    files = [
        {
            "id": fid,
            "filename": fname,
            "url": f"{request.base_url}{BASE_PATH}files/{stored}"
        }
        for fid, fname, stored in cur.fetchall()
    ]
    d["files"] = files

    conn.close()
    return d

# -----------------------------------------------------------------------

@app.post("/notes", response_model=NoteOut)
def create_note(note: NoteCreate, token: str = Depends(oauth2_scheme)):

    now = datetime.utcnow().isoformat()
    conn = get_connection()
    cur = conn.cursor()

    if config["user_mode"] == "single":
        user_id = 1
    else:
        user_id = current_user.id

    # ノート本体
    cur.execute(
        "INSERT INTO notes (user_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        (user_id, note.title, note.content, now, now),
    )
    note_id = cur.lastrowid

#    # タグがあれば登録
#    # タグは add_tag() でつける
#    if hasattr(note, "tags") and note.tags:
#        for tag_name in note.tags:
#            cur.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (tag_name,))
#            cur.execute("SELECT id FROM tags WHERE name=?", (tag_name,))
#            tag_id = cur.fetchone()["id"]
#            cur.execute("INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)", (note_id, tag_id))

    conn.commit()
    conn.close()

    return {
        "id": note_id,
        "title": note.title,
        "content": note.content,
#        "tags": note.tags if hasattr(note, "tags") else [],
        "tags": [],
        "files": [],
        "created_at": now,
        "updated_at": now,
    }


@app.put("/notes/{note_id}", response_model=NoteOut)
def update_note(note_id: int, note: NoteUpdate, request: Request, token: str = Depends(oauth2_scheme)):

    now = datetime.utcnow().isoformat()
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("SELECT id FROM notes WHERE id=?", (note_id,))
    if not cur.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Note not found")

    if config["user_mode"] == "single":
        user_id = 1
    else:
        user_id = current_user.id

    cur.execute(
        "UPDATE notes SET title=?, content=?, updated_at=? WHERE id=? AND user_id=?",
        (note.title, note.content, now, note_id, user_id),
    )

#    # タグの更新
#    # タグは add_tag() でつける
#    cur.execute("DELETE FROM note_tags WHERE note_id=?", (note_id,))
#    if hasattr(note, "tags") and note.tags:
#        for tag_name in note.tags:
#            cur.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (tag_name,))
#            cur.execute("SELECT id FROM tags WHERE name=?", (tag_name,))
#            tag_id = cur.fetchone()["id"]
#            cur.execute("INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)", (note_id, tag_id))

    # 添付ファイル情報を取得
    cur.execute("SELECT id, filename_original, filename_stored FROM attachments WHERE note_id=?", (note_id,))
    files = [
        {"id": fid, "filename": fname, "url": f"{request.base_url}{BASE_PATH}files/{stored}"}
        for fid, fname, stored in cur.fetchall()
    ]

    # タグ情報を取得
    cur.execute("SELECT t.name FROM tags t JOIN note_tags nt ON t.id = nt.tag_id WHERE nt.note_id = ?", (note_id,))
    tags = [row[0] for row in cur.fetchall()]

    conn.commit()
    conn.close()

    logging.getLogger("tags").info(f"###### {tags}")

    return {
        "id": note_id,
        "title": note.title,
        "content": note.content,
#        "tags": note.tags if hasattr(note, "tags") else [],
        "tags": tags,
        "files": files,
        "updated_at": now,
    }

@app.delete("/notes/{note_id}")
def delete_note(note_id: int, token: str = Depends(oauth2_scheme)):

    conn = get_connection()
    cur = conn.cursor()

    # 添付ファイルパスを取得
    cur.execute("SELECT filename_stored FROM attachments WHERE note_id=?", (note_id,))
    files = [row[0] for row in cur.fetchall()]

    # 添付ファイルのDBレコードを削除
    cur.execute("DELETE FROM attachments WHERE note_id=?", (note_id,))

    # ノート本体を削除
    cur.execute("DELETE FROM notes WHERE id=?", (note_id,))
    deleted = cur.rowcount

    # 不要タグを削除
    cleanup_unused_tags(cur)

    conn.commit()
    conn.close()

    store_dir = config["upload"]["dir"]

    # 実ファイル削除（DBクローズ後にやる）
    for filename in files:
        try:
            path = os.path.join(config["upload"]["dir"], filename)
            if os.path.exists(path):
                os.remove(path)
        except Exception as e:
            print(f"⚠️ Failed to remove file {path}: {e}")

    if deleted == 0:
        raise HTTPException(status_code=404, detail="Note not found")

    return {"detail": "Note and attachments deleted"}

# -----------------------------------------------------------------------

@app.post("/notes/{note_id}/attachments")
def upload_attachment( note_id: int, request: Request, file: UploadFile = File(...), token: str = Depends(oauth2_scheme),):

    conn = get_connection()
    cur = conn.cursor()

    cur.execute("SELECT id FROM notes WHERE id=?", (note_id,))
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

    # サイズ制限（簡易チェック）
    file.file.seek(0, os.SEEK_END)
    size = file.file.tell()
    file.file.seek(0)
    if size > max_size_bytes:
        raise HTTPException(status_code=400, detail=f"File exceeds {config['upload']['max_size_mb']}MB limit")

    # 保存
    file.file.seek(0)
    with open(dest_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # DB登録
    cur.execute(
        """
        INSERT INTO attachments (note_id, filename_original, filename_stored, uploaded_at)
        VALUES (?, ?, ?, ?)
        RETURNING id
        """,
        (note_id, file.filename, safe_name, datetime.utcnow().isoformat()),
    )
    attachment_id = cur.fetchone()[0]

    conn.commit()
    conn.close()

    return {
        "id": attachment_id,
        "filename": file.filename,
        "url": f"{request.base_url}{BASE_PATH}files/{safe_name}",
    }

@app.delete("/attachments/{attachment_id}")
def delete_attachment( attachment_id: int, token: str = Depends(oauth2_scheme),):

    conn = get_connection()
    cur = conn.cursor()

    # 添付ファイル情報の取得
    cur.execute("SELECT filename_stored FROM attachments WHERE id=?", (attachment_id,))
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
        logging.getLogger("attachments!!").warning(f"Failed to delete file {file_path}: {e}")

    return {"detail": "Attachment deleted successfully"}

# -----------------------------------------------------------------------

@app.post("/notes/{note_id}/tags")
def add_tag(note_id: int, tag: dict, token: str = Depends(oauth2_scheme)):

    conn = get_connection()
    cur = conn.cursor()

    # ノートの存在チェック
    cur.execute("SELECT id FROM notes WHERE id=?", (note_id,))
    if not cur.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Note not found")

#    tag_name = tag.get("name")
    tag_name = normalize_tag_name( tag.get("name") )
    if not tag_name:
        conn.close()
        raise HTTPException(status_code=400, detail="Tag name required")


    # タグがなければ作成
    cur.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (tag_name,))
    cur.execute("SELECT id FROM tags WHERE name=?", (tag_name,))
    tag_id = cur.fetchone()[0]

    # note_tags に関連付け（重複は無視）
    cur.execute("INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)", (note_id, tag_id))

    conn.commit()

    # 不要タグを削除
    cleanup_unused_tags(cur)

    # 現在のタグ一覧を返す
    cur.execute("""
        SELECT t.name FROM tags t
        JOIN note_tags nt ON t.id = nt.tag_id
        WHERE nt.note_id=?
    """, (note_id,))
    tags = [row[0] for row in cur.fetchall()]

    conn.close()

    return {"note_id": note_id, "tags": tags}


@app.delete("/notes/{note_id}/tags/{tag_name}")
def remove_tag(note_id: int, tag_name: str, token: str = Depends(oauth2_scheme)):

    conn = get_connection()
    cur = conn.cursor()

    cur.execute("SELECT id FROM tags WHERE name=?", (tag_name,))
    tag_row = cur.fetchone()
    if not tag_row:
        conn.close()
        raise HTTPException(status_code=404, detail="Tag not found")
    tag_id = tag_row[0]

    # note_tags から削除
    cur.execute("DELETE FROM note_tags WHERE note_id=? AND tag_id=?", (note_id, tag_id))
    conn.commit()

    # 不要タグを削除
    cleanup_unused_tags(cur)

    # 現在のタグ一覧を返す
    cur.execute("""
        SELECT t.name FROM tags t
        JOIN note_tags nt ON t.id = nt.tag_id
        WHERE nt.note_id=?
    """, (note_id,))
    tags = [row[0] for row in cur.fetchall()]

    conn.close()

    return {"note_id": note_id, "tags": tags}

@app.get("/tags")
def get_all_tags(token: str = Depends(oauth2_scheme)):
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("""
        SELECT t.name, COUNT(nt.note_id) AS note_count
        FROM tags t
        LEFT JOIN note_tags nt ON t.id = nt.tag_id
        GROUP BY t.id
        ORDER BY t.name COLLATE NOCASE
    """)
    tags = [{"name": row[0], "note_count": row[1]} for row in cur.fetchall()]

    conn.close()
    return tags

def normalize_tag_name(name: str) -> str:

    if not name:
        return ""

    # Unicode正規化で半角 >> 全角、全角英数 >> 半角を統一
    normalized = unicodedata.normalize("NFKC", name)
    # 前後の空白を除去し、英字は大文字化
    return normalized.strip().upper()

def cleanup_unused_tags(cur):

    # 削除済みノートに紐づいた note_tags を削除
    cur.execute("""
        DELETE FROM note_tags
        WHERE note_id NOT IN (SELECT id FROM notes)
    """)
    deleted_note_tags = cur.rowcount
    if deleted_note_tags > 0:
        logging.getLogger("tags").info(f"🧹 Deleted {deleted_note_tags} orphaned note_tags")

    # どの note_tags にも使われていないタグを削除
    cur.execute("""
        DELETE FROM tags
        WHERE id NOT IN (SELECT DISTINCT tag_id FROM note_tags)
    """)
    deleted_tags = cur.rowcount
    if deleted_tags > 0:
        logging.getLogger("tags").info(f"🧽 Deleted {deleted_tags} unused tags")


# -----------------------------------------------------------------------

@app.get("/search")
def search_notes(q: str, token: str = Depends(oauth2_scheme)):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT n.*, GROUP_CONCAT(t.name, ',') AS tags
        FROM notes n
        JOIN notes_fts f ON n.id = f.rowid
        LEFT JOIN note_tags nt ON n.id = nt.note_id
        LEFT JOIN tags t ON nt.tag_id = t.id
        WHERE notes_fts MATCH ?
        GROUP BY n.id
        ORDER BY rank
    """, (q,))
    rows = cur.fetchall()
    conn.close()

    results = []
    for row in rows:
        d = dict(row)
        d["tags"] = d["tags"].split(",") if d["tags"] else []
        results.append(d)

    return {"results": results}


# -----------------------------------------------------------------------

@app.post("/import")
async def import_notes(file: UploadFile = File(...), token: str = Depends(oauth2_scheme)):

    if not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Only ZIP files are supported.")

    content = await file.read()
    imported = 0
    skipped = 0

    conn = get_connection()
    cur = conn.cursor()

    if config["user_mode"] == "single":
        user_id = 1
    else:
        current_user = get_current_user(token)
        user_id = current_user.id

    with zipfile.ZipFile(io.BytesIO(content)) as zf:

        for info in zf.infolist():
            if not (info.filename.endswith(".txt") or info.filename.endswith(".md")):
                skipped += 1
                continue

            try:
                text = zf.read(info.filename).decode("utf-8")
            except UnicodeDecodeError:
                skipped += 1
                continue

            name = info.filename.rsplit("/", 1)[-1]
            title = name.rsplit(".", 1)[0]

            # 重複スキップ
            cur.execute(
                "SELECT id FROM notes WHERE user_id=? AND title=?",
                (user_id, title),
            )
            if cur.fetchone():
                skipped += 1
                continue

            # ZipInfo.date_time は (YYYY, MM, DD, HH, MM, SS)
            dt = datetime(*info.date_time).isoformat()

            cur.execute(
                "INSERT INTO notes (user_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (user_id, title, text, dt, dt),
            )
            imported += 1

    conn.commit()
    conn.close()

    return {
        "imported": imported,
        "skipped": skipped,
        "message": f"{imported} notes imported successfully, {skipped} skipped.",
    }


@app.get("/export")
def export_notes(token: str = Depends(oauth2_scheme)):

    conn = get_connection()
    cur = conn.cursor()

    # ユーザー特定
    if config["user_mode"] == "single":
        user_id = 1
    else:
        current_user = get_current_user(token)
        user_id = current_user.id

    # ノート一覧取得
    cur.execute("SELECT title, content FROM notes WHERE user_id=?", (user_id,))
    rows = cur.fetchall()
    conn.close()

    # ZIP作成
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for row in rows:
            title = row["title"].strip() or "untitled"
            title = title.replace("/", "_")  # ディレクトリ区切りの防止
            text = row["content"] or ""
            zf.writestr(f"{title}.txt", text)

    buffer.seek(0)

    today = datetime.now().strftime("%Y%m%d")
    headers = {
        "Content-Disposition": f'attachment; filename="simplynote_export_{today}.zip"'
    }

    return StreamingResponse(buffer, media_type="application/zip", headers=headers)



