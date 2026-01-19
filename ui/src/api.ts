// api.ts
import { apiUrl } from './utils'

export interface Note {
  id: number;
  title: string;
  content: string;
  is_important?: number
  tags?: string[]
  files?: Attachment[]
  updated_at?: string;
  created_at?: string;
}

const authHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

// -------------------------

export async function refreshAccessToken() {
  const refreshToken = localStorage.getItem("refresh_token");
  if (!refreshToken) throw new Error("no_refresh_token");

  const res = await fetch( apiUrl(`/auth/refresh`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!res.ok) throw new Error("refresh_failed");
  const { access_token } = await res.json();
  localStorage.setItem("token", access_token);
  return access_token;
}

// -------------------------

export async function getNotes(token: string): Promise<Note[]> {
  const res = await fetch(apiUrl(`/notes`), { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error("fetch_error");
  return res.json();
}

export async function createNote(
  token: string,
  payload: { title: string; content: string }
): Promise<Note> {
  const res = await fetch(apiUrl(`/notes`), {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error("create_error");
  return res.json();
}

export async function updateNote(
  token: string,
  id: number,
  payload: { title?: string; content?: string }
): Promise<Note> {
  const res = await fetch(apiUrl(`/notes/${id}`), {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error("update_error");
  return res.json();
}

export async function deleteNote(token: string, id: number): Promise<void> {
  const res = await fetch(apiUrl(`/notes/${id}`), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error("delete_error");
}


// -------------------------

export interface Attachment {
  id: number;
  filename: string;
  url: string;
}

export async function uploadAttachment(
  token: string,
  noteId: number,
  file: File
): Promise<Attachment> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(apiUrl(`/notes/${noteId}/attachments`), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error("upload_error");
  return res.json();
}

export async function deleteAttachment(
  token: string,
  attachmentId: number
): Promise<void> {
  const res = await fetch(apiUrl(`/attachments/${attachmentId}`), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error("delete_error");
}

// -------------------------

// ノートにタグを追加
export async function addTag(
  token: string,
  noteId: number,
  tagName: string
): Promise<string[]> {
  const res = await fetch(apiUrl(`/notes/${noteId}/tags`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: tagName }),
  });
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error("add_tag_error");
  const data = await res.json();
  return data.tags;                      // バックエンド側の返却 {"note_id":1,"tags":["日記","仕事"]} に対応
}

// ノートからタグを削除
export async function removeTag(
  token: string,
  noteId: number,
  tagName: string
): Promise<string[]> {
  const res = await fetch(apiUrl(`/notes/${noteId}/tags/${encodeURIComponent(tagName)}`), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error("remove_tag_error");
  const data = await res.json();
  return data.tags;
}

export interface Tag {
  name: string;
  note_count?: number;
}

// 全タグ一覧を取得
export async function getAllTags(token: string): Promise<Tag[]> {
  const res = await fetch(apiUrl(`/tags`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error("get_tags_error");
  return res.json();
}

// タグでノートを絞り込み
export async function getNotesByTag(
  token: string,
  tagName: string
): Promise<Note[]> {
  const res = await fetch(apiUrl(`/notes?tag=${encodeURIComponent(tagName)}`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error("get_notes_error");
  return res.json();
}

// -------------------------

export async function toggleStar(
  token: string,
  noteId: number
): Promise<number> {
  const res = await fetch(apiUrl(`/notes/${noteId}/important`), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error("toggle_star_error");

  const data = await res.json();
  return data.is_important;   // バックエンドが {"is_important": 1} みたいに返す想定
}

// -------------------------

export async function getNoteDetail(token: string, id: number): Promise<Note> {
  const res = await fetch(apiUrl(`/notes/${id}`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error("fetch_note_error");
  return res.json();
}

export async function saveNote(
  token: string,
  selected: Note | null,
  draft: string,
): Promise<Note> {

  let note: Note;

  // ノート作成 or 更新
  if (selected) {
    note = await updateNote(token, selected.id, {
      title: selected.title,
      content: draft,
    });
  } else {
    const autoTitle = draft.split("\n")[0].slice(0, 30) || "New Note...";
    note = await createNote(token, {
      title: autoTitle,
      content: draft,
    });
  }

  // ノートを再取得して返す
  const refreshed = await getNoteDetail(token, note.id);
  return refreshed;
}

export async function saveAttachments(
  token: string,
  noteId: number,
  draftFiles: File[]
): Promise<Note> {

  // エラーチェックは呼び出し元で済

  // 並列アップロード
  await Promise.all(draftFiles.map((f) => uploadAttachment(token, noteId, f)));

  // ノートを再取得して返す
  const refreshed = await getNoteDetail(token, noteId);
  return refreshed;
}

export async function removeAttachment(
  token: string,
  noteId: number,
  attachmentId: number
): Promise<Note> {

  await deleteAttachment(token, attachmentId);

  // ノートを再取得して返す
  const refreshed = await getNoteDetail(token, noteId);
  return refreshed;
}

// -------------------------

export async function importNotes(token: string, zipFile: File): Promise<{
  imported: number;
  skipped: number;
  message: string;
}> {
  const formData = new FormData();
  formData.append("file", zipFile);

  const res = await fetch(apiUrl(`/import`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error("import_error");

  return res.json();
}

export async function exportNotes(token: string): Promise<Blob> {
  const res = await fetch(apiUrl(`/export`), {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error("export_error");

  return await res.blob(); // ZIPをバイナリで受け取る
}
