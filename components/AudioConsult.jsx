'use client';

import { useState, useRef, useEffect } from 'react';

const MAX_SECONDS = 20;

export default function AudioConsult({ species }) {
  const [recording, setRecording] = useState(false);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  // 計時
  const [elapsedMs, setElapsedMs] = useState(0);
  const tickTimerRef = useRef(null);
  const startTimeRef = useRef(0);

  // MediaRecorder
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  // 在錄音期間跑倒數
  useEffect(() => {
    if (recording) {
      startTimeRef.current = Date.now();
      setElapsedMs(0);
      tickTimerRef.current = setInterval(() => {
        const ms = Date.now() - startTimeRef.current;
        setElapsedMs(ms);
        if (ms >= MAX_SECONDS * 1000) {
          // 時間到自動停止
          stopRecording();
        }
      }, 100);
      return () => clearInterval(tickTimerRef.current);
    } else {
      // 停止時清理計時器
      clearInterval(tickTimerRef.current);
      tickTimerRef.current = null;
      setElapsedMs(0);
    }
  }, [recording]);

  const secondsLeft = Math.max(0, MAX_SECONDS - Math.floor(elapsedMs / 1000));
  const progress = Math.min(1, elapsedMs / (MAX_SECONDS * 1000)); // 0~1

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      chunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        // 關麥克風
        try { mr.stream.getTracks().forEach(t => t.stop()); } catch {}
        // 組成 blob → dataURL → 丟後端
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const audioDataURL = await blobToDataURL(blob);
        await sendToServer(audioDataURL);
      };

      mr.start();
      setRecording(true);
      setResult(null);
    } catch (err) {
      alert('無法啟用麥克風：' + (err?.message || String(err)));
    }
  }

  function stopRecording() {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== 'inactive') {
      try { mr.stop(); } catch {}
    }
    setRecording(false);
  }

  async function sendToServer(audioDataURL) {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ species, audioDataURL }),
      });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setResult({ error: '發生錯誤：' + (err?.message || String(err)) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ marginTop: 10 }}>
      {/* 提示 + 倒數 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <p style={{ fontSize: 13, color: '#555', margin: 0 }}>
          🎤 最長 {MAX_SECONDS} 秒，請靠近寵物錄音並保持安靜環境。
        </p>
        {recording && (
          <span
            aria-live="polite"
            style={{
              fontSize: 13, padding: '2px 8px', borderRadius: 999,
              background: '#fee2e2', color: '#991b1b'
            }}
          >
            錄音中… 剩餘 {secondsLeft} 秒
          </span>
        )}
      </div>

      {/* 進度條 */}
      <div style={{ marginTop: 8, height: 8, background: '#eee', borderRadius: 6, overflow: 'hidden' }}>
        <div style={{ width: `${progress * 100}%`, height: '100%', background: recording ? '#22c55e' : '#ddd' }} />
      </div>

      {/* 控制按鈕 */}
      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        {!recording ? (
          <button onClick={startRecording} disabled={loading} style={{ padding: '10px 16px' }}>
            🎤 開始錄音
          </button>
        ) : (
          <button onClick={stopRecording} style={{ padding: '10px 16px', backgroundColor: '#fee2e2' }}>
            ⏹ 停止錄音
          </button>
        )}
      </div>

      {loading && <p style={{ marginTop: 8 }}>⏳ 分析中，請稍候…</p>}

      {result?.advice && (
        <div style={{ marginTop: 12, whiteSpace: 'pre-line' }}>
          <strong>AI 分析：</strong>
          <p>{result.advice}</p>
          {result.hasTranscript && (
            <p style={{ fontSize: 12, color: '#555' }}>（偵測到人聲文字：{result.transcript}）</p>
          )}
        </div>
      )}

      {result?.error && (
        <p style={{ marginTop: 8, color: 'red' }}>⚠️ {result.error}</p>
      )}
    </div>
  );
}

/** Blob → dataURL */
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
