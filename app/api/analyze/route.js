// app/api/analyze/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";

// 這支 API：分析「寵物照片」並回覆專業建議
// ✨ 新增：要求模型同時回傳 detected_species + confidence
// - detected_species: "cat" | "dog" | "plant" | "unknown"
// - confidence: 0~1

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req) {
  try {
    const body = await req.json();
    const { species, userText = "", imageData, lang = "zh" } = body || {};

    if (!imageData) {
      return NextResponse.json({ error: "Missing imageData" }, { status: 400 });
    }

    const sys =
      lang === "zh"
        ? `你是《寵物植物溝通 App》的圖片分析助理，請用繁體中文、清楚、負責任地回覆。
- 不得做醫療診斷；若風險高，提醒就醫/找專業人士。
- 根據照片與描述，給 3~5 點具體建議（步驟化）。
- 同時請你 *務必* 準確輸出 JSON 欄位：
  - reply: string（專業分析與建議，繁體中文）
  - fun: string（趣味一句話，可愛不喧賓奪主；若無就給空字串）
  - detected_species: "cat" | "dog" | "plant" | "unknown"
  - confidence: 0~1 的數字（你對 detected_species 的信心）
若不確定物種就回 unknown 與 0。`
        : `You are the image-analysis assistant for a Pets & Plants app. Provide clear, safe guidance (no medical diagnosis). Output JSON with:
- reply: string (advice, English)
- fun: string (one-liner, optional)
- detected_species: "cat" | "dog" | "plant" | "unknown"
- confidence: number 0..1 (confidence for detected_species).
If uncertain, return unknown with 0.`;

    const userPrompt =
      lang === "zh"
        ? `使用者選擇的物種: ${species || "(未提供)"}。
補充描述: ${userText || "(無)"}。
請先理解照片內容，再給建議，最後輸出 *唯一* 的 JSON（不要多餘文字）。`
        : `User selected species: ${species || "(n/a)"}.
User notes: ${userText || "(none)"}.
Analyze the photo, then return *only* the JSON described in the system message (no extra text).`;

    // 用 Responses API：傳文字 + 圖片（data URL）
    const resp = await openai.responses.create({
      model: "gpt-4.1-mini",
      temperature: 0.5,
      input: [
        { role: "system", content: sys },
        {
          role: "user",
          content: [
            { type: "input_text", text: userPrompt },
            // 傳入圖片（data URL）
            { type: "input_image", image_url: imageData },
          ],
        },
      ],
    });

    const text = resp.output_text?.trim() || "";
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // 容錯：若不是純 JSON，就嘗試截取 { ... }
      const m = text.match(/\{[\s\S]*\}$/);
      if (m) {
        parsed = JSON.parse(m[0]);
      } else {
        parsed = {};
      }
    }

    const payload = {
      reply: typeof parsed.reply === "string" ? parsed.reply : "（沒有回覆）",
      fun: typeof parsed.fun === "string" ? parsed.fun : "",
      detected_species:
        parsed.detected_species === "cat" ||
        parsed.detected_species === "dog" ||
        parsed.detected_species === "plant"
          ? parsed.detected_species
          : "unknown",
      confidence:
        typeof parsed.confidence === "number"
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0,
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
