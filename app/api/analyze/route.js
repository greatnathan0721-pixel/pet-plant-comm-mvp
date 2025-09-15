// app/api/analyze/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";

// ✅ 使用新版 SDK：用 chat.completions.create 來做「文字 + 圖片」分析
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// 小工具：把 dataURL 或 URL 包成 image_url 物件（新版格式）
function toImageContent(image) {
  // 支援 data:image/... 或 https://
  const isDataUrl = typeof image === "string" && image.startsWith("data:image/");
  const isHttpUrl =
    typeof image === "string" &&
    (image.startsWith("http://") || image.startsWith("https://"));
  if (!isDataUrl && !isHttpUrl) {
    throw new Error("Invalid imageData (must be data URL or http(s) URL).");
  }
  return { type: "image_url", image_url: image };
}

export async function POST(req) {
  try {
    if (!OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY" },
        { status: 500 }
      );
    }

    const body = await req.json();
    const { species, userText = "", imageData, lang = "zh" } = body || {};

    if (!imageData) {
      return NextResponse.json({ error: "Missing imageData" }, { status: 400 });
    }

    const sys =
      lang === "zh"
        ? `你是《寵物植物溝通 App》的圖片分析助理，請用繁體中文、清楚、負責任地回覆：
- 不得做醫療診斷；若風險高，提醒就醫/找專業人士。
- 根據照片與描述，給 3~5 點具體建議（步驟化）。
- 只輸出「唯一一個 JSON 物件」，結構如下（不要額外文字）：
{
  "reply": string,                // 專業分析與建議
  "fun": string,                  // 趣味一句話（可空字串）
  "detected_species": "cat" | "dog" | "plant" | "unknown",
  "confidence": number            // 0..1，對 detected_species 的信心
}`
        : `You are the image-analysis assistant for a Pets & Plants app. Be clear and safe (no medical diagnosis).
Return *only one JSON object* with:
{
  "reply": string,
  "fun": string,
  "detected_species": "cat" | "dog" | "plant" | "unknown",
  "confidence": number  // 0..1
}`;

    const userPrompt =
      lang === "zh"
        ? `使用者選擇的物種: ${species || "(未提供)"}。
補充描述: ${userText || "(無)"}。
請先理解照片內容，再給建議，最後輸出唯一 JSON（不要多餘文字）。`
        : `User selected species: ${species || "(n/a)"}.
User notes: ${userText || "(none)"}.
Analyze the photo and return only the JSON described by the system message.`;

    // ✅ 新版：chat.completions.create + multimodal content
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.5,
      messages: [
        { role: "system", content: sys },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            toImageContent(imageData),
          ],
        },
      ],
    });

    const raw = resp?.choices?.[0]?.message?.content?.trim() || "";
    // 嘗試解析唯一 JSON；若模型前後多餘字，擷取最後一組 {...}
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}$/);
      if (m) parsed = JSON.parse(m[0]);
      else parsed = {};
    }

    // 保障欄位型別與範圍
    const allowedSpecies = new Set(["cat", "dog", "plant", "unknown"]);
    const detected =
      typeof parsed.detected_species === "string" &&
      allowedSpecies.has(parsed.detected_species)
        ? parsed.detected_species
        : "unknown";

    let confidence = 0;
    if (typeof parsed.confidence === "number" && isFinite(parsed.confidence)) {
      confidence = Math.max(0, Math.min(1, parsed.confidence));
    }

    const payload = {
      reply:
        typeof parsed.reply === "string" && parsed.reply.trim()
          ? parsed.reply.trim()
          : lang === "zh"
          ? "（沒有回覆）"
          : "(no reply)",
      fun:
        typeof parsed.fun === "string"
          ? parsed.fun
          : "",

      detected_species: detected,
      confidence,
    };

    return NextResponse.json(payload);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Internal error", details: String(e?.message || e) },
      { status: 500 }
    );
  }
}
