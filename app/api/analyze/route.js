// app/api/analyze/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";

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
- 你必須只輸出「單一 JSON 物件」，且 *四個欄位不可缺漏*：
  - state: string（用 1–2 句描述「目前狀態/你觀察到的情形」；務必直白、具體）
  - severity: "low" | "medium" | "high"（整體風險）
  - reply: string（3–5 點具體建議，步驟化，換行或條列）
  - fun: string（詼諧的一句話，必須用第一人稱，好像寵物/植物自己在講話）
另外請同時輸出（若能偵測）：detected_species: "cat"|"dog"|"plant"|"unknown" 與 confidence: number(0..1)。
只輸出 JSON，不要附加任何其他文字。`
        : `You are the image-analysis assistant for a Pets & Plants app.
- No medical diagnosis; advise professional help if risk is high.
- Return ONLY a SINGLE JSON object with these REQUIRED keys:
  - state: string (1–2 sentences describing the current observed condition)
  - severity: "low" | "medium" | "high"
  - reply: string (3–5 actionable bullets/steps)
  - fun: string (a witty one-liner in FIRST PERSON, as if the pet/plant is speaking)
Optionally also include detected_species ("cat"|"dog"|"plant"|"unknown") and confidence (0..1).`;

    const userPrompt =
      lang === "zh"
        ? `使用者目前選擇的物種: ${species || "(未提供)"}。
補充描述: ${userText || "(無)"}。
請先理解照片內容，再依上面的要求產出唯一 JSON。`
        : `User-selected species: ${species || "(n/a)"}.
User notes: ${userText || "(none)"}.
Analyze the photo and return the SINGLE JSON described above.`;

    // Responses API：文字 + 圖片（image_url 需為物件 { url }）
    const resp = await openai.responses.create({
      model: "gpt-4.1-mini",
      temperature: 0.5,
      response_format: { type: "json_object" },
      input: [
        { role: "system", content: sys },
        {
          role: "user",
          content: [
            { type: "input_text", text: userPrompt },
            { type: "input_image", image_url: { url: imageData } },
          ],
        },
      ],
    });

    const text = (resp.output_text || "").trim();
    let parsed = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        try { parsed = JSON.parse(m[0]); } catch {}
      }
    }

    // ---- 正規化 & 保底 ----
    const detectedRaw = parsed?.detected_species;
    const detected =
      detectedRaw === "cat" || detectedRaw === "dog" || detectedRaw === "plant"
        ? detectedRaw
        : "unknown";

    const normSeverity = (v) =>
      v === "low" || v === "medium" || v === "high" ? v : "low";

    const pickFirstSentence = (s = "") =>
      String(s)
        .split(/\n|。|！|!|？|\?/)
        .map((t) => t.trim())
        .filter(Boolean)[0] || "";

    const stateText =
      (typeof parsed?.state === "string" && parsed.state.trim()) ||
      pickFirstSentence(parsed?.reply) ||
      (lang === "zh"
        ? "目前狀態未明確，建議補充更多背景（時間、頻率、環境）。"
        : "Current state unclear; please add timing/frequency/environment.");

    const funText =
      (typeof parsed?.fun === "string" && parsed.fun.trim()) ||
      (lang === "zh"
        ? "我今天有點小小情緒，但把基本需求顧好，我很快就恢復元氣！"
        : "I’m a bit moody today, but take care of the basics and I’ll bounce back soon!");

    const payload = {
      state: stateText,
      severity: normSeverity(parsed?.severity),
      reply:
        typeof parsed?.reply === "string" && parsed.reply.trim()
          ? parsed.reply.trim()
          : lang === "zh"
          ? "資訊有限，請補充年齡、環境、時間與頻率等背景，以獲得更精準建議。"
          : "Info is limited. Please add age, environment, timing/frequency.",
      fun: funText,
      detected_species: detected,
      confidence:
        typeof parsed?.confidence === "number"
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
