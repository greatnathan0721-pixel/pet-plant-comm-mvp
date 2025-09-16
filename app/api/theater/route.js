// app/api/theater/route.js
import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

/** 輕量驗證（無 zod） */
function ensureEnum(val, allowed, fallback) {
  return allowed.includes(val) ? val : fallback;
}
function ensureString(v, fallback = "") {
  return typeof v === "string" ? v : fallback;
}
function ensureBool(v, fallback = true) {
  return typeof v === "boolean" ? v : fallback;
}
function parseBody(body) {
  const subjectType = ensureEnum(body?.subjectType, ["pet", "plant"], "pet");
  const species = ensureString(body?.species, subjectType === "plant" ? "plant" : "pet");
  const stylePreset = ensureEnum(
    body?.stylePreset,
    ["cute-cartoon", "storybook", "studio-portrait", "painted", "comic", "photo"],
    "cute-cartoon"
  );
  const dialogue = { subject: ensureString(body?.dialogue?.subject, ""), human: "" };
  const sceneContext = {
    mood: ensureEnum(body?.sceneContext?.mood, ["warm", "adventure", "serene", "playful", "mystery"], "warm"),
    environmentHint: ensureString(body?.sceneContext?.environmentHint, ""),
    showBubbles: ensureBool(body?.sceneContext?.showBubbles, true),
  };
  const composition = { humanScale: 1 / 6, humanPosition: "bottom-left", enforceRules: true };

  return {
    subjectType,
    species,
    subjectImageUrl: ensureString(body?.subjectImageUrl, ""),
    humanImageUrl: ensureString(body?.humanImageUrl, ""),
    stylePreset,
    dialogue,
    sceneContext,
    composition,
  };
}

/** 移除 dataURL（超長 base64），避免塞進 prompt */
function stripDataURL(u) {
  return typeof u === "string" && u.startsWith("data:") ? "" : u;
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req) {
  try {
    const body = await req.json();
    const safePayload = parseBody(body);

    // 👉 這裡把 dataURL 清掉，不放進 prompt
    const promptInput = {
      ...safePayload,
      subjectImageUrl: stripDataURL(safePayload.subjectImageUrl),
      humanImageUrl: stripDataURL(safePayload.humanImageUrl),
    };

    const forbidCats =
      promptInput.subjectType === "plant" ||
      (promptInput.subjectType === "pet" && !/^(cat|cats|kitten|kittens)$/i.test(promptInput.species));

    let prompt = buildPrompt({ ...promptInput, forbidCats });

    // 額外保險：若還是超長，砍掉參考行（理論上這時已經不會超了）
    if (prompt.length > 30000) {
      prompt = prompt.replace(/^Subject reference:.*$/gm, "").replace(/^Human reference:.*$/gm, "");
    }
    if (prompt.length > 32000) {
      // 最後保險：硬切（幾乎不會觸發）
      prompt = prompt.slice(0, 31900);
    }

    // OpenAI 圖像生成（不傳 response_format）
    const result = await client.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
    });

    const url = result?.data?.[0]?.url;
    const b64 = result?.data?.[0]?.b64_json; // 某些回應可能會帶
    if (!url && !b64) throw new Error("OpenAI 回傳空的影像資料");

    const imageUrl = url || `data:image/png;base64,${b64}`;
    return NextResponse.json({ ok: true, imageUrl, prompt }, { status: 200 });
  } catch (err) {
    console.error("THEATER_ROUTE_ERROR:", err);
    return NextResponse.json({ ok: false, error: err?.message || "Unknown error" }, { status: 400 });
  }
}

function buildPrompt(input) {
  const {
    subjectType,
    species,
    subjectImageUrl,
    humanImageUrl,
    stylePreset,
    dialogue,
    sceneContext,
    forbidCats,
  } = input;

  const compositionRules = [
    "Scene: single-frame for social sharing.",
    "Primary subject must be central and prominent.",
    "Human figure: include only if provided; scale exactly 1/6 of the subject height; place at bottom-left; human is silent.",
    "Speech bubble: only for the pet/plant if dialogue is provided.",
    `Mood: ${sceneContext.mood}.`,
    sceneContext.environmentHint
      ? `Environment hint: ${sceneContext.environmentHint}`
      : "Environment: cozy, softly lit, clean background.",
    stylePreset === "photo"
      ? "Style: realistic photography, gentle light."
      : stylePreset === "storybook"
      ? "Style: warm storybook illustration, watercolor-like textures."
      : stylePreset === "painted"
      ? "Style: painterly illustration with visible brush strokes."
      : stylePreset === "comic"
      ? "Style: comic panel with crisp lines."
      : "Style: cute cartoon, rounded shapes, gentle colors.",
    "Aspect: 1:1 square, 1024x1024.",
  ];

  const hardRules = [
    "RULES:",
    "- Only the PET/PLANT may speak.",
    "- Human must be silent, fixed at bottom-left, scaled to 1/6 of subject height.",
    "- Never draw a speech bubble for the human.",
    forbidCats
      ? "- Do NOT add cats/felines unless species is explicitly 'cat'."
      : "- Cat elements allowed only if species is 'cat'.",
  ];

  const bubble =
    sceneContext.showBubbles && dialogue.subject
      ? `Speech bubble (subject only): “${sanitize(dialogue.subject)}”`
      : "No speech bubble if subject dialogue is empty.";

  const refs = [];
  // 只在不是 dataURL 的情況下才加入參考 URL（短）
  if (subjectImageUrl) refs.push(`Subject reference: ${subjectImageUrl}`);
  if (humanImageUrl) refs.push(`Human reference: ${humanImageUrl}`);

  let text = [
    `Subject: ${subjectType} (${species})`,
    ...refs,
    bubble,
    ...compositionRules,
    ...hardRules,
  ].join("\n");

  // 終極保險（通常用不到）
  if (text.length > 32000) text = text.slice(0, 31900);
  return text;
}

function sanitize(s) {
  return String(s || "").replace(/\n/g, " ").slice(0, 140);
}
