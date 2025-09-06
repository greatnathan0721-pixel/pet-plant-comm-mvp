"use client";
import { useState } from "react";

export default function Home() {
  const [userText, setUserText] = useState("");
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setReply("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          species: "cat",        // 預設測試用，可以改成 "dog" 或 "plant"
          intentSlug: null,      // 讓後端自動判斷
          userText: userText,
          lang: "zh",
        }),
      });

      const data = await res.json();
      if (data.error) {
        setReply(`❌ 錯誤：${data.error}`);
      } else {
        setReply(data.reply || "（沒有回覆）");
      }
    } catch (err) {
      setReply("⚠️ 發生錯誤，請檢查控制台");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: "600px", margin: "50px auto", fontFamily: "sans-serif" }}>
      <h1>🐾 寵物＆植物溝通 MVP</h1>
      <form onSubmit={handleSubmit}>
        <textarea
          rows={3}
          style={{ width: "100%", padding: "10px" }}
          placeholder="輸入你的問題..."
          value={userText}
          onChange={(e) => setUserText(e.target.value)}
        />
        <button
          type="submit"
          disabled={loading}
          style={{ marginTop: "10px", padding: "10px 20px" }}
        >
          {loading ? "處理中..." : "送出"}
        </button>
      </form>

      {reply && (
        <div style={{ marginTop: "20px", whiteSpace: "pre-line" }}>
          <h3>AI 回覆：</h3>
          <p>{reply}</p>
        </div>
      )}
    </main>
  );
}
