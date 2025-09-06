'use client';
import { useState, useRef } from 'react';

// 壓縮圖片：最長邊 720、品質 0.7（省流量省成本）
async function compressImageToDataURL(file, maxSize = 720, quality = 0.7) {
  const img = document.createElement('img');
  const reader = new FileReader();
  const fileLoaded = new Promise((resolve) => {
    reader.onload = () => {
      img.onload = resolve;
      img.src = reader.result;
    };
  });
  reader.readAsDataURL(file);
  await fileLoaded;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const { width, height } = img;
  const scale = Math.min(1, maxSize / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

export default function HomeClient() {
  // 文字對話
  const [species, setSpecies] = useState('cat');
  const [userText, setUserText] = useState('');
  const [reply, setReply] = useState('');
  const [fun, setFun] = useState('');
  const [loading, setLoading] = useState(false);

  // 圖片分析（單一隱藏 input）
  const [imgReply, setImgReply] = useState('');
  const [imgLoading, setImgLoading] = useState(false);
  const [preview, setPreview] = useState('');
  const fileRef = useRef(null);

  // 文字：呼叫 /api/chat
  async function handleTextSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setReply('');
    setFun('');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          species,
          intentSlug: null,
          userText,
          lang: 'zh',
        }),
      });
      const data = await res.json();
      if (data.error) {
        setReply(`❌ 錯誤：${data.error}`);
      } else {
        setReply(data.reply || '（沒有回覆）');
        setFun(data.fun || '');
      }
    } catch (err) {
      console.error(err);
      setReply('⚠️ 發生錯誤，請稍候再試');
    } finally {
      setLoading(false);
    }
  }

  // 圖片：呼叫 /api/analyze
  async function handleImageAnalyze() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      alert('請先選擇一張照片');
      return;
    }
    setImgLoading(true);
    setImgReply('');

    try {
      // 先壓縮再上傳
      const dataURL = await compressImageToDataURL(file, 720, 0.7);
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          species,
          userText,   // 可當補充說明
          imageData: dataURL,
          lang: 'zh',
        }),
      });
      const data = await res.json();
      if (data.error) {
        setImgReply(`❌ 錯誤：${data.error}${data.details ? '｜' + data.details : ''}`);
      } else {
        setImgReply(data.reply || '（沒有回覆）');
      }
    } catch (e) {
      console.error(e);
      setImgReply('⚠️ 發生錯誤，請稍候再試');
    } finally {
      setImgLoading(false);
    }
  }

  // 檔案選擇後→產生預覽
  function onFileChange(e) {
    const f = e.target.files?.[0];
    if (!f) {
      setPreview('');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPreview(String(reader.result));
    reader.readAsDataURL(f);
  }

  return (
    <main style={{ maxWidth: 720, margin: '40px auto', fontFamily: 'sans-serif', padding: '0 16px' }}>
      <h1>🐾 寵物＆植物溝通 MVP</h1>

      {/* 物種選單 */}
      <label style={{ display: 'block', margin: '12px 0' }}>
        選擇物種：
        <select
          value={species}
          onChange={(e) => setSpecies(e.target.value)}
          style={{ marginLeft: 10, padding: 6 }}
        >
          <option value='cat'>🐱 貓咪</option>
          <option value='dog'>🐶 狗狗</option>
          <option value='plant'>🌱 植物</option>
        </select>
      </label>

      {/* 共用的文字欄位（也提供圖片分析補充說明） */}
      <textarea
        rows={3}
        style={{ width: '100%', padding: 10 }}
        placeholder='輸入你的問題（或圖片的補充說明）...'
        value={userText}
        onChange={(e) => setUserText(e.target.value)}
      />

      {/* 文字諮詢 */}
      <section style={{ marginTop: 12, padding: 12, border: '1px solid #eee', borderRadius: 8 }}>
        <h3>💬 文字諮詢</h3>
        <button
          onClick={handleTextSubmit}
          disabled={loading}
          style={{ marginTop: 8, padding: '8px 16px' }}
        >
          {loading ? '處理中...' : '送出文字問題'}
        </button>

        {reply && (
          <div style={{ marginTop: 12, whiteSpace: 'pre-line' }}>
            <strong>AI 回覆：</strong>
            <p>{reply}</p>
            {fun && (
              <div style={{ marginTop: 8, fontStyle: 'italic', color: 'green' }}>
                🌟 趣味一句話：{fun}
              </div>
            )}
          </div>
        )}
      </section>

      {/* 圖片分析（單一「選擇檔案」按鈕 → 系統原生選單） */}
      <section style={{ marginTop: 20, padding: 12, border: '1px solid #eee', borderRadius: 8 }}>
        <h3>📸 圖片分析</h3>

        {/* 一顆按鈕：選擇檔案（會叫出原生選單：拍照/相簿/檔案） */}
        <button
          type='button'
          onClick={() => fileRef.current?.click()}
          style={{ marginTop: 8, padding: '8px 16px' }}
        >
          選擇檔案
        </button>

        {/* 隱藏 input：不帶 capture，交給系統選單決定拍照或相簿 */}
        <input
          ref={fileRef}
          type='file'
          accept='image/*'
          onChange={onFileChange}
          style={{ display: 'none' }}
        />

        {/* 預覽 */}
        {preview && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: '#666' }}>預覽：</div>
            <img
              src={preview}
              alt='preview'
              style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid #ddd' }}
            />
          </div>
        )}

        {/* 分析按鈕 */}
        <button
          onClick={handleImageAnalyze}
          disabled={imgLoading}
          style={{ marginTop: 12, padding: '8px 16px' }}
        >
          {imgLoading ? '分析中...' : '分析圖片'}
        </button>

        {imgReply && (
          <div style={{ marginTop: 12, whiteSpace: 'pre-line' }}>
            <strong>AI 圖片回覆：</strong>
            <p>{imgReply}</p>
          </div>
        )}
      </section>
    </main>
  );
}
