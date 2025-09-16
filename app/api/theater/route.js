// app/api/theater/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

/**
 * Scene payload schema
 * - 強制規範：
 *   1) 只有 subject(寵物/植物) 有台詞；human 永遠不說話（後端會過濾）。
 *   2) human 縮放為 subject 高度的 1/6（約 0.1667 倍），定位左下角。
 *   3) 若未提供 human 圖，則不放人像層。
 *   4) 任何 "cat" 類型只在 subjectType === 'pet' 且 species === 'cat' 才允許。
 */
const SceneSchema = z.object({
  subjectType: z.enum(["pet", "plant"]),
  species: z.string().min(1, "species is required"),
  subjectImageUrl: z.string().url().optional(), // 可選：若用分類器產提示詞，不一定需要原圖
  humanImageUrl: z.string().url().optional(),
  stylePreset: z
    .enum([
      "cute-cartoon",
      "storybook",
      "studio-portrait",
      "painted",
      "comic",
      "photo"
    ])
    .default("cute-cartoon"),
  dialogue: z.object({
    subject: z
      .string()
      .max(140, "subject dialogue is too long")
      .default(""),
    human: z.string().optional() // 會被忽略/清空
  }),
  sceneContext: z
    .object({
      mood: z
        .enum(["warm", "adventure", "serene", "playful", "mystery"])
        .default("warm"),
      environmentHint: z.string().default(""),
      // 是否要顯示對話框（subject 對話框）；人類永遠不顯示
      showBubbles: z.boolean().default(true)
    })
    .default({ mood: "warm", environmentHint: "", showBubbles: true }),
  // 進階控制：若提供仍會被後端覆蓋
  composition: z
    .object({
      humanScale: z.number().optional(), // 將被覆蓋為 1/6
      humanPosition: z
        .enum(["bottom-left", "bottom-right", "top-left", "top-right"])
        .optional(), // 將被覆蓋為 bottom-left
      enforceRules: z.boolean().default(true)
    })
    .default({ enforceRules: true })
});

type ScenePayload = z.infer<typeof SceneSchema>;

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const parsed = SceneSchema.parse(json) as ScenePayload;

    // ---- 規範強制：人類台詞清空、定位與比例固定 ----
    const safePayload: ScenePayload = {
      ...parsed,
      dialogue: {
        subject: parsed.dialogue.subject ?? "",
        human: "" // 永遠不讓人類講話
      },
      composition: {
        ...parsed.composition,
        humanScale: 1 / 6, // ~0.1667
        humanPosition: "bottom-left",
        enforceRules: true
      }
    };

    // 額外：若 species 不允許「貓」但 subjectType=plant，避免誤入貓元素
    const forbidCats =
      safePayload.subjectType === "plant" ||
      (safePayload.subjectType === "pet" &&
        !/^(cat|cats|kitten|kittens)$/i.test(safePayload.species ?? ""));

    const prompt = buildPrompt({
      ...safePayload,
      forbidCats
    });

    // 這裡預留供應商串接點：
    // 你可以改成呼叫你現有的圖生圖/合成服務（如自家的 compositor、OpenAI Images、Stability、Replicate、自架 Diffusers 等）
    // 下方提供一個「假回傳」fallback，方便你本地先通到前端流程。
    const provider = process.env.THEATER_IMAGE_PROVIDER ?? "mock";
    let imageUrl = "";
    let meta: any = { provider, prompt };

    if (provider === "mock") {
      // 假圖：以 data URL 不便；改回傳一張佔位圖 + 將 prompt 一併回傳方便 debug
      imageUrl = `https://placehold.co/1024x1024/png?text=Theater+Preview`;
    } else {
      // === 範例：你可在此改成實際供應商 ===
      // imageUrl = await callYourImageProvider({ prompt, safePayload });
      // meta.providerResponse = ...
      throw new Error(
        "Please implement your image provider or set THEATER_IMAGE_PROVIDER=mock for placeholder."
      );
    }

    return NextResponse.json(
      {
        ok: true,
        imageUrl,
        prompt, // 便於你檢查是否符合：只有 subject 說話、人左下角 1/6 等
        meta
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("THEATER_ROUTE_ERROR:", err);
    const message = err?.message ?? "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
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
    composition,
    forbidCats
  } = input;

  // 視覺規範（傳給你的合成服務或文生圖的 prompt）
  const compositionRules = [
    "Scene: single-frame composition for social sharing.",
    `Human figure: include only if humanImageUrl is provided; scale to EXACTLY ~16.7% of the ${subjectType}'s height; place at bottom-left; human has NO speech bubble; human facial expression gentle and neutral.`,
    `Primary subject: the ${subjectType} (${species}) is the hero; ensure clear visibility and central prominence.`,
    sceneContext.environmentHint
      ? `Environment hint: ${sceneContext.environmentHint}`
      : "Environment: cozy, softly lit, clean background with depth.",
    `Mood: ${sceneContext.mood}.`,
    stylePreset === "photo"
      ? "Style: realistic photography, shallow depth-of-field."
      : stylePreset === "storybook"
      ? "Style: warm storybook illustration, soft edges, watercolor-like textures."
      : stylePreset === "painted"
      ? "Style: painterly, visible brush strokes, soft color palette."
      : stylePreset === "comic"
      ? "Style: comic panel, crisp lines and halftone shading."
      : "Style: cute, rounded shapes, gentle lighting, subtle textures.",
    "Aspect: 1:1 square, 1024x1024 target.",
    "Color: balanced, avoid oversaturation.",
    "Typography/Overlays: Reserve space for one speech bubble near the subject if showBubbles=true."
  ];

  const hardConstraints = [
    "HARD RULES:",
    "- Only the PET/PLANT may speak. The human must be silent.",
    "- If a human is present, position at bottom-left and keep scale at 1/6 of subject height.",
    "- Do not place any speech bubble for the human under any circumstance.",
    "- Keep composition clean; avoid clutter.",
    forbidCats
      ? "- Absolutely DO NOT introduce cats/felines unless species is explicitly cat."
      : "- Cat elements allowed only if species is cat."
  ];

  const bubble =
    sceneContext.showBubbles && dialogue.subject
      ? `Speech bubble (subject only): “${sanitize(dialogue.subject)}”`
      : "No speech bubble or empty bubble is acceptable.";

  const refImages: string[] = [];
  if (subjectImageUrl) refImages.push(`SubjectRef: ${subjectImageUrl}`);
  if (humanImageUrl) refImages.push(`HumanRef: ${humanImageUrl}`);

  return [
    `Subject: ${subjectType} (${species})`,
    ...refImages,
    bubble,
    ...compositionRules,
    ...hardConstraints
  ].join("\n");
}

function sanitize(s: string) {
  return s.replace(/\n/g, " ").slice(0, 140);
}
