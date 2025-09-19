// app/api/theater2/route.js
import { NextResponse, NextResponse as NR } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// —— 小工具 ——
const S = (v, fb="") => (typeof v === "string" ? v : fb);
const B = (v, fb=true) => (typeof v === "boolean" ? v : fb);
const keep = (s, n) => S(s).replace(/\s+/g," ").trim().slice(0, n);
const wrap = (t, n=12) => {
  const s = keep(t, 60); if (!s) return "";
  const o=[]; for (let i=0;i<s.length;i+=n) o.push(s.slice(i,i+n));
  return o.join("\n");
};
const dataURLToPNGBlob = (dataURL) => {
  const b64 = S(dataURL).split(",")[1]; if (!b64) return null;
  return new Blob([Buffer.from(b64, "base64")], { type: "image/png" });
};

// —— 台詞（物種安全：不跨物種；any 僅通用不提罐罐/肉乾） ——
const QUIPS = {
  cat: [
    "別吵，我在耍廢。","先奉上罐頭，才有下一步。","沒事不要一直摸，我會掉漆。",
    "你很吵，冷靜一點啦。","我今天只想躺著耍帥。","要抱？先填申請表。",
    "給我小魚乾，我再考慮要不要理你。","我忙著當網美，不要干擾。",
    "要摸排隊，先抽號碼牌。","你太吵，我毛都炸了。"
  ],
  dog: [
    "散步快點啦，我腳抖了！","先給零食，再給愛。","你回來囉～我假裝不在意一下。",
    "我很乖，但我更想吃餅乾。","抱我啦，不然我一直看你。","我可以坐下，也可以坐你腿上。",
    "給我拍拍，我立刻變好狗狗。","出門沒帶我？欠揍喔。","你回來我裝酷 3 秒。"
  ],
  plant: [
    "今天只喝一點水，別淹死我。","太陽多給一點啦，不然我臉色很差。",
    "我在發芽，你不要在旁邊碎念。","葉子捲不是生氣，是在裝文青。",
    "我很綠，但不綠茶。","別亂移我，我在追光線。","先澆水，再談心。",
    "風吹來就是我的演唱會。","土表乾了再澆，我們講科學。"
  ],
  any: [
    "我先可愛，你隨意。","別急，我在更新毛髮版本。","有事丟零食，沒事別煩我。",
    "先尊重我的午睡時間。","我忙著當主角，不方便接客。","要合照？先問我經紀人。",
    "別打擾，正在充電模式。","我就是今天的卡司。"
  ]
};
const pickQuip = (sp, fb="我先可愛，你隨意。") => {
  const pool=[...(QUIPS[sp]||[]), ...QUIPS.any];
  return pool[Math.floor(Math.random()*pool.length)] || fb;
};

// —— prompt：寫實 85%，人像動態位置（依背景/姿勢/心情） ——
function buildPrompt({ species, mood, bubbleText, envHint }) {
  const style = "ultra realistic photo, cinematic soft light, shallow depth of field, natural textures (fur/skin/leaf).";
  return keep([
    `Style: ${style}`,
    `Mood: ${mood || "warm"}.`,
    envHint ? `Environment hint: ${keep(envHint, 80)}` : "Environment: coherent home/urban setting with natural light.",
    bubbleText ? `Speech bubble (Traditional Chinese, Taiwan slang, witty): “${bubbleText}”` : "No speech bubble if none.",
    "Rules:",
    "- Output must look like a real photo (not cartoon/painting). Target ~85% similarity to the uploaded subject (colors/markings/leaves).",
    "- Primary subject (pet/plant) large and central.",
    "- If a human image is provided, include ONE human at a NATURAL position relative to the subject and background; size about one-sixth to one-fifth of subject; human is silent (no bubble).",
    "- Human pose and expression should respond to the subject’s mood (greeting, comforting, playful); avoid copy-paste look.",
    "- Only the pet/plant may speak. Human must be silent.",
    "- Keep background coherent; do not add extra animals or wrong species.",
    "Aspect: 1:1 square, 1024x1024."
  ].join("\n"), 31900);
}

export async function POST(req) {
  const reqId = Math.random().toString(36).slice(2,8);
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ ok:false, error:"Missing OPENAI_API_KEY" }, { status:500 });
    }
    const body = await req.json();

    const species = S(body?.species, "cat");            // 'cat' | 'dog' | 'plant'
    const showBubbles = B(body?.sceneContext?.showBubbles, true);
    const mood = S(body?.sceneContext?.mood, "warm");
    const envHint = S(body?.sceneContext?.environmentHint, "");
    const givenText = S(body?.dialogue?.subject, "");   // 若空→自動選詞
    const subjectImageData = S(body?.subjectImageData, "");  // 壓縮後 dataURL
    const humanImageData = S(body?.humanImageData, "");

    const bubble = showBubbles ? wrap(givenText || pickQuip(species), 12) : "";
    const prompt = buildPrompt({ species, mood, bubbleText: bubble, envHint });

    // 有上傳主圖 → 走 image-to-image
    if (subjectImageData) {
      const form = new FormData();
      form.append("model", "gpt-image-1");
      form.append("prompt", prompt);
      form.append("size", "1024x1024");

      const baseBlob = dataURLToPNGBlob(subjectImageData);
      if (!baseBlob) {
        return NextResponse.json({ ok:false, error:"主圖 dataURL 解析失敗" }, { status:400 });
      }
      form.append("image", baseBlob, "subject.png");

      // 可選：人像也附上作為參考（不產生人類氣泡）
      if (humanImageData) {
        const hBlob = dataURLToPNGBlob(humanImageData);
        if (hBlob) form.append("image", hBlob, "human.png");
      }

      const r = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: form,
        cache: "no-store",
      });

      const text = await r.text();
      if (!r.ok) {
        return NextResponse.json({ ok:false, error:"OpenAI edits error", details:text }, { status:400, headers:{ "x-req-id": reqId } });
      }
      let j; try { j = JSON.parse(text); } catch { j = null; }
      const b64 = j?.data?.[0]?.b64_json;
      if (!b64) {
        return NextResponse.json({ ok:false, error:"OpenAI 回傳空影像" }, { status:400, headers:{ "x-req-id": reqId } });
      }
      return NextResponse.json({ ok:true, imageUrl:`data:image/png;base64,${b64}` }, { status:200, headers:{ "x-req-id": reqId, "x-theater-version":"v0.3-realistic" }});
    }

    // 沒主圖 → 純文字生圖
    const payload = { model:"gpt-image-1", prompt, size:"1024x1024" };
    const r = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const text = await r.text();
    if (!r.ok) {
      return NextResponse.json({ ok:false, error:"OpenAI generate error", details:text }, { status:400, headers:{ "x-req-id": reqId } });
    }
    let j; try { j = JSON.parse(text); } catch { j = null; }
    const url = j?.data?.[0]?.url || (j?.data?.[0]?.b64_json ? `data:image/png;base64,${j.data[0].b64_json}` : "");
    if (!url) return NextResponse.json({ ok:false, error:"OpenAI 回傳空影像" }, { status:400, headers:{ "x-req-id": reqId } });

    return NextResponse.json({ ok:true, imageUrl:url }, { status:200, headers:{ "x-req-id": reqId, "x-theater-version":"v0.3-realistic" }});
  } catch (err) {
    console.error("THEATER2_ERROR:", err);
    return NextResponse.json({ ok:false, error:String(err?.message || err) }, { status:500 });
  }
}

// 健康檢查（方便直接打網址測）
export async function GET() {
  return new NR("OK /api/theater2", { status:200, headers:{ "cache-control":"no-store" }});
}
