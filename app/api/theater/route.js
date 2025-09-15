// app/api/theater/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * 生成「小人國」合成圖（方法 B：AI 生成）
 * 需求重點：
 * - 小人國比例 ≈ 寵物/植物高度的 1/6
 * - 臉 80% 相似使用者照片，只能更帥/更美；穿原始服裝
 * - 姿勢、表情呼應寵物心情；視線看向寵物
 * - 氣泡：漫畫風、只有寵物/植物有台詞（人沒有台詞）
 * - 圖上不要任何多餘文字或浮水印（除了寵物的對話泡泡）
 */
export async function POST(req) {
  try {
    const { basePhoto, humanPhoto, petType = "cat", petBubble = "我今天超放鬆～" } = await req.json();

    if (!basePhoto || !basePhoto.startsWith("data:image/")) {
      return NextResponse.json({ error: "缺少或不合法的 basePhoto（data URL）" }, { status: 400 });
    }

    // 尺寸：直式貼近你現在版面
    const SIZE = "1024x1280";

    // 規範化寵物/植物描述
    const PET_ZH = petType === "dog" ? "狗" : petType === "plant" ? "植物" : "貓";

    // 圖像生成提示（英文較穩定，內含中文關鍵）
    const prompt = [
      "Create a single photorealistic image from the provided base image.",
      "Add a miniature human (\"tiny person\") at approximately ONE-SIXTH of the pet/plant's height.",
      "The tiny person must wear the SAME outfit as in the reference photo (do not invent new clothes).",
      "Face likeness should be ~80% similar to the reference: recognizably the same person but slightly enhanced (more handsome/beautiful).",
      "Pose and facial expression MUST match the pet/plant's mood, and the tiny person must LOOK AT the pet/plant.",
      `The subject is a ${PET_ZH} in the base image.`,
      "Add a single comic-style speech bubble near the pet/plant ONLY (the human has NO bubble).",
      `Bubble text (Traditional Chinese): 「${petBubble}」`,
      "Do NOT add any other text, labels, watermarks, or UI elements.",
      "Keep lighting, color tone and perspective coherent with the base image.",
    ].join(" ");

    // 我們優先用「image edit」方式，將 basePhoto 當做底圖；
    // 若有人像，當做參考影像一起丟入，模型會做樣貌/服裝遷移。
    // （gpt-image-1 支援不帶 mask 的全圖編輯）
    const images = [{ image: basePhoto }];

    // 可選的人像參考
    if (humanPhoto && humanPhoto.startsWith("data:image/")) {
      images.push({ image: humanPhoto });
    }

    const result = await openai.images.edits({
      model: "gpt-image-1",
      // 多張輸入：第一張視為底圖，其餘作為參考
      image: images,
      prompt,
      size: SIZE,
      // 加一點鋒利度與寫實感
      // （如果覺得太銳利可以調低）
      // NOTE: 有些版本無此參數可忽略；保留兼容性
      // sharpness: 0.2,
    });

    const b64 = result?.data?.[0]?.b64_json;
    if (!b64) {
      return NextResponse.json({ error: "生成失敗，沒有回傳影像" }, { status: 500 });
    }

    const dataUrl = `data:image/png;base64,${b64}`;
    return NextResponse.json({ image: dataUrl, model: "gpt-image-1" });
  } catch (e) {
    return NextResponse.json(
      { error: "Internal error", details: String(e?.message || e) },
      { status: 500 }
    );
  }
}
