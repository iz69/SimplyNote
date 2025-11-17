import { useState } from "react";
import { basePath, apiUrl } from './utils'

export default function Login() {

  const [username, setUsername] = useState(localStorage.getItem("username") || "");
  const [password, setPassword] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState(localStorage.getItem("api_base_url") || "");
  const [error, setError] = useState("");

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

      // メイン画面へ遷移
      window.location.href = basePath() + "/";

    } catch (err) {
      console.error(err);
      setError("Incorrect username or password.");
    }
  };

  return (
    <div className="h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={handleLogin} className="bg-white p-6 rounded-lg shadow-md w-80">
        <h2 className="text-lg font-semibold mb-4 text-center">SimplyNote</h2>

        {error && <div className="text-red-500 text-sm mb-3">{error}</div>}

        <input
          type="text"
          placeholder="API URL (例: https://example.com/simplynote-api)"
          value={apiBaseUrl}
          onChange={(e) => setApiBaseUrl(e.target.value)}
          className="w-full border rounded p-2 mb-3 focus:outline-none focus:ring focus:ring-blue-200"
        />

        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full border rounded p-2 mb-3 focus:outline-none focus:ring focus:ring-blue-200"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border rounded p-2 mb-4 focus:outline-none focus:ring focus:ring-blue-200"
        />
        <button
          type="submit"
          className="w-full bg-blue-500 text-white py-2 rounded hover:bg-blue-600 transition" >
          Login
        </button>
      </form>
    </div>
  );
}

