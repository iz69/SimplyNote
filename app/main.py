from fastapi import FastAPI, HTTPException, Request, Depends, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from .database import init_db, get_connection
from .models import NoteCreate, NoteUpdate, NoteOut
from .auth import hash_password, router as auth_router, oauth2_scheme
from .config import load_config
from datetime import datetime
import os, logging, shutil

# ------------------------------------------------------------
# FastAPI
# ------------------------------------------------------------
app = FastAPI(title="SimplyNote API")
app.include_router(auth_router, prefix="/auth", tags=["auth"])

# ------------------------------------------------------------
# 設定・ログ
# ------------------------------------------------------------
config = load_config()
logging.basicConfig(level=config["logging"]["level"])
logger = logging.getLogger("simplynote")

# ------------------------------------------------------------
# Middleware (for DEBUG)
# ------------------------------------------------------------
@app.middleware("http")
async def debug_request(request: Request, call_next):
    logger.info(f"=== Request {request.method} {request.url.path} ===")
    response = await call_next(request)
    return response


@app.middleware("http")
async def set_root_path_from_proxy(request: Request, call_next):
    prefix = request.headers.get("x-forwarded-prefix")
    if prefix:
        request.scope["root_path"] = prefix.rstrip("/")
    return await call_next(request)

# ------------------------------------------------------------
# React Build 配信設定
# ------------------------------------------------------------
BASE_PATH = os.getenv("BASE_PATH", "/")
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "../ui/dist")

if os.path.exists(FRONTEND_DIR):
    mount_path = BASE_PATH.rstrip("/") or "/"
    if mount_path != "/":
        app.mount(mount_path, StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
    else:
        from fastapi.responses import FileResponse

        @app.get("/{full_path:path}")
        async def serve_spa(full_path: str):
            index_path = os.path.join(FRONTEND_DIR, "index.html")
            return FileResponse(index_path)

# ------------------------------------------------------------
# Startup
# ------------------------------------------------------------
@app.on_event("startup")
def startup():
    init_db()
    conn = get_connection()
    cur = conn.cursor()

    admin_user = os.getenv("ADMIN_USER", "").strip()
    admin_pass = os.getenv("ADMIN_PASS", "").strip()[:72]

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
#    os.makedirs("/data/files", exist_ok=True)
    os.makedirs(config["upload"]["dir"], exist_ok=True)
    logger.info("📂 File storage initialized: /data/files")

# ------------------------------------------------------------
# Notes CRUD
# ------------------------------------------------------------
@app.get("/notes", response_model=list[NoteOut])
def get_notes(token: str = Depends(oauth2_scheme)):
    conn = get_connection()
    cur = conn.cursor()
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
        notes.append(d)
    conn.close()
    return notes


@app.get("/notes/{note_id}", response_model=NoteOut)
def get_note(note_id: int,token: str = Depends(oauth2_scheme)):
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
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Note not found")

    d = dict(row)
    d["tags"] = d["tags"].split(",") if d["tags"] else []
    return d


@app.post("/notes", response_model=NoteOut)
def update_note(note_id: int, note: NoteUpdate, token: str = Depends(oauth2_scheme)):
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
        (user_id, note.title, note.content, now, now),  # FIXME: user_id=1 仮
    )
    note_id = cur.lastrowid

    # タグがあれば登録
    if hasattr(note, "tags") and note.tags:
        for tag_name in note.tags:
            cur.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (tag_name,))
            cur.execute("SELECT id FROM tags WHERE name=?", (tag_name,))
            tag_id = cur.fetchone()["id"]
            cur.execute("INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)", (note_id, tag_id))

    conn.commit()
    conn.close()

    return {
        "id": note_id,
        "title": note.title,
        "content": note.content,
        "tags": note.tags if hasattr(note, "tags") else [],
        "created_at": now,
        "updated_at": now,
    }


@app.put("/notes/{note_id}", response_model=NoteOut)
def update_note(note_id: int, note: NoteUpdate,token: str = Depends(oauth2_scheme)):

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

    # タグの更新
    cur.execute("DELETE FROM note_tags WHERE note_id=?", (note_id,))
    if hasattr(note, "tags") and note.tags:
        for tag_name in note.tags:
            cur.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (tag_name,))
            cur.execute("SELECT id FROM tags WHERE name=?", (tag_name,))
            tag_id = cur.fetchone()["id"]
            cur.execute("INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)", (note_id, tag_id))

    conn.commit()
    conn.close()
    return {
        "id": note_id,
        "title": note.title,
        "content": note.content,
        "tags": note.tags if hasattr(note, "tags") else [],
        "updated_at": now,
    }


@app.delete("/notes/{note_id}")
def delete_note(note_id: int, token: str = Depends(oauth2_scheme)):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM notes WHERE id=?", (note_id,))
    conn.commit()
    deleted = cur.rowcount
    conn.close()
    if deleted == 0:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"detail": "Note deleted"}


@app.post("/notes/{note_id}/attachments")
def upload_attachment(note_id: int, file: UploadFile = File(...), token: str = Depends(oauth2_scheme)):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT id FROM notes WHERE id=?", (note_id,))
    if not cur.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Note not found")

    # 設定ファイルからアップロード先と制限値を取得
    upload_dir = config["upload"]["dir"]
    max_size_bytes = config["upload"]["max_size_mb"] * 1024 * 1024
    os.makedirs(upload_dir, exist_ok=True)

    # 一時的にファイルサイズを確認（readして戻す）
    file.file.seek(0, os.SEEK_END)
    size = file.file.tell()
    file.file.seek(0)
    if size > max_size_bytes:
        raise HTTPException(status_code=400, detail=f"File exceeds {config['upload']['max_size_mb']}MB limit")

    dest_path = os.path.join(upload_dir, file.filename)

    with open(dest_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    cur.execute(
        "INSERT INTO attachments (note_id, filename, filepath, uploaded_at) VALUES (?, ?, ?, ?)",
        (note_id, file.filename, dest_path, datetime.utcnow().isoformat()),
    )
    conn.commit()
    conn.close()

    return {"detail": "File uploaded", "filename": file.filename}

#### 未実装
#### @app.get("/notes/{note_id}/attachments)
