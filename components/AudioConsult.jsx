'use client';

import { useState, useRef, useEffect } from 'react';

const MAX_SECONDS = 20;
const MAX_UPLOAD_MB = 5;

export default function AudioConsult({ species, onAdvice }) {
  const [recording, setRecording] = useState(false);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const [audioURL, setAudioURL] = useState('');

  // 倒數 & 進度
  const [elapsedMs, setElapsedMs] = useState(0);
  const tickTimerRef = useRef(null);
  const startTimeRef = useRef(0);

  // MediaRecorder
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  // 上傳 input
  const fileRef = useRef(null);

  // 倒數控制
  useEffect(() => {
    if (recording) {
      startTimeRef.current = Date.now();
      setElapsedMs(0);
      tickTimerRef.current = setInterval(() => {
        const ms = Date.now() - startTimeRef.current;
        setElapsedMs(ms);
        if (ms >= MAX_SECONDS * 1000) stopRecording();
      }, 100);
      return () => clearInterval(tickTimerRef.current);
    } else {
      clearInterval(tickTimerRef.current);
      tickTimerRef.current = null;
      setElapsedMs(0);
    }
  }, [recording]);

  const secondsLeft = Math.max(0, MAX_SECONDS - Math.floor(elapsedMs / 1000));
  const progress = Math.min(1, elapsedMs / (MAX_SECONDS * 1000));

  async function startRecording() {
    try {
      if (loading) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      chunksRef.current = [];
      setResult(null);
      onAdvice?.(null);
      setAudioURL('');

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        try { mr.stream.getTracks().forEach(t => t.stop()); } catch {}
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setAudioURL(URL.createObjectURL(blob));
        const dataURL = await blobToDataURL(blob);
        await sendToServer(dataURL);
      };

      mr.start();
      setRecording(true);
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

  // 上傳現成音檔
  async function onFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (recording) stopRecording();

    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      alert(`音檔過大，請小於 ${MAX_UPLOAD_MB} MB`);
      e.target.value = '';
      return;
    }

    try {
      setResult(null);
      onAdvice?.(null);
      setAudioURL(URL.createObjectURL(file));
      const dataURL = await fileToDataURL(file);
      await sendToServer(dataURL);
    } catch (err) {
      setResult({ error: '讀取檔案失敗：' + (err?.message || String(err)) });
    } finally {
      e.target.value = '';
    }
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
      if (data?.advice) onAdvice?.(data.advice);
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
          🎤 最長 {MAX_SECONDS} 秒，請靠近寵物錄音並保持安靜環境。或上傳音檔（mp3 / m4a / webm / wav）。
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

      {/* 進度條（只在錄音時動態） */}
      <div style={{ marginTop: 8, height: 8, background: '#eee', borderRadius: 6, overflow: 'hidden' }}>
        <div style={{ width: `${progress * 100}%`, height: '100%', background: recording ? '#22c55e' : '#ddd' }} />
      </div>

      {/* 控制 + 上傳 */}
      <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
        {!recording ? (
          <button onClick={startRecording} disabled={loading} style={{ padding: '10px 16px' }}>
            🎤 開始錄音
          </button>
        ) : (
          <button onClick={stopRecording} style={{ padding: '10px 16px', backgroundColor: '#fee2e2' }}>
            ⏹ 停止錄音
          </button>
        )}

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          style={{ padding: '10px 16px' }}
        >
          ⬆️ 上傳音檔
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,.m4a,.mp3,.wav,.webm"
          onChange={onFileChange}
          style={{ display: 'none' }}
        />
      </div>

      {/* 音檔預覽 */}
      {audioURL && (
        <div style={{ marginTop: 10 }}>
          <audio src={audioURL} controls />
        </div>
      )}

      {loading && <p style={{ marginTop: 8 }}>⏳ 分析中，請稍候…</p>}

      {/* 結果顯示 */}
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

/** File → dataURL */
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
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
