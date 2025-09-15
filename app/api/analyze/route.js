// app/api/analyze/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

export async function POST(req) {
  try {
    if (!OPENAI_API_KEY) {
      return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    const body = await req.json();
    const { species, userText = "", imageData, lang = "zh" } = body || {};
    if (!imageData) {
      return NextResponse.json({ error: "Missing imageData" }, { status: 400 });
    }

    const schema = {
      type: "object",
      properties: {
        current_state: { type: "string" },          // ← 必填：狀態判讀（1–2 句）
        reply: { type: "string" },                  // 專業建議（3–5 點）
        fun: { type: "string" },                    // 趣味一句話（可為空字串）
        detected_species: {
          type: "string",
          enum: ["cat", "dog", "plant", "unknown"]
        },
        confidence: { type: "number" }              // 0..1
      },
      required: ["current_state", "reply", "detected_species", "confidence"],
      additionalProperties: false
    };

    const sys =
      lang === "zh"
        ? `你是《寵物植物溝通 App》的圖片分析助理，請用繁體中文、清楚且負責任地回覆。
規則：
- 不得做醫療診斷；若風險高，提醒就醫/找專業人士。
- 僅輸出 JSON（不要多餘文字），結構與類型必須符合提供的 JSON Schema。
- 欄位定義：
  • current_state：1–2 句，描述你從照片判讀到「當下狀態／可能情境」（例如：葉片下垂、眼周分泌物、居家環境可能不足刺激…等）。
  • reply：3–5 點具體可執行的步驟化建議。
  • fun：趣味一句話（可愛但不喧賓奪主）；若沒有靈感可回空字串 ""。
  • detected_species：cat/dog/plant/unknown
  • confidence：0..1，對 detected_species 的信心。
- 若無法判斷物種就回 unknown 與 0。`
        : `You are the image-analysis assistant for a Pets & Plants app.
Rules:
- No medical diagnosis; if risk is high, advise to seek a vet/professional.
- Output JSON only (no extra text) and conform to the provided JSON Schema.
- Fields:
  • current_state: 1–2 sentences describing what the photo suggests *right now*.
  • reply: 3–5 actionable bullet points.
  • fun: one-liner (may be empty "").
  • detected_species: cat/dog/plant/unknown
  • confidence: 0..1
- If uncertain, return unknown and 0.`;

    const userPrompt =
      lang === "zh"
        ? `使用者選擇的物種：${species || "(未提供)"}。
補充描述：${userText || "(無)"}。
請分析上傳的照片，並依 JSON Schema 嚴格輸出唯一 JSON。`
        : `User selected species: ${species || "(n/a)"}.
User notes: ${userText || "(none)"}.
Analyze the uploaded image and return JSON strictly matching the schema.`;

    // ✅ 使用 chat.completions + response_format json_schema，並正確包 { url: ... }
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_schema", json_schema: { name: "analysis", schema, strict: true } },
      messages: [
        { role: "system", content: sys },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            { type: "image_url", image_url: { url: imageData } }
          ]
        }
      ]
    });

    const raw = resp?.choices?.[0]?.message?.content || "";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // 後援：嘗試從文字中擷取 JSON 物件
      const m = String(raw).match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : {};
    }

    // ---- 後處理保險：若模型仍漏欄位，這裡補位 ----
    const safe = (v) => (typeof v === "string" ? v.trim() : "");
    const reply = safe(parsed.reply);
    const current_state = safe(parsed.current_state) || reply.split(/[。\n]/)[0]?.slice(0, 60) || "目前狀態未明確，建議先觀察並補充描述。";
    const fun = safe(parsed.fun) || "";
    const detected =
      ["cat", "dog", "plant"].includes(parsed.detected_species) ? parsed.detected_species : "unknown";
    const conf = typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0;

    return NextResponse.json({
      current_state,
      reply: reply || "（沒有回覆）",
      fun,
      detected_species: detected,
      confidence: conf
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Internal error", details: String(e?.message || e) }, { status: 500 });
  }
}
