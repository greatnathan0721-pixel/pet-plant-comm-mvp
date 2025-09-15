// app/api/analyze/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

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
        ? `你是《寵物植物溝通 App》的圖片分析助理，請用繁體中文、清楚、負責任地回覆。
- 不得做醫療診斷；若風險高，提醒就醫/找專業人士。
- 根據照片與描述，給 3~5 點具體建議（步驟化）。
- 僅輸出 JSON 物件，結構如下：
{
  "reply": string,
  "fun": string,
  "detected_species": "cat" | "dog" | "plant" | "unknown",
  "confidence": number
}`
        : `You are the image-analysis assistant for a Pets & Plants app.
Return only JSON:
{
  "reply": string,
  "fun": string,
  "detected_species": "cat" | "dog" | "plant" | "unknown",
  "confidence": number
}`;

    const userPrompt =
      lang === "zh"
        ? `使用者選擇的物種: ${species || "(未提供)"}。
補充描述: ${userText || "(無)" }。
請先理解照片內容，再回覆唯一 JSON。`
        : `User selected species: ${species || "(n/a)"}.
User notes: ${userText || "(none)"}.
Analyze the photo, then return only the JSON.`;

    // ✅ 注意 image_url 格式要用 { url: "..." }
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.5,
      messages: [
        { role: "system", content: sys },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            { type: "image_url", image_url: { url: imageData } },
          ],
        },
      ],
    });

    const raw = resp?.choices?.[0]?.message?.content?.trim() || "";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : {};
    }

    return NextResponse.json({
      reply: parsed.reply || "（沒有回覆）",
      fun: parsed.fun || "",
      detected_species: ["cat", "dog", "plant"].includes(parsed.detected_species)
        ? parsed.detected_species
        : "unknown",
      confidence:
        typeof parsed.confidence === "number"
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Internal error", details: String(e?.message || e) },
      { status: 500 }
    );
  }
}
