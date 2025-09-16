// app/api/theater/route.js
import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

/** ---- 輕量驗證工具（不用 zod） ---- */
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

  const dialogue = {
    subject: ensureString(body?.dialogue?.subject, ""),
    human: "" // 永遠清空人類台詞
  };

  const sceneContext = {
    mood: ensureEnum(body?.sceneContext?.mood, ["warm", "adventure", "serene", "playful", "mystery"], "warm"),
    environmentHint: ensureString(body?.sceneContext?.environmentHint, ""),
    showBubbles: ensureBool(body?.sceneContext?.showBubbles, true)
  };

  // composition 會被後端覆蓋：humanScale=1/6、humanPosition=bottom-left
  const composition = {
    humanScale: 1 / 6,
    humanPosition: "bottom-left",
    enforceRules: true
  };

  return {
    subjectType,
    species,
    subjectImageUrl: ensureString(body?.subjectImageUrl, ""),
    humanImageUrl: ensureString(body?.humanImageUrl, ""),
    stylePreset,
    dialogue,
    sceneContext,
    composition
  };
}

/** ---- OpenAI Client ---- */
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function POST(req) {
  try {
    const body = await req.json();
    const safePayload = parseBody(body);

    const forbidCats =
      safePayload.subjectType === "plant" ||
      (safePayload.subjectType === "pet" &&
        !/^(cat|cats|kitten|kittens)$/i.test(safePayload.species));

    const prompt = buildPrompt({ ...safePayload, forbidCats });

    // 用 OpenAI 生成：直接回傳 dataURL（前端可直接顯示）
    const result = await client.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
      response_format: "b64_json"
    });

    const b64 = result?.data?.[0]?.b64_json;
    if (!b64) throw new Error("OpenAI 回傳為空");

    const imageUrl = `data:image/png;base64,${b64}`;
    return NextResponse.json({ ok: true, imageUrl, prompt }, { status: 200 });
  } catch (err) {
    console.error("THEATER_ROUTE_ERROR:", err);
    const message = err?.message || "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
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
    forbidCats
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
    "Aspect: 1:1 square, 1024x1024."
  ];

  const hardRules = [
    "RULES:",
    "- Only the PET/PLANT may speak.",
    "- Human must be silent, fixed at bottom-left, scaled to 1/6 of subject height.",
    "- Never draw a speech bubble for the human.",
    forbidCats
      ? "- Do NOT add cats/felines unless species is explicitly 'cat'."
      : "- Cat elements allowed only if species is 'cat'."
  ];

  const bubble =
    sceneContext.showBubbles && dialogue.subject
      ? `Speech bubble (subject only): “${sanitize(dialogue.subject)}”`
      : "No speech bubble if subject dialogue is empty.";

  const refs = [];
  if (subjectImageUrl) refs.push(`Subject reference: ${subjectImageUrl}`);
  if (humanImageUrl) refs.push(`Human reference: ${humanImageUrl}`);

  return [
    `Subject: ${subjectType} (${species})`,
    ...refs,
    bubble,
    ...compositionRules,
    ...hardRules
  ].join("\n");
}

function sanitize(s) {
  return String(s || "").replace(/\n/g, " ").slice(0, 140);
}
