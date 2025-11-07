import { useState } from "react";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

//  const BASE_PATH = import.meta.env.BASE_PATH || "";
//  const BASE_PATH = ".";

//  const pathParts = window.location.pathname.split("/").filter(Boolean);
//  const BASE_PATH = pathParts.length > 0 ? "/" + pathParts[0] : "";

  const BASE_PATH = import.meta.env.VITE_BASE_PATH || "";

//  console.log("🧭 Login.tsx BASE_PATH =", BASE_PATH);

  const API_URL = import.meta.env.VITE_API_URL || "/api";
  console.log("🧭 Login.tsx API_URL =", API_URL);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    try {
//      const res = await fetch(`${BASE_PATH}/auth/token`, {
      const res = await fetch(`${API_URL}/auth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username, password }),
      });

      if (!res.ok) throw new Error("ログイン失敗");

      const data = await res.json();
      localStorage.setItem("token", data.access_token);

      // メイン画面へ遷移
      window.location.href = `${BASE_PATH}/`;

    } catch (err) {
      console.error(err);
      setError("ユーザー名またはパスワードが違います");
    }
  };

  return (
    <div className="h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={handleLogin} className="bg-white p-6 rounded-lg shadow-md w-80">
        <h2 className="text-lg font-semibold mb-4 text-center">ログイン</h2>
        {error && <div className="text-red-500 text-sm mb-3">{error}</div>}
        <input
          type="text"
          placeholder="ユーザー名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full border rounded p-2 mb-3 focus:outline-none focus:ring focus:ring-blue-200"
        />
        <input
          type="password"
          placeholder="パスワード"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border rounded p-2 mb-4 focus:outline-none focus:ring focus:ring-blue-200"
        />
        <button
          type="submit"
          className="w-full bg-blue-500 text-white py-2 rounded hover:bg-blue-600 transition"
        >
          ログイン
        </button>
      </form>
    </div>
  );
}

