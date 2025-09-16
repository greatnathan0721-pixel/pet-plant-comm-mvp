// app/api/theater/route.js
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------- 台灣口吻幹話詞庫 ----------
const QUIPS = {
  cat: [
    "別吵，我在耍廢。",
    "先奉上罐頭，才有下一步。",
    "沒事不要一直摸，我會掉漆。",
    "你很吵，冷靜一點啦。",
    "我今天只想躺著耍帥。",
    "要抱？先填申請表。",
    "給我小魚乾，我再考慮要不要理你。",
    "我忙著當網美，不要干擾。",
  ],
  dog: [
    "散步快點啦，我腳抖了！",
    "先給零食，再給愛。",
    "你回來囉～我假裝不在意一下。",
    "我很乖，但我更想吃餅乾。",
    "抱我啦，不然我一直看你。",
    "我可以坐下，也可以坐你腿上。",
    "給我拍拍，我立刻變好狗狗。",
    "出門沒帶我？欠揍喔。",
  ],
  plant: [
    "今天只喝一點水，別淹死我。",
    "太陽多給一點啦，不然我臉色很差。",
    "我在發芽，你不要在旁邊碎念。",
    "葉子捲不是生氣，是在裝文青。",
    "我很綠，但不綠茶。",
    "別亂移我，我在追光線。",
    "先澆水，再談心。",
    "風吹來就是我的演唱會。",
  ],
  any: [
    "我先可愛，你隨意。",
    "別急，我在更新毛髮版本。",
    "有事丟零食，沒事別煩我。",
    "先尊重我的午睡時間。",
    "我忙著當主角，不方便接客。",
    "要合照？先問我經紀人。",
    "別打擾，正在充電模式。",
    "我就是今天的卡司。",
  ],
};
const pickQuip = (sp, fb="我先可愛，你隨意。") => {
  const list = [...(QUIPS[sp]||[]), ...QUIPS.any];
  return list[Math.floor(Math.random()*list.length)] || fb;
};

// ---------- 小工具 ----------
const S = (v, fb="") => (typeof v === "string" ? v : fb);
const B = (v, fb=true) => (typeof v === "boolean" ? v : fb);
const ensureEnum = (v, list, fb) => (list.includes(v) ? v : fb);
const sanitize = (s, n=80) => S(s).replace(/\s+/g, " ").trim().slice(0, n);
const wrap = (s, n=12) => {
  const t = sanitize(s, 60); if (!t) return "";
  const out=[]; for (let i=0;i<t.length;i+=n) out.push(t.slice(i,i+n));
  return out.join("\n");
};
const dataURLToPNGBlob = (dataURL) => {
  const base64 = S(dataURL).split(",")[1];
  if (!base64) return null;
  const buf = Buffer.from(base64, "base64");
  return new Blob([buf], { type: "image/png" });
};

function parseBody(body) {
  const subjectType = ensureEnum(body?.subjectType, ["pet","plant"], "pet");
  const species = S(body?.species, subjectType === "plant" ? "plant" : "pet");
  const stylePreset = ensureEnum(
    body?.stylePreset,
    ["cute-cartoon","storybook","studio-portrait","painted","comic","photo"],
    "photo"
  );
  const dialogue = { subject: S(body?.dialogue?.subject, ""), human: "" };
  const sceneContext = {
    showBubbles: B(body?.sceneContext?.showBubbles, true),
    mood: ensureEnum(body?.sceneContext?.mood, ["warm","adventure","serene","playful","mystery"], "warm"),
    environmentHint: S(body?.sceneContext?.environmentHint, "")
  };
  return {
    subjectType, species, stylePreset, dialogue, sceneContext,
    subjectImageData: S(body?.subjectImageData, ""),
    humanImageData: S(body?.humanImageData, "")
  };
}

function buildPromptText(input) {
  const { subjectType, species, stylePreset, dialogue, sceneContext } = input;

  const style =
    stylePreset === "photo" ? "realistic photography, cinematic light."
    : stylePreset === "studio-portrait" ? "studio portrait lighting, soft rim light."
    : stylePreset === "storybook" ? "warm storybook illustration, watercolor."
    : stylePreset === "painted" ? "painterly illustration."
    : stylePreset === "comic" ? "comic panel, crisp lines."
    : "cute cartoon, rounded shapes.";

  const forbidCats =
    subjectType === "plant" || !( /^cat(s)?|kitten(s)?$/i.test(species) );

  const lines = [
    `Subject: ${subjectType} (${species}).`,
    dialogue?.subject
      ? `Speech bubble (Traditional Chinese, Taiwan slang, witty PG-13): “${dialogue.subject}”`
      : "No speech bubble if empty.",
    `Mood: ${sceneContext?.mood || "warm"}.`,
    sceneContext?.environmentHint
      ? `Environment hint: ${sanitize(sceneContext.environmentHint, 80)}`
      : "Environment: cozy, softly lit background.",
    `Style: ${style}`,
    "Aspect: 1:1 square, 1024x1024.",
    "Composition rules:",
    "- Primary subject large and central.",
    "- Include the human only if provided; place at bottom-left, ~1/6 of subject height; human is silent (no bubble).",
    "- Draw a clean speech bubble for the subject only if text is provided.",
    "Typography: rounded, high legibility.",
    "RULES:",
    "- Only the PET/PLANT may speak.",
    "- Human must be silent.",
    forbidCats
      ? "- Do NOT add cats/felines unless species is explicitly 'cat'."
      : "- Cat elements allowed only if species is 'cat'.",
  ].filter(Boolean);

  let prompt = lines.join("\n");
  if (prompt.length > 32000) prompt = prompt.slice(0, 31900);
  return prompt;
}

export async function POST(req) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ ok:false, error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    const raw = await req.json();
    const p = parseBody(raw);

    // 台詞：有給用給的；沒給從詞庫挑
    const quipSpecies =
      p.subjectType === "plant" ? "plant"
      : /^cat(s)?|kitten(s)?$/i.test(p.species) ? "cat"
      : "dog";

    const bubble = p.sceneContext.showBubbles
      ? (S(p.dialogue.subject).trim()
          ? wrap(p.dialogue.subject, 12)
          : wrap(pickQuip(quipSpecies), 12))
      : "";

    const prompt = buildPromptText({
      ...p,
      dialogue: { subject: bubble, human: "" },
    });

    const hasBase = !!p.subjectImageData;

    if (hasBase) {
      // ---- image-to-image：/v1/images/edits (multipart/form-data)
      const form = new FormData();
      form.append("model", "gpt-image-1");
      form.append("prompt", prompt);
      form.append("size", "1024x1024");

      const blob = dataURLToPNGBlob(p.subjectImageData);
      if (!blob) {
        return NextResponse.json({ ok:false, error: "主圖 dataURL 解析失敗" }, { status: 400 });
      }
      form.append("image", blob, "subject.png");

      // （選擇性）如果你想把人像也當參考，可以再附一張 image；
      // 目前多數情況下僅靠 prompt 也能達成 MVP。
      // if (p.humanImageData) {
      //   const hBlob = dataURLToPNGBlob(p.humanImageData);
      //   if (hBlob) form.append("image", hBlob, "human.png");
      // }

      const r = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: form,
        cache: "no-store",
      });

      const text = await r.text();
      if (!r.ok) {
        return NextResponse.json({ ok:false, error: `OpenAI edits error`, details: text }, { status: 400 });
      }

      let j; try { j = JSON.parse(text); } catch { j = null; }
      const b64 = j?.data?.[0]?.b64_json;
      if (!b64) return NextResponse.json({ ok:false, error: "OpenAI 回傳空的影像資料" }, { status: 400 });

      return NextResponse.json({ ok:true, imageUrl: `data:image/png;base64,${b64}` }, { status: 200 });

    } else {
      // ---- 純文字生成：/v1/images/generations (JSON)
      const payload = { model: "gpt-image-1", prompt, size: "1024x1024" };
      const r = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        cache: "no-store",
      });

      const text = await r.text();
      if (!r.ok) {
        return NextResponse.json({ ok:false, error: `OpenAI generate error`, details: text }, { status: 400 });
      }

      let j; try { j = JSON.parse(text); } catch { j = null; }
      const url = j?.data?.[0]?.url;
      const b64 = j?.data?.[0]?.b64_json;
      if (!url && !b64) {
        return NextResponse.json({ ok:false, error: "OpenAI 回傳空的影像資料" }, { status: 400 });
      }
      const imageUrl = url || `data:image/png;base64,${b64}`;
      return NextResponse.json({ ok:true, imageUrl }, { status: 200 });
    }
  } catch (err) {
    console.error("THEATER_ROUTE_ERROR:", err);
    return NextResponse.json({ ok:false, error: String(err?.message || err) }, { status: 500 });
  }
}
