import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useNavigate } from "react-router-dom";

console.log(localStorage.getItem("token"))

interface Note {
  id: number;
  title: string;
  content: string;
  updated_at?: string;
}

export default function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selected, setSelected] = useState<Note | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");

//  const pathParts = window.location.pathname.split("/").filter(Boolean);
//  const BASE_PATH = pathParts.length > 0 ? "/" + pathParts[0] : "";

//  const BASE_PATH = import.meta.env.VITE_BASE_PATH || "";

//  const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, ""); // 末尾スラッシュ削除

  const BASE_PATH = import.meta.env.VITE_BASE_PATH || "";

  console.log("🧭 App.tsx BASE_PATH =", BASE_PATH);

//  const BASE_PATH = ".";
//  const BASE_PATH = "";

  const API_URL = import.meta.env.VITE_API_URL || "/api";

  // ------------------------------------------------------------
  // ノート一覧を取得
  // ------------------------------------------------------------
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      window.location.href = `${BASE_PATH}/login`;
      return;
    }

//    fetch(`${BASE_PATH}/notes`, {
    fetch(`${API_URL}/notes`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (res.status === 401) throw new Error("unauthorized");
        return res.json();
      })
      .then((data) => {
        setNotes(data);
        if (data.length > 0) setSelected(data[0]);
      })
      .catch((err) => {
        console.error("Fetch error:", err);
        if (err.message === "unauthorized") {
          localStorage.removeItem("token");
          window.location.href = `${BASE_PATH}/login`;
        }
      });
  }, []);

  const handleSelect = (note: Note) => {
    setSelected(note);
    setIsEditing(false);
    setDraft(note.content);
  };

  // ------------------------------------------------------------
  // 新規作成
  // ------------------------------------------------------------
  const handleNew = async () => {
    const token = localStorage.getItem("token");
    if (!token) return;

//    const res = await fetch(`${BASE_PATH}/notes`, {
    const res = await fetch(`${API_URL}/notes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ title: "新しいノート", content: "" }),
    });

    if (!res.ok) {
      console.error("Failed to create note");
      return;
    }

    const newNote = await res.json();
    setNotes([newNote, ...notes]);
    setSelected(newNote);
    setDraft("");
    setIsEditing(true);
  };

  // ------------------------------------------------------------
  // 保存
  // ------------------------------------------------------------
  const handleSave = async () => {
    if (!selected) return;
    const token = localStorage.getItem("token");

//    const res = await fetch(`${BASE_PATH}/notes/${selected.id}`, {
    const res = await fetch(`${API_URL}/notes/${selected.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ title: selected.title, content: draft }),
    });

    if (!res.ok) {
      console.error("Failed to save note");
      return;
    }

    const updated = await res.json();
    setNotes(notes.map((n) => (n.id === updated.id ? updated : n)));
    setSelected(updated);
    setIsEditing(false);
  };

  // ------------------------------------------------------------
  // 削除
  // ------------------------------------------------------------
  const handleDelete = async () => {
    if (!selected) return;
    const token = localStorage.getItem("token");

//    const res = await fetch(`${BASE_PATH}/notes/${selected.id}`, {
    const res = await fetch(`${API_URL}/notes/${selected.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.ok) {
      setNotes(notes.filter((n) => n.id !== selected.id));
      setSelected(null);
    }
  };

  // ------------------------------------------------------------
  // ログアウト
  // ------------------------------------------------------------
  const navigate = useNavigate();
  const handleLogout = () => {
    localStorage.removeItem("token"); // トークン削除
    navigate("/login"); // ログインページへリダイレクト
  };

  // ------------------------------------------------------------
  // UI 表示
  // ------------------------------------------------------------
  return (
    <div className="h-screen flex text-gray-800">
      {/* 左カラム */}
      <div className="w-1/3 border-r border-gray-300 flex flex-col">
        <div className="p-3 border-b flex justify-between items-center">
          <h1 className="font-semibold text-lg">ノート一覧</h1>
          <button onClick={handleNew} className="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600">
            ＋新規
          </button>
          <button onClick={handleLogout} className="text-sm text-gray-600 hover:text-red-600 absolute top-2 right-2">
            ログアウト
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {notes.map((note) => (
            <div
              key={note.id}
              onClick={() => handleSelect(note)}
              className={`p-3 cursor-pointer border-b hover:bg-gray-100 ${selected?.id === note.id ? "bg-gray-200" : ""}`}
            >
              <div className="font-medium">{note.title}</div>
              <div className="text-sm text-gray-500">{note.updated_at?.slice(0, 10)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 右カラム */}
      <div className="flex-1 flex flex-col">
        {selected ? (
          <>
            <div className="p-3 border-b flex justify-between items-center">
              <h2 className="font-semibold text-lg">{selected.title}</h2>
              {!isEditing && (
                <button onClick={handleDelete} className="text-red-600 hover:text-red-800">
                  🗑️ 削除
                </button>
              )}
            </div>

            <div className="flex-1 p-4 overflow-y-auto">
              {!isEditing ? (
                <div className="prose max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{selected.content}</ReactMarkdown>
                </div>
              ) : (
                <textarea
                  className="w-full h-full border rounded p-2 focus:outline-none"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
              )}
            </div>

            <div className="p-3 border-t flex justify-end items-center space-x-3">
              {!isEditing ? (
                <button onClick={() => setIsEditing(true)} className="bg-gray-200 px-3 py-1 rounded hover:bg-gray-300">
                  ✏️ 編集
                </button>
              ) : (
                <button onClick={handleSave} className="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600">
                  💾 保存
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            ノートを選択してください
          </div>
        )}
      </div>
    </div>
  );
}

