'use client';

import { useState, useRef, useEffect } from 'react';

const MAX_SECONDS = 20;
const MAX_UPLOAD_MB = 5;
const VIDEO_EXT = ['.mp4', '.mov', '.mkv', '.avi', '.wmv', '.m4v', '.webm']; // 保險擋影片

/**
 * Props:
 * - species: 'cat' | 'dog' | 'plant'
 * - onAdvice?: (text: string|null) => void
 * - onSpeciesChange?: (next: 'cat'|'dog'|'plant') => void
 */
export default function AudioConsult({ species, onAdvice, onSpeciesChange }) {
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

  // ===== 倒數控制 =====
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

  // ===== 錄音 =====
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
        await handleUpload(blob); // 自動上傳分析
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

  // ===== 上傳現成音檔（擋影片＋長度檢查） =====
  async function onFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (recording) stopRecording();

    // 大小限制
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      alert(`音檔過大，請小於 ${MAX_UPLOAD_MB} MB`);
      e.target.value = '';
      return;
    }

    // 類型/副檔名檢查：擋影片
    const nameLower = (file.name || '').toLowerCase();
    const isVideoExt = VIDEO_EXT.some(ext => nameLower.endsWith(ext));
    const isAudioMime = (file.type || '').startsWith('audio/');
    const isVideoMime = (file.type || '').startsWith('video/');

    if (isVideoMime || isVideoExt || (!isAudioMime && looksLikeVideoByName(nameLower))) {
      alert('請上傳音檔（mp3, m4a, wav, webm），影片檔不支援');
      e.target.value = '';
      return;
    }

    try {
      setResult(null);
      onAdvice?.(null);

      // 先用 <audio> 讀取長度，超過 20 秒就擋下
      const objectURL = URL.createObjectURL(file);
      const ok = await ensureDurationWithin(objectURL, MAX_SECONDS);
      if (!ok) {
        alert(`音檔超過 ${MAX_SECONDS} 秒，請重新上傳較短的片段`);
        URL.revokeObjectURL(objectURL);
        e.target.value = '';
        return;
      }
      setAudioURL(objectURL); // 預覽

      await handleUpload(file);
    } catch (err) {
      setResult({ error: '讀取檔案失敗：' + (err?.message || String(err)) });
    } finally {
      // 清掉 input 的值，方便重選同一檔案
      e.target.value = '';
    }
  }

  // ===== 共用上傳（含偵測不一致→詢問是否切換→重送） =====
  async function handleUpload(fileOrBlob) {
    setLoading(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('file', fileOrBlob, 'voice.webm');
      formData.append('species', species); // 使用者目前的選擇
      formData.append('lang', 'zh');

      let data = await fetch('/api/audio', { method: 'POST', body: formData }).then(r => r.json());

      // 檢查是否與使用者選擇不一致（且信心夠高）
      const detected = data?.detected_species;
      const conf = typeof data?.confidence === 'number' ? data.confidence : 0;
      const mismatch = detected && detected !== 'unknown' && detected !== species && conf >= 0.7;

      if (mismatch) {
        const zh = detected === 'cat' ? '貓' : detected === 'dog' ? '狗' : '植物';
        const ok = confirm(`語音聽起來像：${zh}（信心 ${(conf * 100).toFixed(0)}%）。要切換成「${zh}」並重新分析嗎？`);
        if (ok) {
          onSpeciesChange?.(detected); // 通知父層切換 UI
          const retry = new FormData();
          retry.append('file', fileOrBlob, 'voice.webm');
          retry.append('species', detected);
          retry.append('lang', 'zh');
          data = await fetch('/api/audio', { method: 'POST', body: retry }).then(r => r.json());
        }
      }

      // 顯示結果，並把 reply 傳回父層（提供內心劇場用）
      setResult(data);
      if (data?.reply) onAdvice?.(data.reply);
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
            style={{ fontSize: 13, padding: '2px 8px', borderRadius: 999, background: '#fee2e2', color: '#991b1b' }}
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
      {result?.reply && (
        <div style={{ marginTop: 12, whiteSpace: 'pre-line' }}>
          <strong>AI 分析：</strong>
          <p>{result.reply}</p>
          {result.fun && <p style={{ fontStyle: 'italic', color: '#15803d' }}>🌟 趣味一句話：{result.fun}</p>}
          {typeof result.confidence === 'number' && result.detected_species && result.detected_species !== 'unknown' && (
            <p style={{ fontSize: 12, color: '#555' }}>
              （模型判定：{result.detected_species}，信心 {Math.round(result.confidence * 100)}%）
            </p>
          )}
        </div>
      )}

      {result?.error && (
        <p style={{ marginTop: 8, color: 'red' }}>⚠️ {result.error}</p>
      )}
    </div>
  );
}

/** 依檔名猜是不是影片（當 type 空白時的保險） */
function looksLikeVideoByName(nameLower) {
  return ['.mp4', '.mov', '.mkv', '.avi', '.wmv', '.m4v'].some(ext => nameLower.endsWith(ext));
}

/** 讀取 <audio> 的 duration，檢查是否在上限內（含 Safari 保險） */
function ensureDurationWithin(objectURL, maxSec) {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      if (Number.isNaN(audio.duration)) {
        console.warn('無法讀取音檔長度，放行但建議壓在 20 秒以內');
        resolve(true);
      } else {
        resolve(audio.duration <= maxSec + 0.3); // 容許一點浮動
      }
      URL.revokeObjectURL(objectURL);
    };
    audio.onerror = () => {
      console.warn('讀取音檔長度失敗，放行但建議壓在 20 秒以內');
      URL.revokeObjectURL(objectURL);
      resolve(true);
    };
    audio.src = objectURL;
  });
}
