'use client';
import { useState, useRef } from 'react';

export default function AudioConsult({ species, onAdvice }) {
  const [recording, setRecording] = useState(false);
  const [result, setResult] = useState(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream);
    mediaRecorderRef.current = mr;
    chunksRef.current = [];
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      sendToServer(blob);
    };
    mr.start();
    setRecording(true);
    onAdvice?.(null); // 清掉舊建議
    setTimeout(() => stopRecording(), 20000); // 最多20秒
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }

  async function sendToServer(blob) {
    const form = new FormData();
    form.append('file', blob, 'voice.webm');
    form.append('species', species);
    const res = await fetch('/api/audio-analyze', { method: 'POST', body: form });
    const data = await res.json();
    setResult(data);
    if (data?.advice) onAdvice?.(data.advice); // 把建議往上丟
  }

  async function onFileChange(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setResult(null);
    onAdvice?.(null);
    sendToServer(f);
  }

  return (
    <div style={{ marginTop: 12 }}>
      <button onClick={recording ? stopRecording : startRecording} style={{ padding: '8px 14px' }}>
        {recording ? '⏹ 停止錄音' : '🎙 開始錄音 (20秒)'}
      </button>
      <input type="file" accept="audio/*" onChange={onFileChange} style={{ display: 'block', marginTop: 8 }} />
      {result && (
        <div style={{ marginTop: 10, fontSize: 14, whiteSpace: 'pre-line' }}>
          <strong>語音分析：</strong>
          {result.advice || '（沒有結果）'}
        </div>
      )}
    </div>
  );
}
