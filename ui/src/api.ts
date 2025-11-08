// api.ts
export interface FileOut {
  id: number;
  filename: string;
  url: string;
}

export interface Note {
  id: number;
  title: string;
  content: string;
  tags?: string[];
  files?: FileOut[]; 
  updated_at?: string;
  created_at?: string;
}

const API_URL = import.meta.env.VITE_API_URL || "/api";
console.log("🧭 App.tsx API_URL =", API_URL);

const authHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

// -------------------------

export async function getNotes(token: string): Promise<Note[]> {
  const res = await fetch(`${API_URL}/notes`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error("fetch_error");
  return res.json();
}

export async function createNote(token: string, payload: { title: string; content: string }): Promise<Note> {
  const res = await fetch(`${API_URL}/notes`, {
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
  const res = await fetch(`${API_URL}/notes/${id}`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error("update_error");
  return res.json();
}

export async function deleteNote(token: string, id: number): Promise<void> {
  const res = await fetch(`${API_URL}/notes/${id}`, {
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
  const res = await fetch(`${API_URL}/notes/${noteId}/attachments`, {
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
  const res = await fetch(`${API_URL}/attachments/${attachmentId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error("delete_error");
}

// -------------------------

export interface Tag {
  name: string;
  note_count?: number;
}

// ノートにタグを追加
export async function addTag(
  token: string,
  noteId: number,
  tagName: string
): Promise<string[]> {
  const res = await fetch(`${API_URL}/notes/${noteId}/tags`, {
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
  return data.tags; // バックエンド側の返却 {"note_id":1,"tags":["日記","仕事"]} に対応
}

// ノートからタグを削除
export async function removeTag(
  token: string,
  noteId: number,
  tagName: string
): Promise<string[]> {
  const res = await fetch(`${API_URL}/notes/${noteId}/tags/${encodeURIComponent(tagName)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error("remove_tag_error");
  const data = await res.json();
  return data.tags;
}

// 全タグ一覧を取得
export async function getAllTags(token: string): Promise<Tag[]> {
  const res = await fetch(`${API_URL}/tags`, {
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
  const res = await fetch(`${API_URL}/notes?tag=${encodeURIComponent(tagName)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error("get_notes_error");
  return res.json();
}

// -------------------------

export async function getNoteDetail(token: string, id: number): Promise<Note> {
  const res = await fetch(`${API_URL}/notes/${id}`, {
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
    const autoTitle = draft.split("\n")[0].slice(0, 30) || "新しいノート";
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

  if( draftFiles.length === 0 ) { return; }

  for (const f of draftFiles) {
    await uploadAttachment(token, noteId, f);
  }

  // ノートを再取得して返す
  const refreshed = await getNoteDetail(token, noteId);
  return refreshed;
}


