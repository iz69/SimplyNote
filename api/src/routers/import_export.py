from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from fastapi.responses import StreamingResponse
from datetime import datetime, timezone
import os
import io
import zipfile
import uuid
import logging

from ..database import get_connection
from ..auth import get_current_user, oauth2_scheme
from ..config import load_config
from ..utils import normalize_newlines, sanitize_filename

router = APIRouter(tags=["import_export"])
config = load_config()
logger = logging.getLogger("simplynote")


@router.post("/import")
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

            # .txt, .md
            if not info.filename.endswith((".txt", ".md")):
                continue

            try:
                text = zf.read(info.filename).decode("utf-8")
            except UnicodeDecodeError:
                logger.info(f"[IMPORT SKIP] {info.filename}")
                skipped += 1
                continue

            # ファイル名分離 (例: 123`タイトル.txt or タイトル.txt)
            name = info.filename.rsplit("/", 1)[-1]
            base = name.rsplit(".", 1)[0]

            export_note_id = None
            title = base
            if "`" in base:
                note_parts = base.split("`", 1)
                export_note_id = note_parts[0]
                title = note_parts[1]

            # ZIP内の更新日時を datetime に変換
            # zip内のファイルのタイムゾーンが不明なのでサーバのタイムゾーンと合わせる
            local_tz = datetime.now().astimezone().tzinfo
            local = datetime(*info.date_time, tzinfo=local_tz)
            utc = local.astimezone(timezone.utc)
            updated_at = utc

            # タグ・重要フラグなどのメタデータを本文から分離
            tags = []
            is_important = 0
            content_text = text

            if "\n---\n" in text:
                body, meta_raw = text.split("\n---\n", 1)
                content_text = body.rstrip("\n\r")

                for line in meta_raw.splitlines():
                    line = line.strip()
                    if line.startswith("Tags:"):
                        tag_line = line.replace("Tags:", "", 1).strip()
                        tags = [t.strip() for t in tag_line.split(",") if t.strip()]
                    if line.startswith("Important:"):
                        val = line.replace("Important:", "", 1).strip().lower()
                        is_important = val

            # タイトル重複チェック
            cur.execute("SELECT id FROM notes WHERE user_id=? AND title=?", (user_id, title))
            if cur.fetchone():
                # note_id 付きでない場合は重複を避けるため suffix を付加
                suffix = f" (imported {updated_at.strftime('%Y%m%d%H%M%S')})"
                title += suffix

            # 改行コードの正規化
            normalized_content = normalize_newlines(content_text)

            # ノート登録
            cur.execute(
                """
                INSERT INTO notes (user_id, title, content, is_important, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (user_id, title, normalized_content, is_important, updated_at.isoformat(), updated_at.isoformat()),
            )
            note_id = cur.lastrowid

            # タグ登録
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

                        uploaded_at = datetime.now(timezone.utc).isoformat()

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


@router.get("/export")
def export_notes(token: str = Depends(oauth2_scheme)):

    conn = get_connection()
    cur = conn.cursor()

    current_user = get_current_user(token)
    user_id = current_user["id"]

    # ノート一覧取得
    cur.execute("SELECT id, title, content, is_important, updated_at FROM notes WHERE user_id=?", (user_id,))
    notes = cur.fetchall()

    upload_dir = os.path.abspath(config["upload"]["dir"])

    # ZIPバッファ
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:

        for note in notes:

            note_id = note["id"]
            raw_title = note["title"] or "untitled"
            safe_title = sanitize_filename(raw_title, maxlen=80)

            # タグ取得
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
            lines = [text]

            meta = []

            if tags:
                meta.append("Tags: " + ", ".join(tags))

            if note["is_important"]:
                meta.append("Important: true")

            if meta:
                lines.append("\n---")
                lines.append("\n".join(meta))

            text = "\n".join(lines)

            # 本文ファイルは note_id を含めて一意化
            txt_name = f"{note_id}`{safe_title}.txt"

            # updated_at をファイル日時に設定
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

            # 添付一覧取得
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

                base = sanitize_filename(att["filename_original"], maxlen=100)

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
