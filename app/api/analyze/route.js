// app/api/analyze/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";

// 這支 API：分析寵物/植物照片，回覆專業建議 + 必有詼諧一句話(fun)
// 另外回傳 detected_species 與 confidence 以便自動偵測物種。

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 將看起來像第三人稱的句子轉成第一人稱（保守處理）
function forceFirstPerson(t) {
  if (!t || typeof t !== "string") return "";
  let s = t.trim();
  s = s.replace(/^(\s*)(牠|它|這隻|那隻|這株|那株|這盆|那盆)\s*(覺得|好像|可能|今天|現在)?/i, "$1我$3");
  s = s.replace(/\b(the (cat|dog|pet|animal|plant)|it)\b/gi, "我");
  if (!/[我]/.test(s)) s = "我想說—" + s.replace(/^(\s*[:：-]\s*)/, "");
  return s;
}

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
- 你必須輸出「單一 JSON 物件」，欄位如下（不可缺漏）：
  - reply: string（專業分析與建議，繁體中文）
  - fun: string（第一人稱、詼諧的一句話，把寵物/植物的心情轉譯出來；就算狀況不好，也要用輕鬆方式表達，不可為空）
  - detected_species: "cat" | "dog" | "plant" | "unknown"
  - confidence: number 0..1（你對 detected_species 的信心）
請只輸出 JSON，不要附加任何其他文字。`
        : `You are the image-analysis assistant for a Pets & Plants app.
- No medical diagnosis; if risk is high, advise to seek professional help.
- Provide 3–5 actionable bullet points.
- You MUST return a SINGLE JSON object with:
  - reply: string (analysis & advice)
  - fun: string (witty FIRST-PERSON one-liner; REQUIRED even if mood is bad)
  - detected_species: "cat" | "dog" | "plant" | "unknown"
  - confidence: number 0..1 (confidence for detected_species).
Return ONLY the JSON object.`;

    const userPrompt =
      lang === "zh"
        ? `使用者目前選擇的物種: ${species || "(未提供)"}。
補充描述: ${userText || "(無)"}。`
        : `User-selected species: ${species || "(n/a)"}.
User notes: ${userText || "(none)"}.
Analyze the photo and follow the JSON schema.`;

    // ✅ 使用 Chat Completions（與 plant 路由同風格、穩定）
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

    const raw = chat?.choices?.[0]?.message?.content?.trim() || "{}";
    let parsed = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
    }

    // 後處理：欄位健全 + fun 一律第一人稱 & 有預設
    const detectedRaw = parsed?.detected_species;
    const detected =
      detectedRaw === "cat" || detectedRaw === "dog" || detectedRaw === "plant"
        ? detectedRaw
        : "unknown";

    let fun = typeof parsed?.fun === "string" ? parsed.fun.trim() : "";
    if (!fun) {
      fun =
        lang === "zh"
          ? "我今天有點小情緒，但先把基本需求照顧好，我很快就恢復元氣！"
          : "I’m not in the best mood, but take care of the basics and I’ll bounce back soon!";
    }
    fun = forceFirstPerson(fun);

    const payload = {
      reply:
        typeof parsed?.reply === "string" && parsed.reply.trim()
          ? parsed.reply.trim()
          : lang === "zh"
          ? "目前資訊有限，請補充年齡、環境、發生時間/頻率等，以獲得更精準建議。"
          : "Info is limited. Please add age, environment, timing/frequency for better advice.",
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
