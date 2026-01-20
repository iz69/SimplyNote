// drive/driveAuth.ts
// Google Drive認証関連

const GOOGLE_CLIENT_ID = '961932586868-nr233bs4di9eq5smljlvv43bahfudr28.apps.googleusercontent.com';
const REDIRECT_URI = 'https://kuromaru-fx.com/api/simplynote_webauth.php';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

// 認証URL生成（Implicit Flow）
export function generateAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'token',
    scope: SCOPE,
    include_granted_scopes: 'true',
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// URLからアクセストークンを抽出
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

// トークンをlocalStorageから取得
export function getDriveToken(): string | null {
  return localStorage.getItem('drive_token');
}

// トークンをlocalStorageから削除
export function clearDriveToken(): void {
  localStorage.removeItem('drive_token');
}

// トークンが設定されているか確認
export function hasDriveToken(): boolean {
  const token = getDriveToken();
  return token !== null && token.length > 0;
}

// Client IDが設定されているか確認
export function hasClientId(): boolean {
  return GOOGLE_CLIENT_ID.length > 0;
}
