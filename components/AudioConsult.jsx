"use client";
import { useRef, useState } from "react";

export default function AudioConsult({ species = "cat" }) {
  const [recording, setRecording] = useState(false);
  const [mediaRec, setMediaRec] = useState(null);
  const [chunks, setChunks] = useState([]);
  const [audioURL, setAudioURL] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const fileRef = useRef(null);

  // 錄音開始
  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      const _chunks = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) _chunks.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(_chunks, { type: "audio/webm" });
        setChunks(_chunks);
        setAudioURL(URL.createObjectURL(blob));
      };
      mr.start();
      setMediaRec(mr);
      setRecording(true);
    } catch (e) {
      alert("無法開啟麥克風：" + e.message);
    }
  }

  // 錄音停止
  function stopRec() {
    mediaRec?.stop();
    mediaRec?.stream?.getTracks()?.forEach(t => t.stop());
    setRecording(false);
  }

  // 檔案上傳（改用使用者選擇的音檔）
  function onFileChange(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    setAudioURL(url);
    setChunks([f]); // 後面會讀成 dataURL
  }

  // 送去後端：轉文字 + 分析
  async function submitAudio() {
    if (!audioURL || chunks.length === 0) return alert("請先錄音或選擇音檔");

    setLoading(true); setResult(null);
    try {
      const blob = new Blob(chunks, { type: "audio/webm" });
      const dataURL = await blobToDataURL(blob);

      const res = await fetch("/api/audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ species, audioDataURL: dataURL, lang: "zh" }),
      });
      const data = await res.json();
      setResult(data);
    } catch (e) {
      setResult({ error: "上傳或分析失敗", details: String(e) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section style={{ marginTop: 20, padding: 16, border: "1px solid #eee", borderRadius: 10 }}>
      <h3 style={{ marginTop: 0 }}>語音諮詢（Beta）：</h3>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {!recording ? (
          <button onClick={startRec} style={{ padding: "10px 16px" }}>🎙️ 開始錄音</button>
        ) : (
          <button onClick={stopRec} style={{ padding: "10px 16px" }}>⏹ 停止錄音</button>
        )}

        <button type="button" onClick={() => fileRef.current?.click()} style={{ padding: "10px 16px" }}>
          或選擇音檔（.m4a/.mp3/.webm…）
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          onChange={onFileChange}
          style={{ display: "none" }}
        />

        <button onClick={submitAudio} disabled={loading || !audioURL} style={{ padding: "10px 16px" }}>
          {loading ? "處理中…" : "送出語音諮詢"}
        </button>
      </div>

      {audioURL && (
        <div style={{ marginTop: 10 }}>
          <audio src={audioURL} controls />
        </div>
      )}

      {result && (
        <div style={{ marginTop: 12 }}>
          {result.error ? (
            <div style={{ color: "#b91c1c" }}>
              ❌ {result.error}{result.details ? `｜${result.details}` : ""}
            </div>
          ) : (
            <>
              <div><strong>轉文字：</strong>{result.transcript || "（空白）"}</div>
              <div style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>
                <strong>分析建議：</strong>
                {"\n"}{result.advice || "（無）"}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

// 小工具：Blob → dataURL
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
