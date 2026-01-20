// drive/driveAuth.ts
// Google Drive認証関連（Authorization Code Flow）

const GOOGLE_CLIENT_ID = '961932586868-k1tqjrs8dl44voa9safaqbti1a5f7c0v.apps.googleusercontent.com';
const REDIRECT_URI = 'https://kuromaru-fx.com/api/simplynote_google_auth.php';
const REFRESH_ENDPOINT = 'https://kuromaru-fx.com/api/simplynote_google_auth.php';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

// 認証URL生成（Authorization Code Flow）
export function generateAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',  // refresh_token を取得するために必要
    prompt: 'consent',       // 常に同意画面を表示（refresh_token確実に取得）
    include_granted_scopes: 'true',
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// トークンJSON文字列を解析
export interface DriveTokenData {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

export function parseTokenData(input: string): DriveTokenData | null {
  try {
    // JSON形式を試す
    const data = JSON.parse(input.trim());
    if (data.access_token) {
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token || undefined,
        expires_in: data.expires_in || 3600,
      };
    }
    return null;
  } catch {
    // JSON解析失敗 → 旧形式（access_tokenのみ）として扱う
    const token = input.trim();
    if (token.length > 0) {
      return {
        access_token: token,
        refresh_token: undefined,
        expires_in: 3600,
      };
    }
    return null;
  }
}

// URLからアクセストークンを抽出（旧Implicit Flow互換）
export function extractTokenFromUrl(url: string): string | null {
  try {
    // URLフラグメント（#以降）からトークンを抽出
    // 例: http://localhost/#access_token=xxx&token_type=Bearer&...
    const hashIndex = url.indexOf('#');
    if (hashIndex === -1) return null;

    const fragment = url.substring(hashIndex + 1);
    const params = new URLSearchParams(fragment);
    return params.get('access_token');
  } catch {
    return null;
  }
}

// トークンをlocalStorageに保存
export function saveDriveToken(token: string): void {
  localStorage.setItem('drive_token', token);
}

// リフレッシュトークンをlocalStorageに保存
export function saveDriveRefreshToken(refreshToken: string): void {
  localStorage.setItem('drive_refresh_token', refreshToken);
}

// 有効期限を保存（expires_in は秒数）
export function saveDriveTokenExpiry(expiresIn: number): void {
  const expiresAt = Date.now() + expiresIn * 1000;
  localStorage.setItem('drive_token_expires_at', expiresAt.toString());
}

// トークンをlocalStorageから取得
export function getDriveToken(): string | null {
  return localStorage.getItem('drive_token');
}

// リフレッシュトークンをlocalStorageから取得
export function getDriveRefreshToken(): string | null {
  return localStorage.getItem('drive_refresh_token');
}

// 有効期限までのミリ秒を取得
export function msUntilDriveTokenExpiry(): number | null {
  const expiresAt = localStorage.getItem('drive_token_expires_at');
  if (!expiresAt) return null;
  return parseInt(expiresAt, 10) - Date.now();
}

// トークンをlocalStorageから削除
export function clearDriveToken(): void {
  localStorage.removeItem('drive_token');
  localStorage.removeItem('drive_refresh_token');
  localStorage.removeItem('drive_token_expires_at');
}

// トークンが設定されているか確認
export function hasDriveToken(): boolean {
  const token = getDriveToken();
  return token !== null && token.length > 0;
}

// リフレッシュトークンが設定されているか確認
export function hasDriveRefreshToken(): boolean {
  const token = getDriveRefreshToken();
  return token !== null && token.length > 0;
}

// Client IDが設定されているか確認
export function hasClientId(): boolean {
  return GOOGLE_CLIENT_ID.length > 0;
}

// リフレッシュトークンを使って新しいアクセストークンを取得
export async function refreshAccessToken(): Promise<string> {
  const refreshToken = getDriveRefreshToken();
  if (!refreshToken) {
    throw new Error('no_refresh_token');
  }

  const res = await fetch(REFRESH_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!res.ok) {
    throw new Error('refresh_failed');
  }

  const data = await res.json();

  if (data.error) {
    throw new Error(data.error_description || data.error);
  }

  // 新しいアクセストークンを保存
  saveDriveToken(data.access_token);
  if (data.expires_in) {
    saveDriveTokenExpiry(data.expires_in);
  }

  return data.access_token;
}
