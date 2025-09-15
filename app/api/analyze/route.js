// app/api/analyze/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY" },
        { status: 500 }
      );
    }

    const body = await req.json();
    const { species, userText = "", imageData, lang = "zh" } = body || {};
    if (!imageData || typeof imageData !== "string") {
      return NextResponse.json({ error: "Missing imageData" }, { status: 400 });
    }

    const sys =
      lang === "zh"
        ? `你是《寵物植物溝通 App》的圖片分析助理，請用繁體中文、清楚、負責任地回覆。
- 不得做醫療診斷；若風險高，提醒就醫/找專業人士。
- 根據照片與描述，給 3~5 點具體建議（步驟化）。
- 你必須輸出「單一 JSON 物件」，欄位如下（不可缺漏）：
  - reply: string（專業分析與建議，繁體中文）
  - fun: string（詼諧的一句話，把寵物/植物的心情轉譯出來；就算狀況不好，也要用輕鬆方式表達，不可為空）
  - detected_species: "cat" | "dog" | "plant" | "unknown"
  - confidence: number 0..1（你對 detected_species 的信心）
請只輸出 JSON，不要附加任何其他文字。`
        : `You are the image-analysis assistant for a Pets & Plants app.
- No medical diagnosis; if risk is high, advise to seek professional help.
- Provide 3–5 actionable bullet points.
- You MUST return a SINGLE JSON object with the following keys (no extra text):
  - reply: string (analysis & advice)
  - fun: string (a witty one-liner “inner monologue”; REQUIRED even if the mood is bad)
  - detected_species: "cat" | "dog" | "plant" | "unknown"
  - confidence: number 0..1 (confidence for detected_species).`;

    const userPrompt =
      lang === "zh"
        ? `使用者選擇的物種: ${species || "(未提供)"}。
補充描述: ${userText || "(無)"}。
請先理解照片內容，再依上面的要求產出唯一 JSON。`
        : `User-selected species: ${species || "(n/a)"}.
User notes: ${userText || "(none)"}.
Analyze the photo and return the SINGLE JSON described above.`;

    // ✅ 用 chat.completions（相容 openai@4.58.1）
    const chat = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.5,
      response_format: { type: "json_object" },
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

    const text = chat.choices?.[0]?.message?.content?.trim() || "";
    let parsed = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
    }

    // 正規化
    const validSpecies = new Set(["cat", "dog", "plant"]);
    const detected = validSpecies.has(parsed?.detected_species)
      ? parsed.detected_species
      : "unknown";

    const payload = {
      reply:
        typeof parsed?.reply === "string" && parsed.reply.trim()
          ? parsed.reply.trim()
          : (lang === "zh"
              ? "目前資訊有限，請補充更多背景（年齡、環境、發作時間、頻率等），以獲得更精準建議。"
              : "Info is limited. Please add age, environment, timing/frequency for better advice."),
      // 一定給一個不為空的詼諧一句話
      fun:
        typeof parsed?.fun === "string" && parsed.fun.trim()
          ? parsed.fun.trim()
          : (lang === "zh"
              ? "嗯…今天情緒有點小打結，但先把水、食、環境顧好，我很快就復活！"
              : "Hmm… a little knotted today, but with water, food and comfort I’ll bounce back soon!"),
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
