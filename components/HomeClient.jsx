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

// 分享卡（不走 API）
function generateShareCard({ title = '寵物＆植物小幫手', subtitle = '我的分析結果', body = '', photoDataURL }) {
  const W = 1080, H = 1350;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = W; canvas.height = H;

  ctx.fillStyle = '#f6f8f9'; ctx.fillRect(0, 0, W, H);
  const pad = 60, cardX = pad, cardY = pad, cardW = W - pad*2, cardH = H - pad*2;
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#e6e8ea'; ctx.lineWidth = 4;
  ctx.fillRect(cardX, cardY, cardW, cardH); ctx.strokeRect(cardX, cardY, cardW, cardH);

  ctx.fillStyle = '#111'; ctx.font = 'bold 56px system-ui, -apple-system, Segoe UI, Roboto';
  ctx.fillText(title, cardX + 48, cardY + 88);
  ctx.fillStyle = '#1f7a39'; ctx.font = '600 36px system-ui, -apple-system, Segoe UI, Roboto';
  ctx.fillText(subtitle, cardX + 48, cardY + 148);

  let textTop = cardY + 220;
  if (photoDataURL) {
    const img = document.createElement('img'); img.src = photoDataURL;
    const ph = 520, pw = cardW - 96, px = cardX + 48, py = cardY + 180;
    ctx.fillStyle = '#ddd'; ctx.fillRect(px, py, pw, ph);
    try { ctx.drawImage(img, px, py, pw, ph); } catch {}
    textTop = py + ph + 40;
  }

  ctx.fillStyle = '#222'; ctx.font = '400 36px system-ui, -apple-system, Segoe UI, Roboto';
  const lines = wrapText(ctx, body, cardX + 48, cardX + cardW - 48);
  let y = textTop; const lh = 48;
  for (const line of lines.slice(0, 18)) { ctx.fillText(line, cardX + 48, y); y += lh; }

  ctx.fillStyle = '#6b7280'; ctx.font = '500 28px system-ui, -apple-system, Segoe UI, Roboto';
  ctx.fillText('Made with 寵物＆植物溝通 MVP', cardX + 48, cardY + cardH - 40);
  return canvas.toDataURL('image/png');

  function wrapText(c, text, left, right) {
    const maxWidth = right - left;
    const words = (text || '').split(/\s+/);
    const lines = []; let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (c.measureText(test).width > maxWidth) { if (line) lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }
}

// 內心劇場（前端 Canvas 合成，不存人像）
async function generateTheaterImage({ basePhoto, style, petThought = '今天也要好好長葉子！', humanPhoto }) {
  const W = 1080, H = 1350;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = W; canvas.height = H;

  // 主題設定
  const theme = {
    realistic_bubble: { bg: '#0c1116', frame: '#ffffff20', tint: null },
    realistic_bubble_human: { bg: '#0c1116', frame: '#ffffff20', tint: null },
    jurassic: { bg: '#071a0c', frame: '#2f6b36', tint: 'rgba(40,120,55,0.25)' },
  }[style] || { bg: '#0c1116', frame: '#ffffff20', tint: null };

  ctx.fillStyle = theme.bg; ctx.fillRect(0, 0, W, H);

  // 背景鋪滿
  const img = await loadImg(basePhoto);
  const fit = coverRect(img.width, img.height, W, H);
  ctx.drawImage(img, fit.sx, fit.sy, fit.sw, fit.sh, 0, 0, W, H);

  // 色調
  if (theme.tint) { ctx.fillStyle = theme.tint; ctx.fillRect(0, 0, W, H); }

  // 外框
  ctx.strokeStyle = theme.frame; ctx.lineWidth = 24; ctx.strokeRect(12, 12, W - 24, H - 24);

  // 寵物泡泡（右下）
  drawSpeechBubble(ctx, { x: W - 60, y: H - 280, text: petThought, align: 'right' });

  // 若為小人模式，貼入真人頭像 + 人類泡泡
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
  const label = style === 'jurassic' ? '🦖 侏羅紀風'
    : style === 'realistic_bubble_human' ? '🗨️ 寫實＋泡泡＋小人'
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
  const [species, setSpecies] = useState('cat');
  const [userText, setUserText] = useState('');
  const [reply, setReply] = useState('');
  const [fun, setFun] = useState('');
  const [loading, setLoading] = useState(false);

  const [imgReply, setImgReply] = useState('');
  const [imgLoading, setImgLoading] = useState(false);
  const [preview, setPreview] = useState('');
  const fileRef = useRef(null);

  const [plantResult, setPlantResult] = useState(null);
  const [plantLoading, setPlantLoading] = useState(false);

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

  function handleShareCard() {
    const body = plantResult
      ? [
          `🌿 植物：${plantResult.common_name || '未知'}（${plantResult.scientific_name || '-' }）`,
          `信心：${typeof plantResult.confidence === 'number' ? (plantResult.confidence*100).toFixed(0)+'%' : '-'}`,
          plantResult.likely_issues?.length ? `可能問題：${plantResult.likely_issues.join('、')}` : '',
          plantResult.care_steps?.length ? `照護：${plantResult.care_steps.join(' / ')}` : '',
          `嚴重度：${plantResult.severity || '-'}`,
          plantResult.fun_one_liner ? `「${plantResult.fun_one_liner}」` : '',
        ].filter(Boolean).join('\n')
      : (imgReply || reply || '今天的分析結果');

    const png = generateShareCard({
      title: '寵物＆植物小幫手',
      subtitle: '我的分析結果',
      body,
      photoDataURL: preview || undefined,
    });

    const a = document.createElement('a');
    a.href = png;
    a.download = 'share-card.png';
    a.click();
  }

  return (
    <main style={{ maxWidth: 720, margin: '40px auto', fontFamily: 'sans-serif', padding: '0 16px' }}>
      <h1>🐾 寵物＆植物溝通 MVP</h1>
      <p
