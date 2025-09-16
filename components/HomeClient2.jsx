'use client';

import { useState, useRef } from 'react';
import AudioConsult from './AudioConsult';

// 壓縮成 dataURL（省費用）
async function compressImageToDataURL(file, maxSize = 720, quality = 0.7) {
  const img = document.createElement('img');
  const reader = new FileReader();
  const loaded = new Promise((resolve) => {
    reader.onload = () => { img.onload = resolve; img.src = String(reader.result); };
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
  const [debugPrompt, setDebugPrompt] = useState('');
  const [audioAdvice, setAudioAdvice] = useState('');

  const [theaterError, setTheaterError] = useState('');

// 直接打 /api/theater（繞過 analyze/identify）
async function quickTheaterTest() {
  setTheaterError('');
  const file = fileRef.current?.files?.[0];
  if (!file && !preview) { alert('請先選擇諮詢照片'); return; }

  try {
    const basePhoto = preview || await compressImageToDataURL(file, 720, 0.7);
    const payload = {
      subjectType: species === 'plant' ? 'plant' : 'pet',
      species: species === 'plant' ? 'plant' : species,
      subjectImageUrl: basePhoto,
      humanImageUrl: humanPreview || '',
      stylePreset: 'cute-cartoon',
      dialogue: { subject: '今天我心情很好～', human: '' },
      sceneContext: { mood: 'warm', environmentHint: '', showBubbles: true },
      composition: { humanScale: 1/6, humanPosition: 'bottom-left', enforceRules: true }
    };
    const res = await fetch('/api/theater', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    console.log('[theater debug]', json);
    if (!json.ok) throw new Error(json.error || 'Theater API 失敗');
    setTheaterUrl(json.imageUrl);
    setDebugPrompt(json.prompt || '');
  } catch (e) {
    console.error(e);
    setTheaterError(String(e?.message || e));
    alert(`❌ Theater 直連測試失敗：${e?.message || e}`);
  }
}

  
  // 文字諮詢
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

  // 串 Theater API（後端會強制：人不說話、左下角、主角高度 1/6）
  async function callTheaterAPI({ basePhoto, bubble, subjectType, speciesName, humanPhoto }) {
    const payload = {
      subjectType,
      species: speciesName || (subjectType === 'plant' ? 'plant' : 'pet'),
      subjectImageUrl: basePhoto,       // 可用 dataURL
      humanImageUrl: humanPhoto || undefined,
      stylePreset: 'cute-cartoon',
      dialogue: { subject: bubble || '', human: '' },
      sceneContext: { mood: 'warm', environmentHint: '', showBubbles: true },
      composition: { humanScale: 1/6, humanPosition: 'bottom-left', enforceRules: true },
    };

    const res = await fetch('/api/theater', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok || !json?.ok) throw new Error(json?.error || 'Theater API 失敗');
    return { imageUrl: json.imageUrl, prompt: json.prompt };
  }

  // 照片諮詢 → 成功後直接用 Theater API 產圖
  async function handlePhotoConsult() {
    const file = fileRef.current?.files?.[0];
    if (!file) { alert('請先選擇諮詢照片'); return; }

    setImgLoading(true);
    setPetResult(null); setPlantResult(null); setTheaterUrl(''); setDebugPrompt('');

    try {
      const dataURL = await compressImageToDataURL(file, 720, 0.7);
      const basePhoto = preview || dataURL;

      if (species === 'plant') {
        const res = await fetch('/api/plant/identify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageData: dataURL, userText, lang: 'zh' })
        });
        const raw = await res.json();
        if (raw.error) throw new Error(raw.error + (raw.details ? `｜${raw.details}` : ''));
        const result = raw.result || raw;
        setPlantResult(result);

        const bubble = result.fun_one_liner || '本葉喜歡剛剛好的陽光和一口水～';
        const speciesName = result.common_name || result.scientific_name || 'plant';

        const { imageUrl, prompt } = await callTheaterAPI({
          basePhoto,
          bubble,
          subjectType: 'plant',
          speciesName,
          humanPhoto: humanPreview || undefined,
        });
        setTheaterUrl(imageUrl);
        setDebugPrompt(prompt);
      } else {
        const res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ species, userText, imageData: dataURL, lang: 'zh' })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error + (data.details ? `｜${data.details}` : ''));
        setPetResult(data);

        const bubble =
          data.fun_one_liner ||
          (species === 'cat' ? '本喵今天只想躺著被摸～'
           : species === 'dog' ? '本汪準備出門散步啦！'
           : '我今天心情不錯～');

        const { imageUrl, prompt } = await callTheaterAPI({
          basePhoto,
          bubble,
          subjectType: 'pet',
          speciesName: species, // 'cat' | 'dog'
          humanPhoto: humanPreview || undefined,
        });
        setTheaterUrl(imageUrl);
        setDebugPrompt(prompt);
      }
    } catch (e) {
      console.error(e);
      alert(`❌ 圖片諮詢或劇場生成失敗：${e?.message || e}`);
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

      <section style={{ marginTop: 20, padding: 16, border: '1px solid #eee', borderRadius: 10 }}>
        <h3 style={{ marginTop: 0 }}>文字諮詢：</h3>
        <form onSubmit={handleTextSubmit}>
          <textarea
            rows={3}
            style={{ width: '100%', padding: 10 }}
            placeholder='輸入你的問題…'
            value={userText}
            onChange={(e) => setUserText(e.target.value)}
          />
          <div style={{ marginTop: 10 }}>
            <button type="submit" disabled={loading} style={{ padding: '10px 16px' }}>
              {loading ? '處理中…' : '送出問題'}
            </button>
          </div>
        </form>
        {reply && (
          <div style={{ marginTop: 12, whiteSpace: 'pre-line' }}>
            <strong>AI 回覆：</strong>
            <p>{reply}</p>
            {fun && <div style={{ marginTop: 6, fontStyle: 'italic', color: 'green' }}>🌟 趣味一句話：{fun}</div>}
          </div>
        )}
      </section>

      <section style={{ marginTop: 20, padding: 16, border: '1px solid #eee', borderRadius: 10 }}>
        <h3 style={{ marginTop: 0 }}>圖片諮詢（自動用 Theater API 產圖）：</h3>

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
              上傳自己照片可打造你與寵物/植物的互動照。後端會<strong>強制</strong>：人不說話、左下角、主角高度的 1/6。
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
  <button type="button" onClick={quickTheaterTest} style={{ padding: '10px 16px' }}>
    直接生成劇場（測試）
  </button>
</div>

{theaterError && (
  <div style={{ marginTop: 8, color: '#b91c1c', fontSize: 13 }}>
    Theater 錯誤：{theaterError}
  </div>
)}


            {/* 寵物結果 */}
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

            {/* 植物結果 */}
            {plantResult && !plantResult.error && (
              <div style={{ marginTop: 16 }}>
                <strong>🌿 植物辨識</strong>
                <ul>
                  <li>名稱：{plantResult.common_name || '未知'}（{plantResult.scientific_name || '-' }）</li>
                  <li>信心：{typeof plantResult.confidence === 'number' ? (plantResult.confidence * 100).toFixed(0) + '%' : '-'}</li>
                </ul>
                {plantResult.state && <>
                  <strong>目前狀態</strong>
                  <p style={{ whiteSpace: 'pre-line' }}>{plantResult.state}</p>
                </>}
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

            {/* 內心小劇場（API 回傳） */}
            {theaterUrl && (
              <div style={{ marginTop: 16 }}>
                <strong>🎭 內心小劇場</strong>
                <img src={theaterUrl} alt="內心劇場" style={{ width: '100%', borderRadius: 8, border: '1px solid #ddd', marginTop: 8 }} />
                <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <a href={theaterUrl} download='theater.png' style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6 }}>
                    下載圖片
                  </a>
                  {!!debugPrompt && (
                    <details style={{ fontSize: 12 }}>
                      <summary>Debug Prompt</summary>
                      <pre style={{ whiteSpace: 'pre-wrap' }}>{debugPrompt}</pre>
                    </details>
                  )}
                </div>
              </div>
            )}
          </div>

          <div style={{ width: 220 }}>
            <img
              src="/samples/realistic_bubble_human.jpeg"
              alt="示意圖"
              style={{ width: '100%', borderRadius: 8, border: '1px solid #ccc' }}
            />
            <p style={{ fontSize: 12, textAlign: 'center', color: '#666', marginTop: 6 }}>
              小人國示意圖（API 強制：人不說話、左下角、1/6）
            </p>
          </div>
        </div>
      </section>

      <section style={{ marginTop: 20, padding: 16, border: '1px solid #eee', borderRadius: 10 }}>
        <h3 style={{ marginTop: 0 }}>聲音諮詢：</h3>
        <AudioConsult species={species} onAdvice={setAudioAdvice} onSpeciesChange={(s) => setSpecies(s)} />
        {audioAdvice && <div style={{ marginTop: 8, fontSize: 12, color: '#2563eb' }}>✅ 已擷取語音分析摘要</div>}
      </section>

      <p style={{ marginTop: 40, fontSize: 12, color: '#777', textAlign: 'center' }}>
        ⚠️ 本服務內容僅供參考，非醫療診斷或專業治療建議。若寵物或植物狀況嚴重，請即刻尋求獸醫或專業園藝師協助。
      </p>
    </main>
  );
}
