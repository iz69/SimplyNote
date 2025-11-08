// api.ts
export interface Note {
  id: number;
  title: string;
  content: string;
  updated_at?: string;
}

export interface Attachment {
  id: number;
  filename: string;
  url: string;
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

export async function getNoteDetail(token: string, id: number): Promise<Note> {
  const res = await fetch(`${API_URL}/notes/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error("fetch_note_error");
  return res.json();
}

export async function saveNoteWithAttachments(
  token: string,
  selected: Note | null,
  draft: string,
  draftFiles: File[]
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

  // 添付ファイルアップロード
  if (draftFiles.length > 0) {
    for (const f of draftFiles) {
      await uploadAttachment(token, note.id, f);
    }
  }

  // ノートを再取得して返す
  const refreshed = await getNoteDetail(token, note.id);
  return refreshed;
}



