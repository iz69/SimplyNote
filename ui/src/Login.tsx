import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { basePath, apiUrl } from './utils'
import { clearDataSource } from './dataSource'
import {
  generateAuthUrl,
  parseTokenData,
  saveDriveToken,
  saveDriveRefreshToken,
  saveDriveTokenExpiry,
  hasClientId,
} from './drive/driveAuth'

export default function Login() {
  const { t } = useTranslation();

  const [username, setUsername] = useState(localStorage.getItem("username") || "");
  const [password, setPassword] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState(localStorage.getItem("api_base_url") || "");
  const [error, setError] = useState("");
  const [enableApi, setEnableApi] = useState(true);
  const [enableDrive, setEnableDrive] = useState(true);
  const [configLoaded, setConfigLoaded] = useState(false);

  // config.jsonからランタイム設定を読み込む
  useEffect(() => {
    fetch(basePath() + "/config.json")
      .then(res => {
        if (!res.ok) throw new Error("Not found");
        return res.json();
      })
      .then(config => {
        setEnableApi(config.enableApi ?? true);
        setEnableDrive(config.enableDrive ?? true);
      })
      .catch(() => {
        // 読み込み失敗時はデフォルト両方true
        setEnableApi(true);
        setEnableDrive(true);
      })
      .finally(() => {
        setConfigLoaded(true);
      });
  }, []);

  // Google Drive接続用
  const [driveTokenInput, setDriveTokenInput] = useState("");
  const [driveError, setDriveError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {

    e.preventDefault();
    setError("");

    localStorage.setItem("username", username);
    localStorage.setItem("api_base_url", apiBaseUrl);

    try {
      const res = await fetch(apiUrl(`/auth/token`), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username, password }),
      });

      if (!res.ok) throw new Error("Login failed");

      const data = await res.json();

      localStorage.setItem("token", data.access_token);
      localStorage.setItem("refresh_token", data.refresh_token);
      localStorage.setItem("backend", "api");
      clearDataSource();

      // メイン画面へ遷移
      window.location.href = basePath() + "/";

    } catch (err) {
      console.error(err);
      setError(t("login.loginFailed"));
    }
  };

  const handleDriveConnect = () => {
    setDriveError("");

    const input = driveTokenInput.trim();
    if (!input) {
      setDriveError(t("login.tokenRequired"));
      return;
    }

    // JSON形式または旧形式（access_tokenのみ）を解析
    const tokenData = parseTokenData(input);
    if (!tokenData) {
      setDriveError(t("login.tokenInvalid"));
      return;
    }

    // トークン保存
    saveDriveToken(tokenData.access_token);
    if (tokenData.refresh_token) {
      saveDriveRefreshToken(tokenData.refresh_token);
    }
    if (tokenData.expires_in) {
      saveDriveTokenExpiry(tokenData.expires_in);
    }

    localStorage.setItem("backend", "drive");
    clearDataSource();

    // メイン画面へ遷移
    window.location.href = basePath() + "/";
  };

  const authUrl = hasClientId() ? generateAuthUrl() : "";

  // config読み込み前はローディング表示
  if (!configLoaded) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">{t("app.loading")}</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-6 rounded-lg shadow-md w-96">
        <h2 className="text-lg font-semibold mb-4 text-center">SimplyNote</h2>

        {/* API接続セクション（config.json の enableApi=true の場合のみ表示） */}
        {enableApi && (
          <form onSubmit={handleLogin}>
            <div className="text-sm font-medium text-gray-700 mb-2">{t("login.apiConnection")}</div>

            {error && <div className="text-red-500 text-sm mb-3">{error}</div>}

            <input
              type="text"
              placeholder={t("login.apiUrlPlaceholder")}
              value={apiBaseUrl}
              onChange={(e) => setApiBaseUrl(e.target.value)}
              className="w-full border rounded p-2 mb-3 focus:outline-none focus:ring focus:ring-blue-200"
            />

            <input
              type="text"
              placeholder={t("login.username")}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full border rounded p-2 mb-3 focus:outline-none focus:ring focus:ring-blue-200"
            />
            <input
              type="password"
              placeholder={t("login.password")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border rounded p-2 mb-4 focus:outline-none focus:ring focus:ring-blue-200"
            />
            <button
              type="submit"
              className="w-full bg-blue-500 text-white py-2 rounded hover:bg-blue-600 transition" >
              {t("login.loginButton")}
            </button>
          </form>
        )}

        {/* Google Drive接続セクション（config.json の enableDrive=true の場合のみ表示） */}
        {enableDrive && (
          <>
            {/* 区切り線（両方有効な場合のみ） */}
            {enableApi && (
              <div className="flex items-center my-4">
                <div className="flex-1 border-t border-gray-300"></div>
                <span className="px-3 text-gray-500 text-sm">{t("login.or")}</span>
                <div className="flex-1 border-t border-gray-300"></div>
              </div>
            )}

            <div>
              <div className="text-sm font-medium text-gray-700 mb-2">{t("login.driveConnection")}</div>

              {!hasClientId() ? (
                <div className="text-red-500 text-sm mb-3">
                  {t("login.clientIdMissing")}
                </div>
              ) : (
                <>
                  <div className="text-sm text-gray-600 mb-3">
                    <p className="font-medium mb-2">{t("login.step1")}</p>
                    <button
                      type="button"
                      onClick={() => window.open(authUrl, '_blank')}
                      className="w-full bg-blue-500 text-white py-2 rounded hover:bg-blue-600 transition"
                    >
                      {t("login.authWithGoogle")}
                    </button>
                  </div>

                  <div className="text-sm text-gray-600 mb-3">
                    <p className="font-medium mb-2">{t("login.step2")}</p>
                    <textarea
                      placeholder={t("login.tokenPlaceholder")}
                      value={driveTokenInput}
                      onChange={(e) => setDriveTokenInput(e.target.value)}
                      className="w-full border rounded p-2 text-sm focus:outline-none focus:ring focus:ring-green-200"
                      rows={3}
                    />
                  </div>

                  {driveError && <div className="text-red-500 text-sm mb-3">{driveError}</div>}

                  <button
                    type="button"
                    onClick={handleDriveConnect}
                    className="w-full bg-green-500 text-white py-2 rounded hover:bg-green-600 transition"
                  >
                    {t("login.connectDrive")}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
