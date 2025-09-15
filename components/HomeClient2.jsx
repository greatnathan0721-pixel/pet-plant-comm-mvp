'use client';
import { useState, useRef } from 'react';
import AudioConsult from './AudioConsult';

// 壓縮成 dataURL（省費用）
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

// 生成內心劇場（第一人稱、無右上角字）
async function generateTheaterImage({ basePhoto, petThought, humanPhoto }) {
  const W = 1080, H = 1350;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = W; canvas.height = H;

  // 背景 + 主圖
  ctx.fillStyle = '#0c1116';
  ctx.fillRect(0, 0, W, H);

  const img = await loadImg(basePhoto);
  const fit = coverRect(img.width, img.height, W, H);
  ctx.drawImage(img, fit.sx, fit.sy, fit.sw, fit.sh, 0, 0, W, H);

  // 外框
  ctx.strokeStyle = '#ffffff20';
  ctx.lineWidth = 24;
  ctx.strokeRect(12, 12, W - 24, H - 24);

  // 右下泡泡（寵物/植物第一人稱）
  drawSpeechBubble(ctx, { x: W - 60, y: H - 280, text: petThought, align: 'right' });

  // 左下人像圓頭像（無台詞）
  if (humanPhoto) {
    const h = await loadImg(humanPhoto);
    const R = 140, cx = 140, cy = H - 160;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
    const hf = coverRect(h.width, h.height, R * 2, R * 2);
    ctx.drawImage(h, hf.sx, hf.sy, hf.sw, hf.sh, cx - R, cy - R, R * 2, R * 2);
    ctx.restore();
    ctx.strokeStyle = '#ffffffcc'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  }

  return canvas.toDataURL('image/png');

  // helpers
  function coverRect(sw, sh, dw, dh) {
    const sRatio = sw / sh, dRatio = dw / dh;
    let sx, sy, sw2, sh2;
    if (sRatio > dRatio) { sh2 = sh; sw2 = sh * dRatio; sx = (sw - sw2) / 2; sy = 0; }
    else { sw2 = sw; sh2 = sw / dRatio; sx = 0; sy = (sh - sh2) / 2; }
    return { sx, sy, sw: sw2, sh: sh2 };
  }
  function loadImg(src) {
    return new Promise((resolve, reject) => {
      const i = new Image();
      i.crossOrigin = 'anonymous'; // 防止 canvas 汙染
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = src;
    });
  }
  function drawSpeechBubble(context, { x, y, text, align = 'right' }) {
    const t = String(text || '').trim() || '我今天心情超放鬆～';
    const maxWidth = 540;
    context.font = '500 40px system-ui, -apple-system, Segoe UI, Roboto';
    const lines = wrapText(context, t, maxWidth);
    const lh = 52, padding = 24;
    const w = Math.min(maxWidth, Math.max(...lines.map(l => context.measureText(l).width))) + padding * 2;
    const h = lines.length * lh + padding * 2;
    const bx = align === 'right' ? x - w : x;
    const by = y - h;

    // 主泡泡
    context.fillStyle = 'rgba(255,255,255,0.92)';
    context.strokeStyle = '#111'; context.lineWidth = 3;
    roundRect(context, bx, by, w, h, 18); context.fill(); context.stroke();

    // 尾巴
    context.beginPath();
    if (align === 'right') {
      context.moveTo(x, y);
      context.lineTo(bx + w - 40, by + h);
      context.lineTo(bx + w - 5, by + h - 40);
    } else {
      context.moveTo(x, y);
      context.lineTo(bx + 40, by + h);
      context.lineTo(bx + 5, by + h - 40);
    }
    context.closePath(); context.fill(); context.stroke();

    // 文字
    context.fillStyle = '#111';
    lines.forEach((l, i) => context.fillText(l, bx + padding, by + padding + (i + 0.9) * lh - 12));

    function wrapText(c, t, maxW) {
      const words = (t || '').split(/\s|(?=[，。！？、～!?.])/);
      const out = []; let line = '';
      for (const w of words) {
        const test = line ? line + (/\w$/.test(line) ? ' ' : '') + w : w;
        if (c.measureText(test).width > maxW) { if (line) out.push(line); line = w; }
        else line = test;
      }
      if (line) out.push(line);
      return out;
    }
    function roundRect(c, x0, y0, w0, h0, r) {
      c.beginPath();
      c.moveTo(x0 + r, y0);
      c.arcTo(x0 + w0, y0, x0 + w0, y0 + h0, r);
      c.arcTo(x0 + w0, y0 + h0, x0, y0 + h0, r);
      c.arcTo(x0, y0 + h0, x0, y0, r);
      c.arcTo(x0, y0, x0 + w0, y0, r);
      c.closePath();
    }
  }
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
    setPetResult(null); setPlantResult(null); setTheaterUrl('');

    try {
      const dataURL = await compressImageToDataURL(file, 720, 0.7);
      const basePhoto = preview || dataURL; // 沒有預覽時用壓縮後 dataURL

      if (species === 'plant') {
        const res = await fetch('/api/plant/identify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageData: dataURL, userText, lang: 'zh' })
        });
        const raw = await res.json();
        if (raw.error) throw new Error(raw.error + (raw.details ? `｜${raw.details}` : ''));
        const result = raw.result || raw; // 兼容舊巢狀
        setPlantResult(result);

        const bubble =
          result.fun_one_liner ||
          '本葉喜歡剛剛好的陽光和一口水～';

        try {
          const url = await generateTheaterImage({
            basePhoto,
            petThought: bubble,
            humanPhoto: humanPreview || undefined,
          });
          setTheaterUrl(url);
        } catch (e) {
          console.error('generateTheaterImage plant failed:', e);
        }
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
          (species === 'cat' ? '本喵今天只想躺著被摸～' :
           species === 'dog' ? '本汪準備出門散步啦！' : '我今天心情不錯～');

        try {
          const url = await generateTheaterImage({
            basePhoto,
            petThought: bubble,
            humanPhoto: humanPreview || undefined,
          });
          setTheaterUrl(url);
        } catch (e) {
          console.error('generateTheaterImage pet failed:', e);
        }
      }
    } catch (e) {
      console.error(e);
      alert(`❌ 圖片諮詢失敗：${e.message || e}`);
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
              若上傳自己照片，也可打造專屬你與寵物/植物的互動照片（人像僅在本地合成，不會上傳）。
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

            {/* 動物結果（第三人稱） */}
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

            {/* 植物結果（第三人稱） */}
            {plantResult && !plantResult.error && (
              <div style={{ marginTop: 16 }}>
                <strong>🌿 植物辨識</strong>
                <ul>
                  <li>名稱：{plantResult.common_name || '未知'}（{plantResult.scientific_name || '-'}）</li>
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

            {/* 內心小劇場（自動顯示） */}
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
