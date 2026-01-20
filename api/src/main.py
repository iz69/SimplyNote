from fastapi import FastAPI, Response, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .database import init_db, get_connection
from .auth import init_users, get_current_user, oauth2_scheme, router as auth_router
from .config import load_config

from .routers import notes, attachments, tags, import_export
from .routers.notes import delete_notes_and_attachments
from .services.maintenance import run_maintenance

import os
import logging

# ------------------------------------------------------------
# 設定
# ------------------------------------------------------------

#swagger_enabled = True
swagger_enabled = False

config = load_config()

logging.basicConfig(
    level=config["logging"]["level"],
    format=":: %(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("simplynote")

# ------------------------------------------------------------
# FastAPI
# ------------------------------------------------------------

base_path = os.getenv("BASE_PATH", "/").rstrip("/")

app = FastAPI(
    title="SimplyNote API",
    docs_url=None if not swagger_enabled else "/docs",
    redoc_url=None if not swagger_enabled else "/redoc",
    swagger_ui_parameters={
        "url": f"{base_path}/openapi.json",
    },
    servers=[
        {"url": base_path},
    ],
)

# ------------------------------------------------------------
# Middleware
# ------------------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # ← 本番では制限推奨
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------------------------------------------------------
# Routers
# ------------------------------------------------------------

app.include_router(auth_router, prefix="/auth", tags=["auth"])
app.include_router(notes.router)
app.include_router(attachments.router)
app.include_router(tags.router)
app.include_router(import_export.router)

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
# Health Check
# ------------------------------------------------------------

@app.head("/ping")
async def ping_head():
    return Response(status_code=200)

# ------------------------------------------------------------
# Trash
# ------------------------------------------------------------

@app.delete("/trash", tags=["trash"])
def empty_trash(
    token: str = Depends(oauth2_scheme),
    background: BackgroundTasks = None
):
    """ゴミ箱を空にする"""
    conn = get_connection()
    cur = conn.cursor()

    current_user = get_current_user(token)
    user_id = current_user["id"]

    # trash タグに紐づく note_id を列挙（ユーザー制約付き）
    cur.execute("""
        SELECT DISTINCT n.id
        FROM notes n
        JOIN note_tags nt ON nt.note_id = n.id
        JOIN tags t ON t.id = nt.tag_id
        WHERE n.user_id = ? AND upper(t.name) = upper(?)
    """, (user_id, "trash"))
    note_ids = [row[0] for row in cur.fetchall()]

    deleted, files = delete_notes_and_attachments(conn, cur, user_id, note_ids)
    conn.close()

    if background is not None:
        background.add_task(run_maintenance, user_id)

    # 実ファイル削除
    for filename in files:
        path = os.path.join(config["upload"]["dir"], filename)
        try:
            if os.path.exists(path):
                os.remove(path)
        except Exception as e:
            print(f"⚠️ Failed to remove file {path}: {e}")

    return {"detail": "Trash emptied", "deleted": deleted}
