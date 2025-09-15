'use client';
import { useState, useRef } from 'react';
import AudioConsult from './AudioConsult';

// 前端壓縮，省費用
async function compressImageToDataURL(file, maxSize = 720, quality = 0.7) {
  const img = document.createElement('img');
  const reader = new FileReader();
  const fileLoaded = new Promise((resolve) => {
    reader.onload = () => { img.onload = resolve; img.src = reader.result; };
  });
  reader.readAsDataURL(file);
  await fileLoaded;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const { width, height } = img;
  const scale = Math.min(1, maxSize / Math.max(width, height));
  const w = Math.round(width * scale), h = Math.round(height * scale);
  canvas.width = w; canvas.height = h;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

export default function HomeClient2() {
  const [species, setSpecies] = useState('cat');
  const [userText, setUserText] = useState('');
  const [reply, setReply] = useState('');
  const [fun, setFun] = useState('');
  const [loading, setLoading] = useState(false);

  // 圖片
  const [preview, setPreview] = useState('');
  const fileRef = useRef(null);
  const [humanPreview, setHumanPreview] = useState('');
  const humanRef = useRef(null);

  // 結果（第三人稱）
  const [plantResult, setPlantResult] = useState(null);
  const [petResult, setPetResult] = useState(null);

  // 生成圖
  const [theaterUrl, setTheaterUrl] = useState('');
  const [imgLoading, setImgLoading] = useState(false);

  // 語音（可選）
  const [audioAdvice, setAudioAdvice] = useState('');

  // 文字諮詢（不動）
  async function handleTextSubmit(e) {
    e.preventDefault();
    setLoading(true); setReply(''); setFun('');
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ species, intentSlug: null, userText, lang: 'zh' }),
      });
      const data = await res.json();
      if (data.error) setReply(`❌ 錯誤：${data.error}`);
      else { setReply(data.reply || '（沒有回覆）'); setFun(data.fun || ''); }
    } catch {
      setReply('⚠️ 發生錯誤，請稍候再試');
    } finally {
      setLoading(false);
    }
  }

  // 選檔
  function onFileChange(e) {
    const f = e.target.files?.[0];
    if (!f) return setPreview('');
    const reader = new FileReader();
    reader.onload = () => setPreview(String(reader.result));
    reader.readAsDataURL(f);
  }
  function onHumanChange(e) {
    const f = e.target.files?.[0];
    if (!f) return setHumanPreview('');
    const reader = new FileReader();
    reader.onload = () => setHumanPreview(String(reader.result));
    reader.readAsDataURL(f);
  }

  // 小人國生成（方法 B）：只讓寵物/植物說話
  async function makeTheater({ sceneData, humanData, bubbleText }) {
    setTheaterUrl('');
    try {
      const res = await fetch('/api/theater', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sceneData,
          humanData: humanData || null,
          bubbleText: bubbleText || '今天心情超好！',
          species,
          lang: 'zh',
        }),
      });
      const data = await res.json();
      if (data?.image) setTheaterUrl(data.image);
    } catch (e) {
      console.error(e);
    }
  }

  // 照片諮詢 → 完成後自動生成小人國圖
  async function handlePhotoConsult() {
    const file = fileRef.current?.files?.[0];
    if (!file) return alert('請先選擇諮詢照片');

    setImgLoading(true);
    setPlantResult(null); setPetResult(null); setTheaterUrl('');

    try {
      const dataURL = await compressImageToDataURL(file, 720, 0.7);

      if (species === 'plant') {
        const res = await fetch('/api/plant/identify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageData: dataURL, userText })
        });
        const result = await res.json();
        if (result.error) {
          setPlantResult({ error: result.error, details: result.details });
        } else {
          setPlantResult(result);
          // 泡泡（第一人稱）
          const bubble =
            (result.fun_one_liner && String(result.fun_one_liner)) ||
            '我想要剛剛好的陽光和一點水分 🌱';
          await makeTheater({
            sceneData: preview || dataURL,
            humanData: humanPreview || null,
            bubbleText: bubble,
          });
        }
      } else {
        const res = await fetch('/api/analyze', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ species, userText, imageData: dataURL, lang: 'zh' })
        });
        const result = await res.json();
        if (result.error) {
          alert(`❌ 錯誤：${result.error}${result.details ? '｜' + result.details : ''}`);
        } else {
          setPetResult(result);
          const bubble =
            (result.fun_one_liner && String(result.fun_one_liner)) ||
            '我今天就想這樣耍廢～';
          await makeTheater({
            sceneData: preview || dataURL,
            humanData: humanPreview || null,
            bubbleText: bubble,
          });
        }
      }
    } catch (e) {
      console.error(e);
      alert('⚠️ 發生錯誤，請稍候再試');
    } finally {
      setImgLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: '40px auto', fontFamily: 'sans-serif', padding: '0 16px' }}>
      <h1>寵物溝通 app</h1>

      {/* 物種 */}
      <section style={{ marginTop: 12 }}>
        <h3 style={{ margin: '8px 0' }}>選擇物種：</h3>
        <select value={species} onChange={(e) => setSpecies(e.target.value)} style={{ padding: 8 }}>
          <option value='cat'>🐱 貓咪</option>
          <option value='dog'>🐶 狗狗</option>
          <option value='plant'>🌱 植物</option>
        </select>
      </section>

      {/* 文字諮詢 */}
      <section style={{ marginTop: 20, padding: 16, border: '1px solid #eee', borderRadius: 10 }}>
        <h3 style={{ marginTop: 0 }}>文字諮詢：</h3>
        <textarea rows={3} style={{ width: '100%', padding: 10 }}
          placeholder='輸入你的問題…'
          value={userText} onChange={(e) => setUserText(e.target.value)} />
        <div style={{ marginTop: 10 }}>
          <button onClick={handleTextSubmit} disabled={loading} style={{ padding: '10px 16px' }}>
            {loading ? '處理中…' : '送出問題'}
          </button>
        </div>
        {reply && (
          <div style={{ marginTop: 12, whiteSpace: 'pre-line' }}>
            <strong>AI 回覆：</strong>
            <p>{reply}</p>
            {fun && <div style={{ marginTop: 6, fontStyle: 'italic', color: 'green' }}>🌟 趣味一句話：{fun}</div>}
          </div>
        )}
      </section>

      {/* 圖片諮詢 */}
      <section style={{ marginTop: 20, padding: 16, border: '1px solid #eee', borderRadius: 10 }}>
        <h3 style={{ marginTop: 0 }}>圖片諮詢：</h3>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}>
          <div style={{ flex: '1 1 0%' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type='button' onClick={() => fileRef.current?.click()} style={{ padding: '10px 16px' }}>
                選擇諮詢照片
              </button>
              <input ref={fileRef} type='file' accept='image/*' onChange={onFileChange} style={{ display: 'none' }} />

              <button type='button' onClick={() => humanRef.current?.click()} style={{ padding: '10px 16px' }}>
                選擇本人照片（可選）
              </button>
              <input ref={humanRef} type='file' accept='image/*' onChange={onHumanChange} style={{ display: 'none' }} />
            </div>

            <p style={{ marginTop: 8, fontSize: 13, color: '#666' }}>
              若上傳自己照片，系統會生成「小人國」互動畫面（**只有寵物/植物會說話**，人沒有台詞）。
            </p>

            {preview && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, color: '#666' }}>諮詢照片預覽：</div>
                <img src={preview} alt='preview' style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid #ddd' }} />
              </div>
            )}
            {humanPreview && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, color: '#666' }}>本人照片預覽：</div>
                <img src={humanPreview} alt='human' style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid #ddd' }} />
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <button onClick={handlePhotoConsult} disabled={imgLoading} style={{ padding: '10px 16px' }}>
                {imgLoading ? '處理中…' : '送出照片諮詢'}
              </button>
            </div>

            {/* 文字結果（第三人稱） */}
            {petResult && (
              <div style={{ marginTop: 16 }}>
                <strong>🐾 目前狀態</strong>
                <p style={{ whiteSpace: 'pre-line' }}>{petResult.state}</p>
                {Array.isArray(petResult.issues) && petResult.issues.length > 0 && (
                  <>
                    <strong>可能問題</strong>
                    <ul>{petResult.issues.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </>
                )}
                {Array.isArray(petResult.suggestions) && petResult.suggestions.length > 0 && (
                  <>
                    <strong>建議步驟</strong>
                    <ol>{petResult.suggestions.map((s, i) => <li key={i}>{s}</li>)}</ol>
                  </>
                )}
              </div>
            )}

            {plantResult && !plantResult.error && (
              <div style={{ marginTop: 16 }}>
                <strong>🌿 植物辨識</strong>
                <ul>
                  <li>名稱：{plantResult.common_name || '未知'}（{plantResult.scientific_name || '-'}）</li>
                  <li>信心：{typeof plantResult.confidence === 'number' ? (plantResult.confidence*100).toFixed(0) + '%' : '-'}</li>
                </ul>
                <strong>目前狀態</strong>
                <p style={{ whiteSpace: 'pre-line' }}>{plantResult.state}</p>
                {Array.isArray(plantResult.likely_issues) && plantResult.likely_issues.length > 0 && (
                  <>
                    <strong>可能問題</strong>
                    <ul>{plantResult.likely_issues.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </>
                )}
                {Array.isArray(plantResult.care_steps) && plantResult.care_steps.length > 0 && (
                  <>
                    <strong>照護步驟</strong>
                    <ol>{plantResult.care_steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
                  </>
                )}
              </div>
            )}

            {/* 小人國合成結果 */}
            {theaterUrl && (
              <div style={{ marginTop: 16 }}>
                <strong>🎭 內心小劇場</strong>
                <img src={theaterUrl} alt="theater" style={{ width: '100%', borderRadius: 8, border: '1px solid #ddd', marginTop: 8 }} />
                <div style={{ marginTop: 8 }}>
                  <a href={theaterUrl} download='theater.png' style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6 }}>
                    下載圖片
                  </a>
                </div>
              </div>
            )}
          </div>

          {/* 右：示意圖 */}
          <div style={{ width: 220 }}>
            <img
              src="/samples/realistic_bubble_human.jpeg"
              alt="示意圖"
              style={{ width: '100%', borderRadius: 8, border: '1px solid #ccc' }}
            />
            <p style={{ fontSize: 12, textAlign: 'center', color: '#666', marginTop: 6 }}>
              小人國示意圖
            </p>
          </div>
        </div>
      </section>

      {/* 聲音諮詢（僅輔助，不影響泡泡來源） */}
      <section style={{ marginTop: 20, padding: 16, border: '1px solid #eee', borderRadius: 10 }}>
        <h3 style={{ marginTop: 0 }}>聲音諮詢：</h3>
        <AudioConsult species={species} onAdvice={setAudioAdvice} onSpeciesChange={setSpecies} />
        {audioAdvice && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#2563eb' }}>
            ✅ 已擷取語音分析摘要（圖片泡泡仍以第一人稱 fun_one_liner 為準）
          </div>
        )}
      </section>

      <p style={{ marginTop: 40, fontSize: 12, color: '#777', textAlign: 'center' }}>
        ⚠️ 本服務內容僅供參考，非醫療診斷或專業治療建議。若寵物或植物狀況嚴重，請即刻尋求獸醫或專業園藝師協助。
      </p>
    </main>
  );
}
