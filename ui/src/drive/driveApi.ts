// drive/driveApi.ts
// Google Drive REST API操作

import { getDriveToken } from './driveAuth';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API_BASE = 'https://www.googleapis.com/upload/drive/v3';

interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
  modifiedTime?: string;
  parents?: string[];
}

interface DriveFileList {
  files: DriveFile[];
  nextPageToken?: string;
}

function getAuthHeaders(): HeadersInit {
  const token = getDriveToken();
  if (!token) throw new Error('no_drive_token');
  return {
    Authorization: `Bearer ${token}`,
  };
}

// ファイル一覧取得
export async function listFiles(query: string, pageSize = 100): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    q: query,
    spaces: 'drive',
    pageSize: pageSize.toString(),
    fields: 'files(id,name,mimeType,modifiedTime,parents)',
  });

  const res = await fetch(`${DRIVE_API_BASE}/files?${params}`, {
    headers: getAuthHeaders(),
  });

  if (res.status === 401) throw new Error('unauthorized');
  if (!res.ok) throw new Error(`drive_api_error: ${res.status}`);

  const data: DriveFileList = await res.json();
  return data.files || [];
}

// フォルダをパスで検索/作成
export async function getOrCreateFolderByPath(pathParts: string[]): Promise<string> {
  let parentId = 'root';

  for (const name of pathParts) {
    if (!name.trim()) continue;

    const escapedName = name.replace(/'/g, "\\'");
    const query = `mimeType='application/vnd.google-apps.folder' and name='${escapedName}' and '${parentId}' in parents and trashed=false`;

    const files = await listFiles(query, 1);

    if (files.length > 0) {
      parentId = files[0].id;
    } else {
      // フォルダ作成
      const created = await createFile({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      });
      parentId = created.id;
    }
  }

  return parentId;
}

// ファイルメタデータ作成（フォルダ含む）
export async function createFile(metadata: {
  name: string;
  mimeType?: string;
  parents?: string[];
}): Promise<DriveFile> {
  const res = await fetch(`${DRIVE_API_BASE}/files`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(metadata),
  });

  if (res.status === 401) throw new Error('unauthorized');
  if (!res.ok) throw new Error(`drive_api_error: ${res.status}`);

  return res.json();
}

// JSONファイル作成
export async function createJsonFile(
  name: string,
  parentId: string,
  content: object
): Promise<DriveFile> {
  const metadata = {
    name,
    mimeType: 'application/json',
    parents: [parentId],
  };

  const body = JSON.stringify(content);
  const blob = new Blob([body], { type: 'application/json' });

  const formData = new FormData();
  formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  formData.append('file', blob);

  const res = await fetch(`${UPLOAD_API_BASE}/files?uploadType=multipart`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  });

  if (res.status === 401) throw new Error('unauthorized');
  if (!res.ok) throw new Error(`drive_api_error: ${res.status}`);

  return res.json();
}

// JSONファイル読み込み
export async function readJsonFile<T = unknown>(fileId: string): Promise<T> {
  const res = await fetch(`${DRIVE_API_BASE}/files/${fileId}?alt=media`, {
    headers: getAuthHeaders(),
  });

  if (res.status === 401) throw new Error('unauthorized');
  if (!res.ok) throw new Error(`drive_api_error: ${res.status}`);

  return res.json();
}

// JSONファイル更新
export async function updateJsonFile(fileId: string, content: object): Promise<DriveFile> {
  const body = JSON.stringify(content);
  const blob = new Blob([body], { type: 'application/json' });

  const res = await fetch(`${UPLOAD_API_BASE}/files/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: blob,
  });

  if (res.status === 401) throw new Error('unauthorized');
  if (!res.ok) throw new Error(`drive_api_error: ${res.status}`);

  return res.json();
}

// バイナリファイルアップロード
export async function uploadFile(
  name: string,
  parentId: string,
  file: File
): Promise<DriveFile> {
  const metadata = {
    name,
    parents: [parentId],
  };

  const formData = new FormData();
  formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  formData.append('file', file);

  const res = await fetch(`${UPLOAD_API_BASE}/files?uploadType=multipart`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  });

  if (res.status === 401) throw new Error('unauthorized');
  if (!res.ok) throw new Error(`drive_api_error: ${res.status}`);

  return res.json();
}

// ファイル削除
export async function deleteFile(fileId: string): Promise<void> {
  const res = await fetch(`${DRIVE_API_BASE}/files/${fileId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });

  if (res.status === 401) throw new Error('unauthorized');
  if (res.status === 404) return; // 既に削除済み
  if (!res.ok) throw new Error(`drive_api_error: ${res.status}`);
}

// ファイル情報取得
export async function getFileMetadata(fileId: string): Promise<DriveFile> {
  const params = new URLSearchParams({
    fields: 'id,name,mimeType,modifiedTime,parents',
  });

  const res = await fetch(`${DRIVE_API_BASE}/files/${fileId}?${params}`, {
    headers: getAuthHeaders(),
  });

  if (res.status === 401) throw new Error('unauthorized');
  if (!res.ok) throw new Error(`drive_api_error: ${res.status}`);

  return res.json();
}

// ファイルダウンロード（バイナリ）
export async function downloadFile(fileId: string): Promise<Blob> {
  const res = await fetch(`${DRIVE_API_BASE}/files/${fileId}?alt=media`, {
    headers: getAuthHeaders(),
  });

  if (res.status === 401) throw new Error('unauthorized');
  if (!res.ok) throw new Error(`drive_api_error: ${res.status}`);

  return res.blob();
}
