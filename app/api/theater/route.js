import { NextResponse } from "next/server";
import { z } from "zod";
import OpenAI from "openai";

// 若你是 Edge 環境想跑 Node 模組，確保 runtime 為 node
export const runtime = "nodejs";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // 這裡不要加 "!"
});

// 請求資料驗證
const SceneSchema = z.object({
  subjectType: z.enum(["pet", "plant"]),
  species: z.string().min(1),
  subjectImageUrl: z.string().optional(),
  humanImageUrl: z.string().optional(),
  stylePreset: z
    .enum(["cute-cartoon", "storybook", "studio-portrait", "painted", "comic", "photo"])
    .default("cute-cartoon"),
  dialogue: z.object({
    subject: z.string().default(""),
    human: z.string().optional(),
  }),
  sceneContext: z
    .object({
      mood: z.enum(["warm", "adventure", "serene", "playful", "mystery"]).default("warm"),
      environmentHint: z.string().default(""),
      showBubbles: z.boolean().default(true),
    })
    .default({ mood: "warm", environmentHint: "", showBubbles: true }),
  composition: z
    .object({
      humanScale: z.number().optional(),
      humanPosition: z.enum(["bottom-left", "bottom-right", "top-left", "top-right"]).optional(),
      enforceRules: z.boolean().default(true),
    })
    .default({ enforceRules: true }),
});

export async function POST(req) {
  try {
    const body = await req.json();
    const parsed = SceneSchema.parse(body);

    // 後端強制規範
    const safePayload = {
      ...parsed,
      dialogue: { subject: parsed.dialogue.subject || "", human: "" },
      composition: {
        ...parsed.composition,
        humanScale: 1 / 6,
        humanPosition: "bottom-left",
        enforceRules: true,
      },
    };

    const forbidCats =
      safePayload.subjectType === "plant" ||
      (safePayload.subjectType === "pet" &&
        !/^(cat|cats|kitten|kittens)$/i.test(safePayload.species));

    const prompt = buildPrompt({ ...safePayload, forbidCats });

    // 呼叫 OpenAI Images，直接拿 b64 回傳 dataURL（前端可直接顯示）
    const result = await client.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
      response_format: "b64_json",
    });

    const b64 = result.data?.[0]?.b64_json;
    if (!b64) throw new Error("OpenAI 回傳空的影像資料");

    const imageUrl = `data:image/png;base64,${b64}`;

    return NextResponse.json({ ok: true, imageUrl, prompt }, { status: 200 });
  } catch (err) {
    console.error("THEATER_ROUTE_ERROR:", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Unknown error" },
      { status: 400 }
    );
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
    "Human figure: include only if provided; scale exactly 1/6 of subject height; bottom-left; silent.",
    "Speech bubble: only for subject if dialogue provided.",
    `Mood: ${sceneContext.mood}.`,
    sceneContext.environmentHint
      ? `Environment hint: ${sceneContext.environmentHint}`
      : "Environment: cozy, softly lit background.",
    stylePreset === "photo"
      ? "Style: realistic photography."
      : stylePreset === "storybook"
      ? "Style: warm storybook illustration."
      : stylePreset === "painted"
      ? "Style: painterly illustration."
      : stylePreset === "comic"
      ? "Style: comic panel."
      : "Style: cute cartoon, rounded, gentle colors.",
    "Aspect ratio 1:1, 1024x1024.",
  ];

  const hardRules = [
    "RULES:",
    "- Only pet/plant may speak.",
    "- Human is always silent, fixed bottom-left, 1/6 scale.",
    "- No human speech bubble.",
    forbidCats
      ? "- Do NOT add cats unless species is cat."
      : "- Cats allowed only if species=cat.",
  ];

  const bubble =
    sceneContext.showBubbles && dialogue.subject
      ? `Speech bubble (subject): “${sanitize(dialogue.subject)}”`
      : "No speech bubble if subject line empty.";

  const refs = [];
  if (subjectImageUrl) refs.push(`Subject reference: ${subjectImageUrl}`);
  if (humanImageUrl) refs.push(`Human reference: ${humanImageUrl}`);

  return [
    `Subject: ${subjectType} (${species})`,
    ...refs,
    bubble,
    ...compositionRules,
    ...hardRules,
  ].join("\n");
}

function sanitize(s) {
  return String(s || "").replace(/\n/g, " ").slice(0, 140);
}
