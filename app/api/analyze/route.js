// app/api/analyze/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req) {
  try {
    const body = await req.json();
    const { species, userText = "", imageData, lang = "zh" } = body || {};
    if (!imageData) return NextResponse.json({ error: "Missing imageData" }, { status: 400 });

    const sys =
      lang === "zh"
        ? `你是《寵物植物溝通 App》的圖片分析助理，請用繁體中文、清楚、負責任地回覆。
- 不得做醫療診斷；若風險高，提醒就醫/找專業人士。
- 依照片與描述，給 3~5 點具體建議（步驟化）。
- 你必須回傳唯一「JSON 物件」，欄位（不可缺漏）：
  - reply: string（專業分析與建議，繁體中文）
  - fun: string（一句話，**第一人稱視角**，像是寵物/植物自己說話。例：「我今天超想曬太陽！」、「我有點不舒服，想要安靜一下。」）
  - detected_species: "cat" | "dog" | "plant" | "unknown"
  - confidence: number 0..1（你對 detected_species 的信心）
請只輸出 JSON，不要附加其他文字。`
        : `You are the image-analysis assistant for a Pets & Plants app.
- No medical diagnosis; add "seek professional help" when risk is high.
- Provide 3–5 actionable steps.
- You MUST return a SINGLE JSON object with keys:
  - reply: string (analysis & advice)
  - fun: string (ONE short line in **first-person voice** as if the pet/plant is speaking; e.g., "I'm so ready for sunbathing!")
  - detected_species: "cat" | "dog" | "plant" | "unknown"
  - confidence: number 0..1
Return ONLY the JSON.`

    const userPrompt =
      lang === "zh"
        ? `使用者選擇的物種: ${species || "(未提供)"}。
補充描述: ${userText || "(無)"}。
先理解照片，再產出上面格式的唯一 JSON。`
        : `User-selected species: ${species || "(n/a)"}
User notes: ${userText || "(none)"}
Analyze the photo and return ONLY the JSON.`

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
      if (m) parsed = JSON.parse(m[0]);
    }

    // --- 後處理：確保欄位正確 + fun 一定是第一人稱 ---
    const detectedRaw = parsed?.detected_species;
    const detected =
      detectedRaw === "cat" || detectedRaw === "dog" || detectedRaw === "plant"
        ? detectedRaw
        : "unknown";

    let fun = typeof parsed?.fun === "string" ? parsed.fun.trim() : "";
    if (!fun) {
      fun =
        lang === "zh"
          ? "我今天有點小情緒，但先把水、食物和休息顧好，很快就會恢復元氣！"
          : "I'm a bit moody today, but keep my basics comfy and I’ll bounce back!";
    } else {
      // 簡單偵測是否像第三人稱；若不是第一人稱，補上「我」視角
      const looksThird =
        /他|她|牠|該|這隻|那隻|the cat|the dog|the plant|it\b/i.test(fun) &&
        !/[我|I\b]/.test(fun);
      if (looksThird) {
        fun =
          (lang === "zh" ? "我想說—" : "I feel like this — ") + fun.replace(/^(\s*[:：-]\s*)/, "");
      }
    }

    const payload = {
      reply:
        typeof parsed?.reply === "string" && parsed.reply.trim()
          ? parsed.reply.trim()
          : lang === "zh"
          ? "目前資訊有限，請補充年齡、環境、症狀發生時間與頻率等背景，以獲得更精準建議。"
          : "Info is limited; add age, environment, timing/frequency for better advice.",
      fun,
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
