from fastapi import FastAPI, HTTPException, Request, Depends, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse

from .database import init_db, get_connection
from .models import NoteCreate, NoteUpdate, NoteOut
from .auth import get_current_user, init_users, oauth2_scheme, router as auth_router
from .config import load_config

from pathlib import Path
from datetime import datetime
from typing import Optional
import os, logging, shutil, uuid
import unicodedata
import io, zipfile, re

# ------------------------------------------------------------
# FastAPI
# ------------------------------------------------------------

# 環境変数から BASE_PATH を取得
base_path = os.getenv("BASE_PATH", "/").rstrip("/") + "/"

# 環境変数で Swagger の有効・無効を制御
swagger_enabled = os.getenv("SWAGGER_API_DOCS", "true").lower() not in ["false", "0", "no"]

app = FastAPI(
    title="SimplyNote API",
    docs_url=None if not swagger_enabled else "/docs",
    redoc_url=None if not swagger_enabled else "/redoc",
    swagger_ui_parameters={
        "url": f"{base_path}/openapi.json",
    },
    servers=[
        {"url": base_path.rstrip("/")},
    ],
)

app.include_router( auth_router, prefix="/auth", tags=["auth"] )

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
# App.Middleware (for debug)
# ------------------------------------------------------------
#@app.middleware("http")
#async def debug_request(request: Request, call_next):
#    logger.info(f"=== URL DEBUG INFO ===")
#    logger.info(f"=== method     {request.method}")
#    logger.info(f"=== url.path   {request.url.path}")
#    logger.info(f"=== url.query  {request.url.query}")
#    logger.info(f"=== base_url   {request.base_url}")
#    logger.info(f"=== x-forwarded-prefix {request.headers.get('x-forwarded-prefix')}")
#    logger.info(f"=== scope.root_path {request.scope.get('root_path')}")
#    logger.info(f"=== scope.path {request.scope.get('path')}")
#    logger.info(f"=== BASE_PATH  {BASE_PATH}")
#    response = await call_next(request)
#    return response

# ------------------------------------------------------------
# Startup
# ------------------------------------------------------------
@app.on_event("startup")
def startup():

    init_db(config)

    # DBユーザ
    users = config.get("users", [])
    admin_user = os.getenv("ADMIN_USER", "admin").strip()
    admin_pass = os.getenv("ADMIN_PASS", "password").strip()[:72]
    if admin_user and admin_pass:
        users.append({
            "username": admin_user,
            "password": admin_pass,
            "role": "admin"
        })
    init_users(users)

    # 添付ファイルの保存ディレクトリ
    upload_dir = os.path.abspath(config["upload"]["dir"])
    os.makedirs(upload_dir, exist_ok=True)
    logger.info(f"📂 File storage initialized: {upload_dir}")

    app.mount("/files", StaticFiles(directory=upload_dir), name="files")

    for route in app.routes:
        if hasattr(route, "app") and isinstance(route.app, StaticFiles):
            logger.info(f"=== StaticFiles mount  name: {route.name}, path: {route.path}, directory: {route.app.directory}")

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
                "url": f"/files/{stored}",
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
            "url": f"/files/{stored}",
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

    current_user = get_current_user(token)
    user_id = current_user["id"]

    # ノート本体
    cur.execute(
        "INSERT INTO notes (user_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        (user_id, note.title, note.content, now, now),
    )
    note_id = cur.lastrowid

    conn.commit()
    conn.close()

    # 添付ファイルとタグは別でAPIで
    return {
        "id": note_id,
        "title": note.title,
        "content": note.content,
        "tags": [],
        "files": [],
        "created_at": now,
        "updated_at": now,
    }

@app.put("/notes/{note_id}", response_model=NoteOut)
def update_note(
    note_id: int,
    note: NoteUpdate,
    request: Request,
    token: str = Depends(oauth2_scheme),
):

    now = datetime.utcnow().isoformat()
    conn = get_connection()
    cur = conn.cursor()

    current_user = get_current_user(token)
    user_id = current_user["id"]

    cur.execute("SELECT id FROM notes WHERE id=?", (note_id,))
    if not cur.fetchone():
        conn.close()
        logger.warning(f"[update_note] note {note_id} not found for user {user_id}")
        raise HTTPException(status_code=404, detail="Note not found")

    cur.execute(
        "UPDATE notes SET title=?, content=?, updated_at=? WHERE id=? AND user_id=?",
        (note.title, note.content, now, note_id, user_id),
    )

    # 添付ファイル情報を取得
    cur.execute("SELECT id, filename_original, filename_stored FROM attachments WHERE note_id=?", (note_id,))
    files = [
        {"id": fid, "filename": fname, "url": f"/files/{stored}"}
        for fid, fname, stored in cur.fetchall()
    ]

    # タグ情報を取得
    cur.execute("SELECT t.name FROM tags t JOIN note_tags nt ON t.id = nt.tag_id WHERE nt.note_id = ?", (note_id,))
    tags = [row[0] for row in cur.fetchall()]

    conn.commit()
    conn.close()

    # 添付ファイルとタグは別でAPIで
    return {
        "id": note_id,
        "title": note.title,
        "content": note.content,
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

    # 不要タグ・ゴミ箱メンテナンス
    run_maintenance(cur)

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
        "url": f"/files/{safe_name}",
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

    # タグの正規化
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

    # 不要タグ・ゴミ箱メンテナンス
    run_maintenance(cur)

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

    # 不要タグ・ゴミ箱メンテナンス
    run_maintenance(cur)

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

# タグの正規化
# Unicode正規化で半角 >> 全角、全角英数 >> 半角を統一
# 前後の空白を除去し、英字は大文字化
def normalize_tag_name(name: str) -> str:

    if not name:
        return ""

    normalized = unicodedata.normalize("NFKC", name)
    return normalized.strip().upper()

# -----------------------------------------------------------------------
# 未使用
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

    current_user = get_current_user(token)
    user_id = current_user["id"]

    upload_dir = os.path.abspath(config["upload"]["dir"])
    os.makedirs(upload_dir, exist_ok=True)

    with zipfile.ZipFile(io.BytesIO(content)) as zf:

        consumed_attachment_paths = set()

        for info in zf.infolist():

            # --- テキストファイルのみ対象 ---
            if not info.filename.endswith((".txt", ".md")):
                continue

            try:
                text = zf.read(info.filename).decode("utf-8")
            except UnicodeDecodeError:
                logger.info(f"[IMPORT SKIP] {info.filename}")
                skipped += 1
                continue

            # --- ファイル名分離 (例: 123`タイトル.txt or タイトル.txt) ---
            name = info.filename.rsplit("/", 1)[-1]
            base = name.rsplit(".", 1)[0]

            export_note_id = None
            title = base
            if "`" in base:
                note_parts = base.split("`", 1)
                export_note_id = note_parts[0]
                title = note_parts[1]

            # --- ZIP内の更新日時を datetime に変換 ---
            updated_at = datetime(*info.date_time)

            # --- タグ行を本文から分離 ---
            tags = []
            content_text = text
            if "\n---\nTags:" in text:
                body_parts = text.split("\n---\nTags:", 1)
                content_text = body_parts[0].rstrip("\n\r")
                tag_line = body_parts[1].strip()
                tags = [t.strip() for t in tag_line.split(",") if t.strip()]

            # --- タイトル重複チェック ---
            cur.execute("SELECT id FROM notes WHERE user_id=? AND title=?", (user_id, title))
            if cur.fetchone():
                # note_id 付きでない場合は重複を避けるため suffix を付加
                suffix = f" (imported {updated_at.strftime('%Y%m%d%H%M%S')})"
                title += suffix

            # --- ノート登録 ---
            cur.execute(
                """
                INSERT INTO notes (user_id, title, content, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (user_id, title, content_text, updated_at.isoformat(), updated_at.isoformat()),
            )
            note_id = cur.lastrowid

            # --- タグ登録 ---
            for tag_name in tags:
                cur.execute("SELECT id FROM tags WHERE name=?", (tag_name,))
                tag = cur.fetchone()
                if tag:
                    tag_id = tag["id"]
                else:
                    cur.execute("INSERT INTO tags (name) VALUES (?)", (tag_name,))
                    tag_id = cur.lastrowid
                cur.execute("INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)", (note_id, tag_id))


            # 添付ファイル復元
            if export_note_id:
                attach_prefix = f"attachments/{export_note_id}`"

                for fname in zf.namelist():

                    if fname in consumed_attachment_paths:
                        continue

                    if fname.startswith(attach_prefix):
                        # サブディレクトリを除いてファイル名のみ取得
                        att_filename = os.path.basename(fname)
                        data = zf.read(fname)

                        stored_name = f"{uuid.uuid4().hex}_{att_filename}"
                        stored_path = os.path.join(upload_dir, stored_name)
                        with open(stored_path, "wb") as f:
                            f.write(data)

                        uploaded_at = datetime.now().isoformat()
                        cur.execute(
                            """
                            INSERT INTO attachments (note_id, filename_original, filename_stored, uploaded_at)
                            VALUES (?, ?, ?, ?)
                            """,
                            (note_id, att_filename, stored_name, uploaded_at),
                        )
                        consumed_attachment_paths.add(fname)

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

    current_user = get_current_user(token)
    user_id = current_user["id"]

    # ノート一覧取得
    cur.execute("SELECT id, title, content, updated_at FROM notes WHERE user_id=?", (user_id,))
    notes = cur.fetchall()

    upload_dir = os.path.abspath(config["upload"]["dir"])

    # ZIPバッファ
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:

        for note in notes:

            note_id = note["id"]
            raw_title = note["title"] or "untitled"
            safe_title = _sanitize_name(raw_title, maxlen=80)

            # --- タグ取得（← これが無いと tags が未定義になる）---
            cur.execute(
                """
                SELECT t.name
                FROM tags t
                JOIN note_tags nt ON nt.tag_id = t.id
                WHERE nt.note_id = ?
                """,
                (note_id,),
            )
            tags = [row["name"] for row in cur.fetchall()]

            # 本文 + タグ追記
            text = note["content"] or ""
            if tags:
                text += "\n\n---\nTags: " + ", ".join(tags)

            # 本文ファイルは note_id を含めて一意化
            txt_name = f"{note_id}`{safe_title}.txt"

            # --- updated_at をファイル日時に設定 ---
            updated_at = note["updated_at"]

            if updated_at:
                # 例: "2025-11-11T12:34:56" → datetime オブジェクトに変換
                dt = datetime.fromisoformat(updated_at)
                # ZipInfo で日付を指定
                info = zipfile.ZipInfo(txt_name)
                info.date_time = dt.timetuple()[:6]  # (年, 月, 日, 時, 分, 秒)
                zf.writestr(info, text)
            else:
                # updated_at 無い場合は普通に書き込む
                zf.writestr(txt_name, text)

            # --- 添付一覧取得（← これが無いと attachments が未定義になる）---
            cur.execute(
                """
                SELECT filename_original, filename_stored
                FROM attachments
                WHERE note_id = ?
                """,
                (note_id,),
            )
            attachments = cur.fetchall()

            # 添付は note_id ベースの一意ディレクトリへ
            attach_dir = f"attachments/{note_id}`{safe_title}/"

            # 同名回避のため、ZIP内で書いた名前を追跡
            written_names = set()

            for att in attachments:
                stored_path = os.path.join(upload_dir, att["filename_stored"])
                if not os.path.exists(stored_path):
                    continue

                base = _sanitize_name(att["filename_original"], maxlen=100)

                # 拡張子分離
                if "." in base:
                    stem, ext = base.rsplit(".", 1)
                    ext = "." + ext
                else:
                    stem, ext = base, ""

                # 衝突回避（-1, -2 ... 付与）
                candidate = stem + ext
                idx = 1
                while candidate in written_names:
                    candidate = f"{stem}-{idx}{ext}"
                    idx += 1

                written_names.add(candidate)

                arcname = f"{attach_dir}{candidate}"
                with open(stored_path, "rb") as f:
                    data = f.read()
                zf.writestr(arcname, data)

    conn.close()
    buffer.seek(0)

    today = datetime.now().strftime("%Y%m%d")

    headers = {
        "Content-Disposition": f'attachment; filename="simplynote_export_{today}.zip"'
    }

    return StreamingResponse(buffer, media_type="application/zip", headers=headers)


# 圧縮ファイル名の正規化
def _sanitize_name(name: str, maxlen: int = 100) -> str:
    # Unicode 正規化（macOS等での重複回避）
    name = unicodedata.normalize("NFC", name or "")
    # 制御文字や改行も含めて安全化
    name = re.sub(r'[\x00-\x1F\x7F]', '_', name)              # 制御文字
    name = re.sub(r'[\\/:*?"<>|]', '_', name)                 # Windows 禁止
    name = name.strip().strip('.')                            # 末尾ドットも避ける
    if not name:
        name = "untitled"
    if len(name) > maxlen:
        name = name[:maxlen]
    return name


# -----------------------------------------------------------------------

def purge_expired_trashed_notes(cur, config):
    logger = logging.getLogger("maintenance")
    trash_conf = (config or {}).get("trash", {})
    if trash_conf.get("enabled") and trash_conf.get("auto_empty_days", 0) > 0:
        days = int(trash_conf["auto_empty_days"])
        cur.execute("""
            DELETE FROM notes
            WHERE id IN (
                SELECT n.id FROM notes n
                JOIN note_tags nt ON n.id = nt.note_id
                JOIN tags t ON nt.tag_id = t.id
                WHERE t.name = 'Trash'
                  AND n.updated_at < datetime('now', ?)
            )
        """, (f'-{days} days',))
        cnt = cur.rowcount or 0
        if cnt > 0:
            logger.info(f"🗑️ Deleted {cnt} trashed notes older than {days} days")

def remove_orphan_note_tags(cur):
    logger = logging.getLogger("maintenance")
    cur.execute("""
        DELETE FROM note_tags
        WHERE note_id NOT IN (SELECT id FROM notes)
    """)
    cnt = cur.rowcount or 0
    if cnt > 0:
        logger.info(f"🧹 Deleted {cnt} orphaned note_tags")

def remove_unused_tags(cur):
    logger = logging.getLogger("maintenance")
    cur.execute("""
        DELETE FROM tags
        WHERE id NOT IN (SELECT DISTINCT tag_id FROM note_tags)
    """)
    cnt = cur.rowcount or 0
    if cnt > 0:
        logger.info(f"🧽 Deleted {cnt} unused tags")

def run_maintenance(cur, config=None):
    # 順番はこの通りで
    purge_expired_trashed_notes(cur, config)
    remove_orphan_note_tags(cur)
    remove_unused_tags(cur)


