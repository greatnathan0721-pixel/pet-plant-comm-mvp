import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/** —— 台灣口吻幹話詞庫（PG-13） —— */
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

function pickQuip(species, fallback = "我先可愛，你隨意。") {
  const list = [...(QUIPS[species] || []), ...QUIPS.any];
  return list[Math.floor(Math.random() * list.length)] || fallback;
}

// 工具
function ensureEnum(val, list, fb) { return list.includes(val) ? val : fb; }
function S(v, fb = "") { return typeof v === "string" ? v : fb; }
function B(v, fb = true) { return typeof v === "boolean" ? v : fb; }
function stripDataURL(u) { return typeof u === "string" && u.startsWith("data:") ? "" : u; }
function sanitizeLine(s, n = 80) { return S(s).replace(/\s+/g, " ").trim().slice(0, n); }

// 自動斷行（每 chunkSize 字換行）
function wrapText(str, chunkSize = 12) {
  const clean = sanitizeLine(str, 60);
  if (!clean) return "";
  const chunks = [];
  for (let i = 0; i < clean.length; i += chunkSize) {
    chunks.push(clean.slice(i, i + chunkSize));
  }
  return chunks.join("\n");
}

// dataURL → File
async function dataURLtoFile(dataURL, filename) {
  const base64 = dataURL.split(",")[1];
  if (!base64) return null;
  const buf = Buffer.from(base64, "base64");
  const { toFile } = await import("openai/uploads");
  const mime = dataURL.includes("png") ? "image/png" : "image/jpeg";
  return toFile(buf, filename, { type: mime });
}

// parse body
function parseBody(body) {
  const subjectType = ensureEnum(body?.subjectType, ["pet", "plant"], "pet");
  const species = S(body?.species, subjectType === "plant" ? "plant" : "pet");
  const stylePreset = ensureEnum(
    body?.stylePreset,
    ["cute-cartoon", "storybook", "studio-portrait", "painted", "comic", "photo"],
    "photo"
  );
  const dialogue = { subject: S(body?.dialogue?.subject, ""), human: "" };
  const sceneContext = {
    mood: ensureEnum(body?.sceneContext?.mood, ["warm", "adventure", "serene", "playful", "mystery"], "warm"),
    environmentHint: S(body?.sceneContext?.environmentHint, ""),
    showBubbles: B(body?.sceneContext?.showBubbles, true),
  };
  const composition = { humanScale: 1/6, humanPosition: "bottom-left", enforceRules: true };

  return {
    subjectType, species, stylePreset, dialogue, sceneContext, composition,
    subjectImageUrl: stripDataURL(S(body?.subjectImageUrl, "")),
    humanImageUrl: stripDataURL(S(body?.humanImageUrl, "")),
    subjectImageData: S(body?.subjectImageData, ""),
    humanImageData: S(body?.humanImageData, ""),
  };
}

// ---- API 主體 ----
export async function POST(req) {
  try {
    const body = await req.json();
    const p = parseBody(body);

    // 選擇詞庫種類
    const quipSpecies =
      p.subjectType === "plant"
        ? "plant"
        : /^(cat|cats|kitten|kittens)$/i.test(p.species)
        ? "cat"
        : "dog";

    // 台詞：有給 → 清理後斷行；沒給 → 隨機挑
    const userLine = S(p.dialogue.subject, "").trim();
    const bubbleText = p.sceneContext.showBubbles
      ? (userLine ? wrapText(userLine, 12) : wrapText(pickQuip(quipSpecies), 12))
      : "";

    const forbidCats =
      p.subjectType === "plant" ||
      (p.subjectType === "pet" && !/^(cat|cats|kitten|kittens)$/i.test(p.species));

    // prompt
    let prompt = buildPromptText({
      ...p,
      dialogue: { subject: bubbleText, human: "" },
      forbidCats,
    });

    if (prompt.length > 30000) {
      prompt = prompt.replace(/^Subject reference:.*$/gm, "")
                     .replace(/^Human reference:.*$/gm, "");
    }
    if (prompt.length > 32000) prompt = prompt.slice(0, 31900);

    const useEdit = !!p.subjectImageData;
    let result;

    if (useEdit) {
      const baseFile = await dataURLtoFile(p.subjectImageData, "subject.jpg");
      if (!baseFile) throw new Error("主圖 dataURL 解析失敗");

      let extraImages = [];
      if (p.humanImageData) {
        const humanFile = await dataURLtoFile(p.humanImageData, "human.jpg");
        if (humanFile) extraImages.push(humanFile);
      }

      try {
        result = await client.images.edits({
          model: "gpt-image-1",
          image: baseFile,
          // 某些版本允許多圖參考
          additional_image: extraImages,
          prompt,
          size: "1024x1024",
        });
      } catch (e) {
        result = await client.images.edits({
          model: "gpt-image-1",
          image: baseFile,
          prompt,
          size: "1024x1024",
        });
      }
    } else {
      result = await client.images.generate({
        model: "gpt-image-1",
        prompt,
        size: "1024x1024",
      });
    }

    const url = result?.data?.[0]?.url;
    const b64 = result?.data?.[0]?.b64_json;
    if (!url && !b64) throw new Error("OpenAI 回傳空的影像資料");

    const imageUrl = url || `data:image/png;base64,${b64}`;
    return NextResponse.json({ ok: true, imageUrl, prompt, bubbleText }, { status: 200 });
  } catch (err) {
    console.error("THEATER_ROUTE_ERROR:", err);
    return NextResponse.json({ ok: false, error: err?.message || "Unknown error" }, { status: 400 });
  }
}

// prompt builder
function buildPromptText(input) {
  const {
    subjectType, species, stylePreset, dialogue, sceneContext, composition,
    subjectImageUrl, humanImageUrl, forbidCats,
  } = input;

  const style =
    stylePreset === "photo"       ? "Style: realistic photography, cinematic light, shallow depth of field."
  : stylePreset === "storybook"   ? "Style: warm storybook illustration, watercolor textures."
  : stylePreset === "painted"     ? "Style: painterly illustration with brush strokes."
  : stylePreset === "comic"       ? "Style: comic panel with crisp lines and halftones."
  : stylePreset === "studio-portrait" ? "Style: studio portrait lighting, soft rim light."
  : "Style: cute cartoon, rounded shapes, gentle palette.";

  const lines = [
    `Subject: ${subjectType} (${species}).`,
    subjectImageUrl ? `Subject reference: ${subjectImageUrl}` : "",
    humanImageUrl ? `Human reference: ${humanImageUrl}` : "",
    dialogue?.subject
      ? `Speech bubble (subject only, Traditional Chinese, snarky PG-13, humorous, Taiwan internet slang style, no slurs): “${dialogue.subject}”`
      : "No speech bubble if subject dialogue is empty.",
    `Mood: ${sceneContext?.mood || "warm"}.`,
    sceneContext?.environmentHint ? `Environment hint: ${sanitizeLine(sceneContext.environmentHint, 80)}` : "Environment: cozy, softly lit background.",
    style,
    "Aspect: 1:1 square, 1024x1024.",
    "Composition rules:",
    "- Make the primary subject large and central.",
    "- Include the human only if provided; place human at bottom-left, scaled to exactly 1/6 of the subject height; human is silent and has NO speech bubble.",
    "- Draw a clean speech bubble for the subject only if text is provided.",
    "Typography: bubble uses clean rounded font, high legibility.",
    "RULES:",
    "- Only the PET/PLANT may speak.",
    "- Human must be silent.",
    forbidCats
      ? "- Do NOT add cats/felines unless species is explicitly 'cat'."
      : "- Cat elements allowed only if species is 'cat'.",
  ].filter(Boolean);

  return lines.join("\n");
}
