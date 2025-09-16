import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

/**
 * 輸入結構
 * - 只有 subject（寵物/植物）能說話
 * - 人類必須清空台詞、固定左下角、比例 1/6
 */
const SceneSchema = z.object({
  subjectType: z.enum(["pet", "plant"]),
  species: z.string().min(1),
  subjectImageUrl: z.string().optional(),
  humanImageUrl: z.string().optional(),
  stylePreset: z
    .enum([
      "cute-cartoon",
      "storybook",
      "studio-portrait",
      "painted",
      "comic",
      "photo",
    ])
    .default("cute-cartoon"),
  dialogue: z.object({
    subject: z.string().default(""),
    human: z.string().optional(),
  }),
  sceneContext: z
    .object({
      mood: z
        .enum(["warm", "adventure", "serene", "playful", "mystery"])
        .default("warm"),
      environmentHint: z.string().default(""),
      showBubbles: z.boolean().default(true),
    })
    .default({ mood: "warm", environmentHint: "", showBubbles: true }),
  composition: z
    .object({
      humanScale: z.number().optional(),
      humanPosition: z
        .enum(["bottom-left", "bottom-right", "top-left", "top-right"])
        .optional(),
      enforceRules: z.boolean().default(true),
    })
    .default({ enforceRules: true }),
});

type ScenePayload = z.infer<typeof SceneSchema>;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = SceneSchema.parse(body);

    // 強制規範
    const safePayload: ScenePayload = {
      ...parsed,
      dialogue: { subject: parsed.dialogue.subject ?? "", human: "" },
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

    // 🔑 呼叫 OpenAI Images API
    const result = await client.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
    });

    const imageUrl = result.data[0].url;

    return NextResponse.json(
      {
        ok: true,
        imageUrl,
        prompt, // 方便 debug 規範有沒有帶進去
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("THEATER_ROUTE_ERROR:", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Unknown error" },
      { status: 400 }
    );
  }
}

function buildPrompt(input: ScenePayload & { forbidCats: boolean }) {
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

  const refs: string[] = [];
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

function sanitize(s: string) {
  return s.replace(/\n/g, " ").slice(0, 140);
}
