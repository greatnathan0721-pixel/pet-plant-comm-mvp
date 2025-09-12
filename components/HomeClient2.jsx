'use client';
import { useState, useRef, useMemo } from 'react';

// 前端壓縮（省費用）
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

// 內心劇場（前端 Canvas 合成，不存人像）
async function generateTheaterImage({ basePhoto, style, petThought = '今天也要好好長葉子！', humanPhoto }) {
  const W = 1080, H = 1350;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = W; canvas.height = H;

const theme = {
  realistic_bubble: { bg: '#0c1116', frame: '#ffffff20', tint: null },
  realistic_bubble_human: { bg: '#0c1116', frame: '#ffffff20', tint: null },
}[style] || { bg: '#0c1116', frame: '#ffffff20', tint: null };


  ctx.fillStyle = theme.bg; ctx.fillRect(0, 0, W, H);

  const img = await loadImg(basePhoto);
  const fit = coverRect(img.width, img.height, W, H);
  ctx.drawImage(img, fit.sx, fit.sy, fit.sw, fit.sh, 0, 0, W, H);

  if (theme.tint) { ctx.fillStyle = theme.tint; ctx.fillRect(0, 0, W, H); }

  ctx.strokeStyle = theme.frame; ctx.lineWidth = 24; ctx.strokeRect(12, 12, W - 24, H - 24);

  drawSpeechBubble(ctx, { x: W - 60, y: H - 280, text: petThought, align: 'right' });

  if (style === 'realistic_bubble_human' && humanPhoto) {
    const human = await loadImg(humanPhoto);
    const R = 140, cx = 140, cy = H - 160;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
    const hf = coverRect(human.width, human.height, R*2, R*2);
    ctx.drawImage(human, hf.sx, hf.sy, hf.sw, hf.sh, cx - R, cy - R, R * 2, R * 2);
    ctx.restore();
    ctx.strokeStyle = '#ffffffcc'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    drawSpeechBubble(ctx, { x: 280, y: H - 300, text: '你在想什麼呢？', align: 'left' });
  }

  ctx.fillStyle = '#ffffffdd'; ctx.font = '600 36px system-ui, -apple-system, Segoe UI, Roboto';
const label = style === 'realistic_bubble_human'
  ? '🗨️ 寫實＋泡泡＋小人'
  : '🗨️ 寫實＋泡泡';
  ctx.fillText(label, W - ctx.measureText(label).width - 28, 64);

  return canvas.toDataURL('image/png');

  function coverRect(sw, sh, dw, dh) {
    const sRatio = sw / sh, dRatio = dw / dh;
    let sx, sy, sw2, sh2;
    if (sRatio > dRatio) { sh2 = sh; sw2 = sh * dRatio; sx = (sw - sw2) / 2; sy = 0; }
    else { sw2 = sw; sh2 = sw / dRatio; sx = 0; sy = (sh - sh2) / 2; }
    return { sx, sy, sw: sw2, sh: sh2 };
  }
  function loadImg(dataURL) {
    return new Promise((resolve, reject) => {
      const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = dataURL;
    });
  }
  function drawSpeechBubble(context, { x, y, text, align = 'right' }) {
    const maxWidth = 540;
    context.font = '500 40px system-ui, -apple-system, Segoe UI, Roboto';
    const lines = wrapText(context, text, maxWidth);
    const lh = 52, padding = 24;
    const w = Math.min(maxWidth, Math.max(...lines.map(l => context.measureText(l).width))) + padding * 2;
    const h = lines.length * lh + padding * 2;
    const bx = align === 'right' ? x - w : x;
    const by = y - h;

    context.fillStyle = 'rgba(255,255,255,0.92)';
    context.strokeStyle = '#111'; context.lineWidth = 3;
    roundRect(context, bx, by, w, h, 18); context.fill(); context.stroke();

    context.beginPath();
    if (align === 'right') { context.moveTo(x, y); context.lineTo(bx + w - 40, by + h); context.lineTo(bx + w - 5, by + h - 40); }
    else { context.moveTo(x, y); context.lineTo(bx + 40, by + h); context.lineTo(bx + 5, by + h - 40); }
    context.closePath(); context.fill(); context.stroke();

    context.fillStyle = '#111';
    lines.forEach((l, i) => context.fillText(l, bx + padding, by + padding + (i + 0.9) * lh - 12));

    function wrapText(c, t, maxW) {
      const words = (t || '').split(/\s|(?=[，。！？、])/);
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
export default function HomeClient() {
  // 文字諮詢
  const [species, setSpecies] = useState('cat');
  const [userText, setUserText] = useState('');
  const [reply, setReply] = useState('');
  const [fun, setFun] = useState('');
  const [loading, setLoading] = useState(false);

  // 圖片分析
  const [imgReply, setImgReply] = useState('');
  const [imgLoading, setImgLoading] = useState(false);
  const [preview, setPreview] = useState('');
  const fileRef = useRef(null);

  // 植物辨識
  const [plantResult, setPlantResult] = useState(null);
  const [plantLoading, setPlantLoading] = useState(false);

  // 內心劇場
  const [style, setStyle] = useState('realistic_bubble');
  const [humanPreview, setHumanPreview] = useState('');
  const humanRef = useRef(null);
  const [theaterUrl, setTheaterUrl] = useState('');

  const canShowCreative = useMemo(() => !!(preview && (imgReply || plantResult)), [preview, imgReply, plantResult]);

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
    } catch { setReply('⚠️ 發生錯誤，請稍候再試'); }
    finally { setLoading(false); }
  }

  async function handleImageAnalyze() {
    const file = fileRef.current?.files?.[0]; if (!file) return alert('請先選擇一張照片');
    setImgLoading(true); setImgReply(''); setTheaterUrl('');
    try {
      const dataURL = await compressImageToDataURL(file, 720, 0.7);
      const res = await fetch('/api/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ species, userText, imageData: dataURL, lang: 'zh' }),
      });
      const data = await res.json();
      if (data.error) setImgReply(`❌ 錯誤：${data.error}${data.details ? '｜' + data.details : ''}`);
      else setImgReply(data.reply || '（沒有回覆）');
    } catch { setImgReply('⚠️ 發生錯誤，請稍候再試'); }
    finally { setImgLoading(false); }
  }

  async function handlePlantIdentify() {
    const file = fileRef.current?.files?.[0]; if (!file) return alert('請先選擇一張植物照片');
    setPlantLoading(true); setPlantResult(null); setTheaterUrl('');
    try {
      const dataURL = await compressImageToDataURL(file, 720, 0.7);
      const res = await fetch('/api/plant/identify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageData: dataURL, userText }),
      });
      const data = await res.json();
      if (data.error) setPlantResult({ error: data.error, details: data.details });
      else setPlantResult(data.result);
    } catch { setPlantResult({ error: 'Internal error' }); }
    finally { setPlantLoading(false); }
  }

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

  function handlePickFile() { fileRef.current?.click(); }

  async function handleGenerateTheater() {
    if (!preview) return alert('請先選擇主照片');
    if (style === 'realistic_bubble_human' && !humanPreview) {
      return alert('此風格需要你的照片（僅在本地合成，不會上傳）');
    }

  const petThought =
      plantResult?.fun_one_liner ||
      (plantResult?.care_steps?.[0] ? `今天的任務：${plantResult.care_steps[0]}` : '') ||
      (fun ? fun : '今天也要好好表現！');

    const url = await generateTheaterImage({
      basePhoto: preview,
      style,
      petThought,
      humanPhoto: humanPreview || undefined,
    });
    setTheaterUrl(url);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'theater.png';
    a.click();
  }

  return (
  <main style={{ maxWidth: 720, margin: '40px auto', fontFamily: 'sans-serif', padding: '0 16px' }}>
    <h1>寵物溝通 app</h1>

    {/* 選擇物種 */}
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
      <textarea
        rows={3}
        style={{ width: '100%', padding: 10 }}
        placeholder='輸入你的問題…'
        value={userText}
        onChange={(e) => setUserText(e.target.value)}
      />
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

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type='button' onClick={() => fileRef.current?.click()} style={{ padding: '10px 16px' }}>
          選擇諮詢照片
        </button>
        <input
          ref={fileRef}
          type='file'
          accept='image/*'
          onChange={onFileChange}
          style={{ display: 'none' }}
        />

        {/* 只有選用「寫實＋泡泡＋小人」時，才需要本人照片 */}
        <button
          type='button'
          onClick={() => humanRef.current?.click()}
          style={{ padding: '10px 16px' }}
          disabled={style !== 'realistic_bubble_human'}
          title={style !== 'realistic_bubble_human' ? '先選上方風格為「寫實＋泡泡＋小人」' : ''}
        >
          選擇本人照片
        </button>
        <input
          ref={humanRef}
          type='file'
          accept='image/*'
          onChange={onHumanChange}
          style={{ display: 'none' }}
        />
      </div>

      {/* 上傳提醒 */}
      <p style={{ marginTop: 8, fontSize: 13, color: '#666' }}>
        若上傳自己照片，也可打造專屬你與寵物的互動照片喔～（人像僅在本地合成，不會上傳）
      </p>

      {/* 預覽 */}
      {preview && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, color: '#666' }}>諮詢照片預覽：</div>
          <img src={preview} alt='preview' style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid #ddd' }} />
        </div>
      )}
      {humanPreview && style === 'realistic_bubble_human' && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, color: '#666' }}>本人照片預覽：</div>
          <img src={humanPreview} alt='human' style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid #ddd' }} />
        </div>
      )}

      {/* 二顆功能按鈕：分析/辨識、送出照片諮詢（生成劇場圖） */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <button onClick={handleImageAnalyze} disabled={imgLoading} style={{ padding: '10px 16px' }}>
          {imgLoading ? '分析中…' : '送出照片諮詢'}
        </button>
        <button onClick={handlePlantIdentify} disabled={plantLoading} style={{ padding: '10px 16px' }}>
          {plantLoading ? '辨識中…' : '🌿 植物辨識（加強）'}
        </button>
      </div>

      {/* AI 圖片回覆 & 植物辨識結果 */}
      {(imgReply || plantResult) && (
        <div style={{ marginTop: 12 }}>
          {imgReply && (
            <div style={{ whiteSpace: 'pre-line', marginBottom: 12 }}>
              <strong>AI 圖片回覆：</strong>
              <p>{imgReply}</p>
            </div>
          )}
          {plantResult && !plantResult.error && (
            <div style={{ marginBottom: 12 }}>
              <strong>🌿 植物辨識結果</strong>
              <ul style={{ marginTop: 8 }}>
                <li>名稱：{plantResult.common_name || '未知'}（{plantResult.scientific_name || '-'}）</li>
                <li>信心：{typeof plantResult.confidence === 'number' ? (plantResult.confidence*100).toFixed(0) + '%' : '-'}</li>
                {Array.isArray(plantResult.likely_issues) && plantResult.likely_issues.length > 0 && (
                  <li>可能問題：{plantResult.likely_issues.join('、')}</li>
                )}
                {Array.isArray(plantResult.care_steps) && plantResult.care_steps.length > 0 && (
                  <li style={{ whiteSpace: 'pre-line' }}>
                    照護步驟：{plantResult.care_steps.map(s => `\n• ${s}`).join('')}
                  </li>
                )}
                <li>嚴重度：{plantResult.severity || '-'}</li>
                {plantResult.fun_one_liner && <li>趣味：{plantResult.fun_one_liner}</li>}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* 兩種風格選擇（已移除侏羅紀） */}
      {(imgReply || plantResult) && preview && (
        <section style={{ marginTop: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[
              { key: 'realistic_bubble', label: '寫實＋泡泡', demo: '/samples/realistic_bubble.jpg' },
              { key: 'realistic_bubble_human', label: '寫實＋泡泡＋小人', demo: '/samples/realistic_bubble_human.jpg' },
            ].map(s => (
              <label key={s.key} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 8, cursor: 'pointer' }}>
                <input
                  type='radio'
                  name='style'
                  value={s.key}
                  checked={style === s.key}
                  onChange={() => setStyle(s.key)}
                />
                <span style={{ marginLeft: 8 }}>{s.label}</span>
                <div style={{ marginTop: 8, height: 140, overflow: 'hidden', borderRadius: 6, background: '#f3f4f6' }}>
                  <img src={s.demo} alt={s.label} style={{ width: '100%', objectFit: 'cover', height: '100%' }} />
                </div>
              </label>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button onClick={handleGenerateTheater} style={{ padding: '10px 16px' }}>
              生成內心劇場圖
            </button>
            {theaterUrl && (
              <a href={theaterUrl} download='theater.png' style={{ padding: '10px 16px', border: '1px solid #ddd', borderRadius: 6 }}>
                下載最新內心劇場圖
              </a>
            )}
          </div>
        </section>
      )}
    </section>

    <p style={{ marginTop: 40, fontSize: 12, color: '#777', textAlign: 'center' }}>
      ⚠️ 本服務提供之內容僅供參考，並非醫療診斷或專業治療建議。若您的寵物或植物狀況嚴重，請立即尋求獸醫或專業園藝師協助。
    </p>
  </main>
);
}
