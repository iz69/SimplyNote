import unicodedata
import re


def normalize_newlines(text: str) -> str:
    """改行コードの正規化"""
    return text.replace("\r\n", "\n").replace("\r", "\n")


def normalize_tag_name(name: str) -> str:
    """
    タグの正規化
    Unicode正規化で半角 >> 全角、全角英数 >> 半角を統一
    前後の空白を除去し、英字は大文字化
    """
    if not name:
        return ""

    normalized = unicodedata.normalize("NFKC", name)
    return normalized.strip().upper()


TRASH_TAG_NAME = "TRASH"


def parse_important_flag(value) -> int:
    """Parse import metadata into the integer flag stored in the DB."""
    if isinstance(value, bool):
        return 1 if value else 0

    if isinstance(value, int):
        return 1 if value else 0

    normalized = str(value or "").strip().lower()
    return 1 if normalized in {"1", "true", "yes", "on"} else 0


def sanitize_filename(name: str, maxlen: int = 100) -> str:
    """
    圧縮ファイル名の正規化
    """
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
