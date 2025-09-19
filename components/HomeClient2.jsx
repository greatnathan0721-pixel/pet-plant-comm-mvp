'use client';
import { useState, useRef } from 'react';
import AudioConsult from './AudioConsult';

// 壓縮成 dataURL（省費用，避免超大 dataURL 導致 400）
async function compressImageToDataURL(file, maxSize = 720, quality = 0.7) {
  const img = document.createElement('img');
  const reader = new FileReader();
  const loaded = new Promise((resolve) => {
    reader.onload = () => { img.onload = resolve; img.src = reader.result; };
  });
  reader.readAsDataURL(file);
  await loaded;

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

  const [preview, setPreview] = useState('');
  const fileRef = useRef(null);
  const [humanPreview, setHumanPreview] = useState('');
  const humanRef = useRef(null);

  const [petResult, setPetResult] = useState(null);
  const [plantResult, setPlantResult] = useState(null);
  const [imgLoading, setImgLoading] = useState(false);

  const [theaterUrl, setTheaterUrl] = useState('');
  const [theaterError, setTheaterError] = useState('');
  const [audioAdvice, setAudioAdvice] = useState('');

  // 文字諮詢（保留）
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
    } finally { setLoading(false); }
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

  // 照片諮詢 → 成功後自動產圖
  async function handlePhotoConsult() {
    const file = fileRef.current?.files?.[0];
    if (!file) return alert('請先選擇諮詢照片');

    setImgLoading(true);
    setPetResult(null); setPlantResult(null);
    setTheaterUrl(''); setTheaterError('');

    try {
      const dataURL = await compressImageToDataURL(file, 720, 0.7);

      if (species === 'plant') {
        const res = await fetch('/api/plant/identify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageData: dataURL, userText, lang: 'zh' })
        });
        const raw = await res.json();
        if (!res.ok || raw.error) throw new Error((raw && (raw.error || raw.details)) || '植物辨識失敗');
        const result = raw.result || raw;
        setPlantResult(result);
      } else {
        const res = await fetch('/api/analyze2', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ species, userText, imageData: dataURL, lang: 'zh' })
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error((data && (data.error || data.details)) || '寵物分析失敗');
        setPetResult(data);
      }

      // 串接 theater 寫實生圖（後端自動選詞，禁止亂加人、保留背景）
      const tRes = await fetch('/api/theater2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectType: species === 'plant' ? 'plant' : 'pet',
          species,
          dialogue: { subject: '' }, // 讓後端自動套台詞
          sceneContext: { showBubbles: true },
          subjectImageData: dataURL,
          humanImageData: humanPreview || undefined,
        })
      });
      const tJson = await tRes.json();
      if (!tRes.ok || !tJson.ok) throw new Error(`${tJson.error || '劇場生成失敗'}${tJson.details ? `｜${tJson.details}` : ''}`);
      setTheaterUrl(tJson.imageUrl);

    } catch (e) {
      console.error(e);
      setTheaterError(String(e.message || e));
    } finally {
      setImgLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: '40px auto', fontFamily: 'sans-serif', padding: '0 16px' }}>
      <h1>寵物溝通 app</h1>

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
          placeholder='輸入你的問題…' value={userText}
          onChange={(e) => setUserText(e.target.value)} />
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

            {/* 結果顯示：寵物 */}
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

            {/* 結果顯示：植物 */}
            {plantResult && !plantResult.error && (
              <div style={{ marginTop: 16 }}>
                <strong>🌿 植物辨識</strong>
                <ul>
                  <li>名稱：{plantResult.common_name || '未知'}（{plantResult.scientific_name || '-'}）</li>
                  <li>信心：{typeof plantResult.confidence === 'number' ? (plantResult.confidence * 100).toFixed(0) + '%' : '-'}</li>
                </ul>

                {plantResult.state && (
                  <>
                    <strong>目前狀態</strong>
                    <p style={{ whiteSpace: 'pre-line' }}>{plantResult.state}</p>
                  </>
                )}

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

            {/* 內心小劇場（寫實） */}
            {theaterUrl && (
              <div style={{ marginTop: 16 }}>
                <strong>🎭 內心小劇場</strong>
                <img src={theaterUrl} alt="內心劇場" style={{ width: '100%', borderRadius: 8, border: '1px solid #ddd', marginTop: 8 }} />
                <div style={{ marginTop: 8 }}>
                  <a href={theaterUrl} download='theater.png' style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6 }}>
                    下載圖片
                  </a>
                </div>
              </div>
            )}

            {theaterError && (
              <div style={{ marginTop: 12, color: 'red', fontSize: 13 }}>
                ❌ 劇場生成失敗：{theaterError}
              </div>
            )}
          </div>

          <div style={{ width: 220 }}>
            <img src="/samples/realistic_bubble_human.jpeg" alt="示意圖"
              style={{ width: '100%', borderRadius: 8, border: '1px solid #ccc' }} />
            <p style={{ fontSize: 12, textAlign: 'center', color: '#666', marginTop: 6 }}>
              小人國示意圖
            </p>
          </div>
        </div>
      </section>

      {/* 聲音諮詢 */}
      <section style={{ marginTop: 20, padding: 16, border: '1px solid #eee', borderRadius: 10 }}>
        <h3 style={{ marginTop: 0 }}>聲音諮詢：</h3>
        <AudioConsult species={species} onAdvice={setAudioAdvice} onSpeciesChange={setSpecies} />
        {audioAdvice && <div style={{ marginTop: 8, fontSize: 12, color: '#2563eb' }}>✅ 已擷取語音分析摘要</div>}
      </section>

      <p style={{ marginTop: 40, fontSize: 12, color: '#777', textAlign: 'center' }}>
        ⚠️ 本服務內容僅供參考，非醫療診斷或專業治療建議。若寵物或植物狀況嚴重，請即刻尋求獸醫或專業園藝師協助。
      </p>
    </main>
  );
}
