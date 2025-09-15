// components/HomeClient2.jsx
'use client';
import { useState, useRef } from 'react';
import AudioConsult from './AudioConsult';

// ---------- 前端壓縮（省費用） ----------
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

// ---------- 小工具：把台詞盡量轉第一人稱 ----------
function ensureFirstPerson(t = '') {
  let s = String(t).trim();
  if (!s) return '';
  // 簡單規則：若不是以「我/本喵/本狗/本葉」開頭，補個「我」或「我覺得」
  if (!/^我/.test(s) && !/^(本喵|本狗|本鳥|本葉|本盆栽)/.test(s)) {
    s = (s.length <= 20 ? `我${s}` : `我覺得，${s}`);
  }
  // 避免結尾沒標點
  if (!/[。.!！?？]$/.test(s)) s += '。';
  return s.slice(0, 90); // 防太長
}

// ---------- 內心劇場（Canvas 合成｜不存人像｜右上不顯字樣） ----------
async function generateTheaterImage({ basePhoto, style, petThought = '我今天也要好好表現！', humanPhoto }) {
  const W = 1080, H = 1350;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = W; canvas.height = H;

  // 背景
  ctx.fillStyle = '#0c1116'; ctx.fillRect(0, 0, W, H);

  const img = await loadImg(basePhoto);
  const fit = coverRect(img.width, img.height, W, H);
  ctx.drawImage(img, fit.sx, fit.sy, fit.sw, fit.sh, 0, 0, W, H);

  // 柔邊框
  ctx.strokeStyle = '#ffffff20'; ctx.lineWidth = 24; ctx.strokeRect(12, 12, W - 24, H - 24);

  // 人像（小人國）
  if (style === 'realistic_bubble_human' && humanPhoto) {
    const human = await loadImg(humanPhoto);
    const R = 140, cx = 140, cy = H - 160;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
    const hf = coverRect(human.width, human.height, R * 2, R * 2);
    ctx.drawImage(human, hf.sx, hf.sy, hf.sw, hf.sh, cx - R, cy - R, R * 2, R * 2);
    ctx.restore();
    ctx.strokeStyle = '#ffffffcc'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();

    drawSpeechBubble(ctx, { x: 280, y: H - 300, text: ensureFirstPerson('你在想什麼呢？'), align: 'left' });
  }

  // 寵物/植物泡泡
  drawSpeechBubble(ctx, { x: W - 60, y: H - 280, text: ensureFirstPerson(petThought), align: 'right' });

  // 不畫任何右上角標籤

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
    const lines = wrap(text, maxWidth, context);
    const lh = 52, pad = 24;
    const w = Math.min(maxWidth, Math.max(...lines.map(l => context.measureText(l).width))) + pad * 2;
    const h = lines.length * lh + pad * 2;
    const bx = align === 'right' ? x - w : x;
    const by = y - h;

    context.fillStyle = 'rgba(255,255,255,0.92)';
    context.strokeStyle = '#111'; context.lineWidth = 3;
    roundRect(context, bx, by, w, h, 18); context.fill(); context.stroke();

    context.beginPath();
    if (align === 'right') {
      context.moveTo(x, y); context.lineTo(bx + w - 40, by + h); context.lineTo(bx + w - 5, by + h - 40);
    } else {
      context.moveTo(x, y); context.lineTo(bx + 40, by + h); context.lineTo(bx + 5, by + h - 40);
    }
    context.closePath(); context.fill(); context.stroke();

    context.fillStyle = '#111';
    lines.forEach((l, i) => context.fillText(l, bx + pad, by + pad + (i + 0.9) * lh - 12));

    function wrap(t, maxW, c) {
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

export default function HomeClient2() {
  // 物種 & 文字
  const [species, setSpecies] = useState('cat');
  const [userText, setUserText] = useState('');
  const [reply, setReply] = useState('');
  const [fun, setFun] = useState('');
  const [loading, setLoading] = useState(false);

  // 圖片
  const [imgReply, setImgReply] = useState('');
  const [imgState, setImgState] = useState('');
  const [imgSeverity, setImgSeverity] = useState('');
  const [imgLoading, setImgLoading] = useState(false);
  const [preview, setPreview] = useState('');
  const fileRef = useRef(null);

  // 植物結果（保留現有欄位）
  const [plantResult, setPlantResult] = useState(null);
  const [plantLoading, setPlantLoading] = useState(false);

  // 本人照
  const [humanPreview, setHumanPreview] = useState('');
  const humanRef = useRef(null);

  // 內心劇場
  const [theaterUrl, setTheaterUrl] = useState('');

  // 語音 → 台詞來源
  const [audioAdvice, setAudioAdvice] = useState('');

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
    } finally {
      setLoading(false);
    }
  }

  // 檔案選擇
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

  // 自動生成內心劇場
  async function autoMakeTheater({ from = 'animal', data, preview, humanPreview, fun }) {
    try {
      if (!preview) return;
      const thought =
        (data?.creative && String(data.creative)) ||
        (data?.state && String(data.state)) ||
        (fun && String(fun)) ||
        (from === 'plant' && Array.isArray(data?.care_steps) && data.care_steps[0]) ||
        (typeof data?.reply === 'string' && data.reply.split(/[\n。]/).filter(Boolean)[0]) ||
        '我今天要做最可愛的自己！';

      const style = humanPreview ? 'realistic_bubble_human' : 'realistic_bubble';

      const url = await generateTheaterImage({
        basePhoto: preview,
        style,
        petThought: thought,
        humanPhoto: humanPreview || undefined,
      });
      setTheaterUrl(url);
    } catch (e) {
      console.error('autoMakeTheater failed:', e);
    }
  }

  // 照片諮詢（植物→辨識；動物→一般分析）
  async function handlePhotoConsult() {
    const file = fileRef.current?.files?.[0];
    if (!file) return alert('請先選擇諮詢照片');

    setImgLoading(true); setPlantLoading(true);
    setImgReply(''); setPlantResult(null); setTheaterUrl(''); setImgState(''); setImgSeverity('');

    try {
      const dataURL = await compressImageToDataURL(file, 720, 0.7);

      async function sendBy(speciesToUse) {
        if (speciesToUse === 'plant') {
          const res = await fetch('/api/plant/identify', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageData: dataURL, userText })
          });
          return res.json();
        } else {
          const res = await fetch('/api/analyze', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ species: speciesToUse, userText, imageData: dataURL, lang: 'zh' })
          });
          return res.json();
        }
      }

      let data = await sendBy(species);

      // 物種自動修正（若後端有偵測且明顯不一致）
      const detected = data?.detected_species;
      const conf = typeof data?.confidence === 'number' ? data.confidence : 0;
      const mismatch = detected && detected !== 'unknown' && detected !== species && conf >= 0.7;
      if (mismatch) {
        const zh = detected === 'cat' ? '貓' : detected === 'dog' ? '狗' : '植物';
        const ok = confirm(`看起來像是：${zh}（信心 ${(conf * 100).toFixed(0)}%）。要切換成「${zh}」並重新分析嗎？`);
        if (ok) { setSpecies(detected); data = await sendBy(detected); }
      }

      // 顯示 & 內心劇場
      if (species === 'plant' || (mismatch && detected === 'plant')) {
        if (data.error) {
          setPlantResult({ error: data.error, details: data.details });
        } else {
          const result = data.result || { reply: data.reply, fun_one_liner: data.fun, state: data.state, severity: data.severity };
          setPlantResult(result);
          setImgState(result.state || '');
          setImgSeverity(result.severity || '');
          await autoMakeTheater({ from: 'plant', data: result, preview, humanPreview, fun: result?.fun_one_liner });
        }
      } else {
        if (data.error) {
          setImgReply(`❌ 錯誤：${data.error}${data.details ? '｜' + data.details : ''}`);
        } else {
          setImgReply(data.reply || '（沒有回覆）');
          setImgState(data.state || '');
          setImgSeverity(data.severity || '');
          await autoMakeTheater({ from: 'animal', data, preview, humanPreview, fun: data.fun });
        }
      }
    } catch {
      if (species === 'plant') setPlantResult({ error: 'Internal error' });
      else setImgReply('⚠️ 發生錯誤，請稍候再試');
    } finally {
      setImgLoading(false); setPlantLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: '40px auto', fontFamily: 'sans-serif', padding: '0 16px' }}>
      <h1>寵物溝通 app</h1>

      {/* 物種選擇 */}
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
        <textarea rows={3} style={{ width: '100%', padding: 10 }} placeholder='輸入你的問題…'
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

      {/* 圖片諮詢（左：上傳／右：示意圖） */}
      <section style={{ marginTop: 20, padding: 16, border: '1px solid #eee', borderRadius: 10 }}>
        <h3 style={{ marginTop: 0 }}>圖片諮詢：</h3>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}>
          {/* 左：上傳與結果 */}
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
              <button onClick={handlePhotoConsult} disabled={imgLoading || plantLoading} style={{ padding: '10px 16px' }}>
                {(imgLoading || plantLoading) ? '處理中…' : '送出照片諮詢'}
              </button>
            </div>

            {/* 結果：狀態/嚴重度 + 建議 */}
            {(imgReply || imgState) && (
              <div style={{ marginTop: 12, whiteSpace: 'pre-line' }}>
                <strong>AI 圖片回覆：</strong>
                {imgState && (
                  <p style={{ margin: '6px 0', padding: '8px 10px', background:'#f8fafc', border:'1px solid #e5e7eb', borderRadius:8 }}>
                    <span style={{ fontWeight: 600 }}>目前狀態：</span>{imgState}
                    {imgSeverity && (
                      <span style={{ marginLeft: 8, fontSize: 12, color: '#64748b' }}>
                        （嚴重度：{imgSeverity === 'high' ? '高' : imgSeverity === 'medium' ? '中' : '低'}）
                      </span>
                    )}
                  </p>
                )}
                {imgReply && <p>{imgReply}</p>}
              </div>
            )}

            {/* 內心劇場：自動產生後直接顯示在此 */}
            {theaterUrl && (
              <div style={{ marginTop: 16 }}>
                <h4 style={{ margin: '6px 0' }}>🎭 內心劇場</h4>
                <img src={theaterUrl} alt="內心劇場" style={{ width: '100%', borderRadius: 8, border: '1px solid #ddd' }} />
                <div style={{ marginTop: 8 }}>
                  <a href={theaterUrl} download='theater.png' style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6 }}>
                    下載這張圖
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

      {/* 聲音諮詢（結果也會餵進內心劇場台詞） */}
      <section style={{ marginTop: 20, padding: 16, border: '1px solid #eee', borderRadius: 10 }}>
        <h3 style={{ marginTop: 0 }}>聲音諮詢：</h3>
        <AudioConsult species={species} onAdvice={setAudioAdvice} onSpeciesChange={setSpecies} />
        {audioAdvice && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#2563eb' }}>
            ✅ 已擷取語音分析結果，將用於內心劇場台詞。
          </div>
        )}
      </section>

      <p style={{ marginTop: 40, fontSize: 12, color: '#777', textAlign: 'center' }}>
        ⚠️ 本服務內容僅供參考，非醫療診斷或專業治療建議。若寵物或植物狀況嚴重，請即刻尋求獸醫或專業園藝師協助。
      </p>
    </main>
  );
}
