// app/api/theater/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * 用 OpenAI 圖像編輯生成「小人國」合成圖（方法 B）
 * 要點：
 * - 小人國 ≈ 寵物/植物高度的 1/6
 * - 臉 80% 相似使用者照片，只能更帥/更美；穿原始服裝
 * - 姿勢/表情呼應寵物心情、視線看向寵物
 * - 漫畫風泡泡只有寵物/植物有台詞；人沒有台詞
 * - 圖上不要任何多餘字或浮水印（除了寵物泡泡）
 */
export async function POST(req) {
  try {
    const { basePhoto, humanPhoto, petType = "cat", petBubble = "我今天超放鬆～" } = await req.json();

    if (!basePhoto || typeof basePhoto !== "string" || !basePhoto.startsWith("data:image/")) {
      return NextResponse.json({ error: "缺少或不合法的 basePhoto（需 data URL）" }, { status: 400 });
    }

    const SIZE = "1024x1280";
    const petZh = petType === "dog" ? "狗" : petType === "plant" ? "植物" : "貓";

    const prompt = [
      "Photorealistic edit based on the first input image (use it as the scene).",
      "Add a miniature human (“tiny person”) whose height is ABOUT ONE-SIXTH of the pet/plant’s height.",
      "The tiny person MUST wear the SAME outfit as in the reference photo (if provided).",
      "Face likeness should be around 80% (recognizable but slightly beautified/handsomer).",
      "Pose and facial expression MUST match the pet/plant’s mood, and the tiny person MUST LOOK AT the pet/plant.",
      `The pet/plant in the scene is: ${petZh}.`,
      `Add ONE comic-style speech bubble NEAR THE ${petZh} ONLY (the human has NO bubble).`,
      `Bubble text (Traditional Chinese): 「${petBubble}」`,
      "Do NOT add any other text, labels, UI elements, or watermarks.",
      "Keep lighting/color/perspective consistent with the base photo.",
    ].join(" ");

    // 第一張：場景底圖；第二張（可選）：本人參考像（提供臉與服裝風格）
    const images = [{ image: basePhoto }];
    if (humanPhoto && typeof humanPhoto === "string" && humanPhoto.startsWith("data:image/")) {
      images.push({ image: humanPhoto });
    }

    const result = await openai.images.edits({
      model: "gpt-image-1",
      image: images,         // 多圖：第一張為底圖，其餘為參考
      prompt,
      size: SIZE,
    });

    const b64 = result?.data?.[0]?.b64_json;
    if (!b64) {
      return NextResponse.json({ error: "生成失敗：無回傳影像" }, { status: 500 });
    }

    return NextResponse.json({ image: `data:image/png;base64,${b64}`, model: "gpt-image-1" });
  } catch (e) {
    return NextResponse.json(
      { error: "Internal error", details: String(e?.message || e) },
      { status: 500 }
    );
  }
}
