// dataSource.ts
import { apiUrl } from './utils'
import JSZip from 'jszip'
import {
  listFiles,
  getOrCreateFolderByPath,
  createJsonFile,
  readJsonFile,
  updateJsonFile,
  uploadFile,
  deleteFile,
  downloadFile,
} from './drive/driveApi'
import {
  refreshAccessToken as driveRefreshAccessToken,
  hasDriveRefreshToken,
} from './drive/driveAuth'

// ============================================================
// 型定義
// ============================================================

export interface Note {
  id: number;
  title: string;
  content: string;
  is_important?: number;
  tags?: string[];
  files?: Attachment[];
  updated_at?: string;
  created_at?: string;
}

export interface Attachment {
  id: number;
  filename: string;
  url: string;
}

export interface Tag {
  name: string;
  note_count?: number;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  message: string;
}

// ============================================================
// リポジトリインターフェース
// ============================================================

export interface NotesRepository {
  // 認証
  refreshAccessToken(): Promise<string>;

  // ノートCRUD
  getNotes(): Promise<Note[]>;
  getNoteById(id: number): Promise<Note>;
  createNote(title: string, content: string): Promise<Note>;
  updateNote(id: number, payload: { title?: string; content?: string }): Promise<Note>;
  deleteNote(id: number): Promise<void>;

  // スター
  toggleStar(noteId: number): Promise<number>;

  // タグ
  addTag(noteId: number, tagName: string): Promise<string[]>;
  removeTag(noteId: number, tagName: string): Promise<string[]>;
  getAllTags(): Promise<Tag[]>;

  // 添付ファイル
  uploadAttachment(noteId: number, file: File): Promise<Attachment>;
  deleteAttachment(attachmentId: number): Promise<void>;

  // インポート/エクスポート
  importNotes(zipFile: File): Promise<ImportResult>;
  exportNotes(): Promise<Blob>;

  // ゴミ箱
  emptyTrash(): Promise<{ deleted: number }>;

  // 添付ファイルURL解決
  resolveAttachmentUrl(storedUrl: string): string;
}

// ============================================================
// API接続用実装
// ============================================================

const authHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

export class ApiDataSource implements NotesRepository {

  private getToken(): string {
    const token = localStorage.getItem("token");
    if (!token) throw new Error("no-token");
    return token;
  }

  async refreshAccessToken(): Promise<string> {
    const refreshToken = localStorage.getItem("refresh_token");
    if (!refreshToken) throw new Error("no_refresh_token");

    const res = await fetch(apiUrl(`/auth/refresh`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!res.ok) throw new Error("refresh_failed");
    const { access_token } = await res.json();
    localStorage.setItem("token", access_token);
    return access_token;
  }

  async getNotes(): Promise<Note[]> {
    const token = this.getToken();
    const res = await fetch(apiUrl(`/notes`), {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.status === 401) throw new Error("unauthorized");
    if (!res.ok) throw new Error("fetch_error");
    return res.json();
  }

  async getNoteById(id: number): Promise<Note> {
    const token = this.getToken();
    const res = await fetch(apiUrl(`/notes/${id}`), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) throw new Error("unauthorized");
    if (!res.ok) throw new Error("fetch_note_error");
    return res.json();
  }

  async createNote(title: string, content: string): Promise<Note> {
    const token = this.getToken();
    const res = await fetch(apiUrl(`/notes`), {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ title, content }),
    });
    if (res.status === 401) throw new Error("unauthorized");
    if (!res.ok) throw new Error("create_error");
    return res.json();
  }

  async updateNote(id: number, payload: { title?: string; content?: string }): Promise<Note> {
    const token = this.getToken();
    const res = await fetch(apiUrl(`/notes/${id}`), {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) throw new Error("unauthorized");
    if (!res.ok) throw new Error("update_error");
    return res.json();
  }

  async deleteNote(id: number): Promise<void> {
    const token = this.getToken();
    const res = await fetch(apiUrl(`/notes/${id}`), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) throw new Error("unauthorized");
    if (!res.ok) throw new Error("delete_error");
  }

  async toggleStar(noteId: number): Promise<number> {
    const token = this.getToken();
    const res = await fetch(apiUrl(`/notes/${noteId}/important`), {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) throw new Error("unauthorized");
    if (!res.ok) throw new Error("toggle_star_error");
    const data = await res.json();
    return data.is_important;
  }

  async addTag(noteId: number, tagName: string): Promise<string[]> {
    const token = this.getToken();
    const res = await fetch(apiUrl(`/notes/${noteId}/tags`), {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ name: tagName }),
    });
    if (res.status === 401) throw new Error("unauthorized");
    if (!res.ok) throw new Error("add_tag_error");
    const data = await res.json();
    return data.tags;
  }

  async removeTag(noteId: number, tagName: string): Promise<string[]> {
    const token = this.getToken();
    const res = await fetch(apiUrl(`/notes/${noteId}/tags/${encodeURIComponent(tagName)}`), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) throw new Error("unauthorized");
    if (!res.ok) throw new Error("remove_tag_error");
    const data = await res.json();
    return data.tags;
  }

  async getAllTags(): Promise<Tag[]> {
    const token = this.getToken();
    const res = await fetch(apiUrl(`/tags`), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) throw new Error("unauthorized");
    if (!res.ok) throw new Error("get_tags_error");
    return res.json();
  }

  async uploadAttachment(noteId: number, file: File): Promise<Attachment> {
    const token = this.getToken();
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

  async deleteAttachment(attachmentId: number): Promise<void> {
    const token = this.getToken();
    const res = await fetch(apiUrl(`/attachments/${attachmentId}`), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) throw new Error("unauthorized");
    if (!res.ok) throw new Error("delete_error");
  }

  async importNotes(zipFile: File): Promise<ImportResult> {
    const token = this.getToken();
    const formData = new FormData();
    formData.append("file", zipFile);

    const res = await fetch(apiUrl(`/import`), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    if (res.status === 401) throw new Error("unauthorized");
    if (!res.ok) throw new Error("import_error");

    return res.json();
  }

  async exportNotes(): Promise<Blob> {
    const token = this.getToken();
    const res = await fetch(apiUrl(`/export`), {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401) throw new Error("unauthorized");
    if (!res.ok) throw new Error("export_error");

    return res.blob();
  }

  async emptyTrash(): Promise<{ deleted: number }> {
    const token = this.getToken();
    const res = await fetch(apiUrl(`/trash`), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401) throw new Error("unauthorized");
    if (!res.ok) throw new Error("empty_trash_error");

    return res.json();
  }

  resolveAttachmentUrl(storedUrl: string): string {
    return apiUrl(storedUrl);
  }
}

// ============================================================
// Google Drive接続用実装
// ============================================================

interface DriveNoteJson {
  id: number;
  title: string;
  content: string;
  is_important: number;
  tags: string[];
  files: { id: number; filename: string; url: string }[];
  created_at: string;
  updated_at: string;
}

interface MonthFileJson {
  notes: DriveNoteJson[];
}

interface IndexJson {
  version: number;
  notes: Record<string, string>;       // noteId -> monthFileId
  attachments: Record<string, string>; // attachmentId -> noteId
  trashed: Record<string, string>;     // noteId -> monthFileId
}

export class DriveDataSource implements NotesRepository {
  private rootFolderId: string | null = null;
  private attachmentsFolderId: string | null = null;
  private readonly rootFolderPath = ['SimplyNote'];

  private async getRootFolderId(): Promise<string> {
    if (this.rootFolderId) return this.rootFolderId;
    this.rootFolderId = await getOrCreateFolderByPath(this.rootFolderPath);
    return this.rootFolderId;
  }

  private async getAttachmentsFolderId(): Promise<string> {
    if (this.attachmentsFolderId) return this.attachmentsFolderId;
    const rootId = await this.getRootFolderId();
    const query = `mimeType='application/vnd.google-apps.folder' and name='Attachments' and '${rootId}' in parents and trashed=false`;
    const files = await listFiles(query, 1);
    if (files.length > 0) {
      this.attachmentsFolderId = files[0].id;
    } else {
      const created = await getOrCreateFolderByPath([...this.rootFolderPath, 'Attachments']);
      this.attachmentsFolderId = created;
    }
    return this.attachmentsFolderId;
  }

  private formatMonthFileName(date: Date): string {
    const year = date.getFullYear().toString().padStart(4, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    return `${year}.${month}.json`;
  }

  private async getOrCreateMonthFile(rootId: string, date: Date): Promise<{ id: string; json: MonthFileJson }> {
    const name = this.formatMonthFileName(date);
    const query = `'${rootId}' in parents and name='${name}' and trashed=false`;
    const files = await listFiles(query, 1);

    if (files.length > 0) {
      const json = await readJsonFile<MonthFileJson>(files[0].id);
      return { id: files[0].id, json };
    }

    const initJson: MonthFileJson = { notes: [] };
    const created = await createJsonFile(name, rootId, initJson);
    return { id: created.id, json: initJson };
  }

  private async listMonthFiles(rootId: string): Promise<{ id: string; name: string }[]> {
    const query = `'${rootId}' in parents and mimeType='application/json' and name contains '.json' and name != 'index.json' and trashed=false`;
    const files = await listFiles(query, 1000);
    return files
      .map(f => ({ id: f.id, name: f.name }))
      .sort((a, b) => b.name.localeCompare(a.name));
  }

  private async getOrCreateIndex(rootId: string): Promise<{ id: string; json: IndexJson }> {
    const query = `'${rootId}' in parents and name='index.json' and trashed=false`;
    const files = await listFiles(query, 1);

    if (files.length > 0) {
      const json = await readJsonFile<IndexJson>(files[0].id);
      return { id: files[0].id, json };
    }

    const initJson: IndexJson = { version: 2, notes: {}, attachments: {}, trashed: {} };
    const created = await createJsonFile('index.json', rootId, initJson);
    return { id: created.id, json: initJson };
  }

  async refreshAccessToken(): Promise<string> {
    // リフレッシュトークンがあれば使用
    if (hasDriveRefreshToken()) {
      return driveRefreshAccessToken();
    }
    // リフレッシュトークンがない場合は再ログインが必要
    throw new Error('drive_token_expired');
  }

  async getNotes(): Promise<Note[]> {
    const rootId = await this.getRootFolderId();
    const monthFiles = await this.listMonthFiles(rootId);
    const allNotes: Note[] = [];

    for (const f of monthFiles) {
      try {
        const json = await readJsonFile<MonthFileJson>(f.id);
        for (const n of json.notes || []) {
          allNotes.push({
            id: n.id,
            title: n.title,
            content: n.content,
            is_important: n.is_important,
            tags: n.tags || [],
            files: (n.files || []).map(a => ({
              id: a.id,
              filename: a.filename,
              url: a.url,
            })),
            created_at: n.created_at,
            updated_at: n.updated_at,
          });
        }
      } catch (e) {
        console.error(`Failed to read ${f.name}:`, e);
      }
    }

    // updated_at降順でソート
    allNotes.sort((a, b) => {
      const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
      const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
      return bTime - aTime;
    });

    return allNotes;
  }

  async getNoteById(id: number): Promise<Note> {
    const notes = await this.getNotes();
    const note = notes.find(n => n.id === id);
    if (!note) throw new Error('note_not_found');
    return note;
  }

  async createNote(title: string, content: string): Promise<Note> {
    const now = new Date();
    const id = Date.now() * 1000 + Math.floor(Math.random() * 1000); // マイクロ秒風ID

    const rootId = await this.getRootFolderId();
    const { id: fileId, json } = await this.getOrCreateMonthFile(rootId, now);

    const noteJson: DriveNoteJson = {
      id,
      title,
      content,
      is_important: 0,
      tags: [],
      files: [],
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };

    json.notes.unshift(noteJson);
    await updateJsonFile(fileId, json);

    // index更新
    const { id: indexId, json: indexJson } = await this.getOrCreateIndex(rootId);
    indexJson.notes[id.toString()] = fileId;
    await updateJsonFile(indexId, indexJson);

    return {
      id: noteJson.id,
      title: noteJson.title,
      content: noteJson.content,
      is_important: noteJson.is_important,
      tags: noteJson.tags,
      files: [],
      created_at: noteJson.created_at,
      updated_at: noteJson.updated_at,
    };
  }

  async updateNote(id: number, payload: { title?: string; content?: string }): Promise<Note> {
    const rootId = await this.getRootFolderId();
    const monthFiles = await this.listMonthFiles(rootId);
    const now = new Date().toISOString();

    for (const f of monthFiles) {
      const json = await readJsonFile<MonthFileJson>(f.id);
      const idx = json.notes.findIndex(n => n.id === id);
      if (idx !== -1) {
        if (payload.title !== undefined) json.notes[idx].title = payload.title;
        if (payload.content !== undefined) json.notes[idx].content = payload.content;
        json.notes[idx].updated_at = now;

        await updateJsonFile(f.id, json);

        const n = json.notes[idx];
        return {
          id: n.id,
          title: n.title,
          content: n.content,
          is_important: n.is_important,
          tags: n.tags || [],
          files: (n.files || []).map(a => ({ id: a.id, filename: a.filename, url: a.url })),
          created_at: n.created_at,
          updated_at: n.updated_at,
        };
      }
    }

    throw new Error('note_not_found');
  }

  async deleteNote(id: number): Promise<void> {
    const rootId = await this.getRootFolderId();
    const monthFiles = await this.listMonthFiles(rootId);

    for (const f of monthFiles) {
      const json = await readJsonFile<MonthFileJson>(f.id);
      const idx = json.notes.findIndex(n => n.id === id);
      if (idx !== -1) {
        // 添付ファイルも削除
        const note = json.notes[idx];
        for (const att of note.files || []) {
          if (att.url) {
            try { await deleteFile(att.url); } catch { /* ignore */ }
          }
        }

        json.notes.splice(idx, 1);
        await updateJsonFile(f.id, json);

        // index更新
        const { id: indexId, json: indexJson } = await this.getOrCreateIndex(rootId);
        delete indexJson.notes[id.toString()];
        delete indexJson.trashed[id.toString()];
        await updateJsonFile(indexId, indexJson);

        return;
      }
    }
  }

  async toggleStar(noteId: number): Promise<number> {
    const rootId = await this.getRootFolderId();
    const monthFiles = await this.listMonthFiles(rootId);

    for (const f of monthFiles) {
      const json = await readJsonFile<MonthFileJson>(f.id);
      const idx = json.notes.findIndex(n => n.id === noteId);
      if (idx !== -1) {
        const current = json.notes[idx].is_important || 0;
        const next = current === 1 ? 0 : 1;
        json.notes[idx].is_important = next;
        await updateJsonFile(f.id, json);
        return next;
      }
    }

    throw new Error('note_not_found');
  }

  async addTag(noteId: number, tagName: string): Promise<string[]> {
    const rootId = await this.getRootFolderId();
    const monthFiles = await this.listMonthFiles(rootId);

    for (const f of monthFiles) {
      const json = await readJsonFile<MonthFileJson>(f.id);
      const idx = json.notes.findIndex(n => n.id === noteId);
      if (idx !== -1) {
        const tags = json.notes[idx].tags || [];
        if (!tags.includes(tagName)) {
          tags.push(tagName);
          json.notes[idx].tags = tags;
          await updateJsonFile(f.id, json);
        }
        return tags;
      }
    }

    throw new Error('note_not_found');
  }

  async removeTag(noteId: number, tagName: string): Promise<string[]> {
    const rootId = await this.getRootFolderId();
    const monthFiles = await this.listMonthFiles(rootId);

    for (const f of monthFiles) {
      const json = await readJsonFile<MonthFileJson>(f.id);
      const idx = json.notes.findIndex(n => n.id === noteId);
      if (idx !== -1) {
        const tags = (json.notes[idx].tags || []).filter(t => t !== tagName);
        json.notes[idx].tags = tags;
        await updateJsonFile(f.id, json);
        return tags;
      }
    }

    throw new Error('note_not_found');
  }

  async getAllTags(): Promise<Tag[]> {
    const notes = await this.getNotes();
    const counter: Record<string, number> = {};

    for (const n of notes) {
      for (const t of n.tags || []) {
        counter[t] = (counter[t] || 0) + 1;
      }
    }

    return Object.entries(counter)
      .map(([name, count]) => ({ name, note_count: count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async uploadAttachment(noteId: number, file: File): Promise<Attachment> {
    const rootId = await this.getRootFolderId();
    const attFolderId = await this.getAttachmentsFolderId();

    // ファイルアップロード
    const uploaded = await uploadFile(file.name, attFolderId, file);
    const attId = Date.now() * 1000 + Math.floor(Math.random() * 1000);

    // ノートを探して添付ファイル追加
    const monthFiles = await this.listMonthFiles(rootId);
    for (const f of monthFiles) {
      const json = await readJsonFile<MonthFileJson>(f.id);
      const idx = json.notes.findIndex(n => n.id === noteId);
      if (idx !== -1) {
        const attJson = { id: attId, filename: file.name, url: uploaded.id };
        json.notes[idx].files = json.notes[idx].files || [];
        json.notes[idx].files.push(attJson);
        json.notes[idx].updated_at = new Date().toISOString();
        await updateJsonFile(f.id, json);

        // index更新
        const { id: indexId, json: indexJson } = await this.getOrCreateIndex(rootId);
        indexJson.attachments[attId.toString()] = noteId.toString();
        await updateJsonFile(indexId, indexJson);

        return { id: attId, filename: file.name, url: uploaded.id };
      }
    }

    throw new Error('note_not_found');
  }

  async deleteAttachment(attachmentId: number): Promise<void> {
    const rootId = await this.getRootFolderId();
    const monthFiles = await this.listMonthFiles(rootId);

    for (const f of monthFiles) {
      const json = await readJsonFile<MonthFileJson>(f.id);
      for (let i = 0; i < json.notes.length; i++) {
        const files = json.notes[i].files || [];
        const idx = files.findIndex(a => a.id === attachmentId);
        if (idx !== -1) {
          const att = files[idx];
          if (att.url) {
            try { await deleteFile(att.url); } catch { /* ignore */ }
          }
          files.splice(idx, 1);
          json.notes[i].files = files;
          json.notes[i].updated_at = new Date().toISOString();
          await updateJsonFile(f.id, json);

          // index更新
          const { id: indexId, json: indexJson } = await this.getOrCreateIndex(rootId);
          delete indexJson.attachments[attachmentId.toString()];
          await updateJsonFile(indexId, indexJson);

          return;
        }
      }
    }
  }

  async importNotes(zipFile: File): Promise<ImportResult> {
    const zip = await JSZip.loadAsync(zipFile);

    // notes.json を読み込み
    const notesJsonFile = zip.file('notes.json');
    if (!notesJsonFile) {
      throw new Error('notes.json not found in ZIP');
    }

    const notesJsonText = await notesJsonFile.async('text');
    const importedNotes: Array<{
      title: string;
      content: string;
      is_important?: number;
      tags?: string[];
      files?: Array<{ filename: string }>;
      created_at?: string;
      updated_at?: string;
    }> = JSON.parse(notesJsonText);

    let imported = 0;
    let skipped = 0;

    for (const noteData of importedNotes) {
      try {
        // ノートを作成
        const created = await this.createNote(noteData.title || 'Untitled', noteData.content || '');

        // スター設定
        if (noteData.is_important) {
          await this.toggleStar(created.id);
        }

        // タグ追加
        if (noteData.tags && noteData.tags.length > 0) {
          for (const tag of noteData.tags) {
            await this.addTag(created.id, tag);
          }
        }

        // 添付ファイルをアップロード
        if (noteData.files && noteData.files.length > 0) {
          for (const fileInfo of noteData.files) {
            const attachmentPath = `attachments/${fileInfo.filename}`;
            const attachmentFile = zip.file(attachmentPath);
            if (attachmentFile) {
              const blob = await attachmentFile.async('blob');
              const file = new File([blob], fileInfo.filename);
              await this.uploadAttachment(created.id, file);
            }
          }
        }

        imported++;
      } catch (err) {
        console.error('Failed to import note:', err);
        skipped++;
      }
    }

    return {
      imported,
      skipped,
      message: `Imported ${imported} notes, skipped ${skipped}`,
    };
  }

  async exportNotes(): Promise<Blob> {
    const notes = await this.getNotes();
    const zip = new JSZip();

    // エクスポート用のノートデータを作成
    const exportNotes = notes.map(note => ({
      title: note.title,
      content: note.content,
      is_important: note.is_important || 0,
      tags: note.tags || [],
      files: (note.files || []).map(f => ({ filename: f.filename })),
      created_at: note.created_at,
      updated_at: note.updated_at,
    }));

    // notes.json を追加
    zip.file('notes.json', JSON.stringify(exportNotes, null, 2));

    // 添付ファイルをダウンロードして追加
    const attachmentsFolder = zip.folder('attachments');
    for (const note of notes) {
      if (note.files && note.files.length > 0) {
        for (const file of note.files) {
          try {
            // file.url にはDriveのファイルIDが入っている
            const blob = await downloadFile(file.url);
            attachmentsFolder?.file(file.filename, blob);
          } catch (err) {
            console.error(`Failed to download attachment: ${file.filename}`, err);
          }
        }
      }
    }

    // ZIPを生成して返す
    return zip.generateAsync({ type: 'blob' });
  }

  async emptyTrash(): Promise<{ deleted: number }> {
    const rootId = await this.getRootFolderId();
    const monthFiles = await this.listMonthFiles(rootId);

    let deleted = 0;
    const deletedNoteIds: string[] = [];
    const attachmentsToDelete: string[] = [];

    // 各月ファイルを処理（トラッシュノートを収集・削除）
    for (const f of monthFiles) {
      const json = await readJsonFile<MonthFileJson>(f.id);
      const originalLength = json.notes.length;

      // Trashタグを持つノートを特定
      const trashNotes = json.notes.filter(n =>
        n.tags?.some(t => t.toLowerCase() === 'trash')
      );

      if (trashNotes.length === 0) continue;

      // 削除対象の添付ファイルURLを収集
      for (const note of trashNotes) {
        deletedNoteIds.push(note.id.toString());
        for (const att of note.files || []) {
          if (att.url) attachmentsToDelete.push(att.url);
        }
      }

      // Trashノートを除外
      json.notes = json.notes.filter(n =>
        !n.tags?.some(t => t.toLowerCase() === 'trash')
      );

      deleted += originalLength - json.notes.length;

      // 月ファイルを更新
      await updateJsonFile(f.id, json);
    }

    // 添付ファイルを並列削除（最大10並列）
    const chunkSize = 10;
    for (let i = 0; i < attachmentsToDelete.length; i += chunkSize) {
      const chunk = attachmentsToDelete.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(url => deleteFile(url).catch(() => { /* ignore */ }))
      );
    }

    // インデックスを一括更新
    if (deletedNoteIds.length > 0) {
      const { id: indexId, json: indexJson } = await this.getOrCreateIndex(rootId);
      for (const noteId of deletedNoteIds) {
        delete indexJson.notes[noteId];
        delete indexJson.trashed[noteId];
      }
      await updateJsonFile(indexId, indexJson);
    }

    return { deleted };
  }

  resolveAttachmentUrl(storedUrl: string): string {
    // Drive APIでダウンロードするURLを返す
    return `https://drive.google.com/file/d/${storedUrl}/view?usp=drivesdk`;
  }
}

// ============================================================
// DataSource取得
// ============================================================

let dataSourceInstance: NotesRepository | null = null;

export function getDataSource(): NotesRepository {
  if (dataSourceInstance) return dataSourceInstance;

  const backend = localStorage.getItem("backend") || "api";

  if (backend === "drive") {
    dataSourceInstance = new DriveDataSource();
    return dataSourceInstance;
  }

  dataSourceInstance = new ApiDataSource();
  return dataSourceInstance;
}

export function clearDataSource(): void {
  dataSourceInstance = null;
}
