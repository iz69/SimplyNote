import { useEffect, useState, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getNotes, createNote, updateNote, deleteNote, saveNoteWithAttachments } from "./api";

export default function App() {

  const BASE_PATH = import.meta.env.VITE_BASE_PATH || "";
  console.log("🧭 App.tsx BASE_PATH =", BASE_PATH);

  const [notes, setNotes] = useState<Note[]>([]);
  const [selected, setSelected] = useState<Note | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const [draftFiles, setDraftFiles] = useState([]);       // 新しく追加するファイル
  const [attachments, setAttachments] = useState([]);     // サーバ上の既存添付ファイル

  const handleSelect = (note: Note) => {
    setSelected(note);
    setIsEditing(false);
    setDraft(note.content);
    setAttachments(note.files || []);
    setDraftFiles([]);
  };

  // --------------------

  // 入力保存タイマー
  const saveTimer = useRef<NodeJS.Timeout | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setDraft(value);

    // 入力のたびにタイマーをリセット
    if (saveTimer.current) clearTimeout(saveTimer.current);

    // 1秒後に自動保存
    saveTimer.current = setTimeout(async () => {
      if (!token) return;
      try {
        if (selected) {
          const updated = await updateNote(token, selected.id, { title: selected.title, content: value });
          setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
          setSelected(updated);
        } else if (value.trim() !== "") {
          const title = value.split("\n")[0].slice(0, 30) || "新しいノート";
          const created = await createNote(token, { title, content: value });
          setNotes((prev) => [created, ...prev]);
          setSelected(created);
        }
      } catch (err) {
        console.error("Auto save failed:", err);
      }
    }, 1000);
  };

  // --------------------

  const token = localStorage.getItem("token");

  // 一覧取得
  const fetchNotes = async () => {
    try {
      const data = await getNotes(token!);
      setNotes(data);
      if (data.length > 0) {
         const first = data[0];
         setSelected(first);
         setDraft(first.content);
         setAttachments(first.files || []);

      }
    } catch (err: any) {
      if (err.message === "unauthorized") {
        localStorage.removeItem("token");
        window.location.href = `${BASE_PATH}/login`;
      } else {
        console.error(err);
      }
    }
  };
 
  // 新規作成（空ノートを開く）
  const handleNew = () => {
    setSelected(null);
    setDraft("");
    setIsEditing(true);
  };
 
  // 保存（新規 or 更新を自動判定）
  const handleSave = async () => {

    try {

      const refreshed = await saveNoteWithAttachments(
        token!,
        selected,
        draft,
        draftFiles
      );
  
      // 楽観更新
      setNotes((prev) =>
        prev.map((n) => (n.id === refreshed.id ? refreshed : n))
      );

      setSelected(refreshed);
      setAttachments(refreshed.files || []);
      setDraftFiles([]);
      setIsEditing(false);
    } catch (err: any) {
      if (err.message === "unauthorized") {
        localStorage.removeItem("token");
        window.location.href = `${BASE_PATH}/login`;
      } else {
        console.error(err);
        alert("保存に失敗しました。");
      }
    }
  };
  
  // 削除
  const handleDelete = async () => {
    if (!selected) return;
    if (!confirm("このノートを削除しますか？")) return;
    try {
      await deleteNote(token!, selected.id);
      setNotes((prev) => prev.filter((n) => n.id !== selected.id));
      setSelected(null);
      setDraft("");
      setIsEditing(false);
    } catch (err: any) {
      if (err.message === "unauthorized") {
        localStorage.removeItem("token");
        window.location.href = `${BASE_PATH}/login`;
      } else {
        console.error(err);
        alert("削除に失敗しました。");
      }
    }
  };

  // ログアウト
  const handleLogout = () => {
    localStorage.removeItem("token"); // トークン削除
    window.location.href = `${BASE_PATH}/login`;
  };

  // ------------------------------------------------------------
  // 初回処理
  // ------------------------------------------------------------
  useEffect(() => {
    fetchNotes();
  }, []);


  // ------------------------------------------------------------
  // UI 表示
  // ------------------------------------------------------------
  return (
    <div className="h-screen flex text-gray-800">

      {/* 左カラム */}
      <div className="w-1/3 border-r border-gray-300 flex flex-col">
        <div className="p-3 border-b flex justify-between items-center">
          <h1 className="font-semibold text-lg">ノート一覧</h1>
          <button onClick={handleNew} className="bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600">
            ＋ 新規
          </button>
          <button onClick={handleLogout} className="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600">
            ログアウト
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {notes.map((note) => (
            <div key={note.id} onClick={() => handleSelect(note)} className={`p-3 cursor-pointer border-b hover:bg-gray-100 ${selected?.id === note.id ? "bg-gray-200" : ""}`} >
              <div className="font-medium">{note.title}</div>
              <div className="text-sm text-gray-500">{note.updated_at?.slice(0, 10)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 右カラム */}
      <div className="flex-1 flex flex-col">

        {/* ヘッダー */}
        <div className="p-3 border-b flex justify-between items-center">
          <h2 className="font-semibold text-lg">
            {selected ? selected.title : "新しいノート"}
          </h2>
          {!isEditing && selected && (
            <button onClick={handleDelete} className="text-red-600 hover:text-red-800">
              🗑️ 削除
            </button>
          )}
        </div>

        {/* 本文 */}
        <div className="flex-1 p-4 overflow-y-auto">
          {!isEditing ? (
            <div className="prose max-w-none whitespace-pre-wrap">
              <ReactMarkdown remarkPlugins={[[remarkGfm, { breaks: true }]]}>
                {(selected ? selected.content : "").replace(/\r\n/g, "\n")}
              </ReactMarkdown>
            </div>
          ) : (
            <textarea
              className="w-full h-full border rounded p-2 focus:outline-none"
              value={draft}
              onChange={handleChange}
              placeholder="ここにノートを書き始めましょう..."
            />
          )}
        </div>


        {/* 添付ファイル（本文の下・フッターの上） */}
        <div className="px-4 py-3 border-t bg-gray-50">
          <div className="font-semibold text-sm mb-1">添付ファイル</div>

          {!isEditing ? (
            attachments?.length > 0 ? (
              <ul className="list-disc list-inside text-sm">
                {attachments.map((f) => (
                  <li key={f.id}>
                    <a href={f.url} target="_blank" className="text-blue-600 underline">
                      {f.filename}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-sm text-gray-400">添付なし</div>
            )
          ) : (
            <div>
              <input
                type="file"
                multiple
                onChange={(e) => setDraftFiles(Array.from(e.target.files))}
                className="text-sm"
              />
              {draftFiles.length > 0 && (
                <ul className="list-disc list-inside text-sm mt-2">
                  {draftFiles.map((f) => (
                    <li key={f.name}>{f.name}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>



        {/* フッター */}
        <div className="p-3 border-t flex justify-end items-center space-x-3">
          {!isEditing ? (
            <button
              onClick={() => setIsEditing(true)}
              className="bg-gray-200 px-3 py-1 rounded hover:bg-gray-300"
            >
              ✏️ 編集
            </button>
          ) : (
            <button
              onClick={handleSave}
              className="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600"
            >
              💾 保存
            </button>
          )}
        </div>

      </div>
    </div>
 );
}

