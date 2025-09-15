export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ✳️ 要點：文字解析一律第三人稱；只有 fun_one_liner 必須第一人稱
const SYS_PROMPT = `You are a pet communication and behavior analyst.
Return ONLY a JSON object with keys:
{
  "state": string,           // 目前寵物的狀態（繁體中文）→ 必須用第三人稱描述，例如「牠看起來…」「這隻貓咪…」
  "issues": string[],        // 可能問題（第三人稱）
  "suggestions": string[],   // 建議的改善方式（步驟化、第三人稱）
  "severity": "low" | "medium" | "high",
  "fun_one_liner": string    // 寵物用第一人稱說的一句話（例：我今天好舒服！）
}
Rules:
- All fields required.
- 「state / issues / suggestions」都要用第三人稱描述（牠、這隻狗、該動物…），不得出現第一人稱。
- 「fun_one_liner」必須用第一人稱，友善、簡短，不能為空。`;

function estimateBase64SizeKB(dataURL) {
  const base64 = (dataURL || "").split(",")[1] || "";
  const bytes = Math.ceil((base64.length * 3) / 4);
  return Math.round(bytes / 1024);
}

export async function POST(req) {
  try {
    const { species = "cat", userText = "", imageData, lang = "zh" } = await req.json();

    if (!imageData || !imageData.startsWith("data:image/")) {
      return NextResponse.json({ error: "Invalid imageData" }, { status: 400 });
    }

    // 成本保護：限制大小（與前端壓縮策略一致）
    const sizeKB = estimateBase64SizeKB(imageData);
    if (sizeKB > 700) {
      return NextResponse.json(
        { error: `Image too large (${sizeKB}KB). 請壓縮（建議最長邊 720、品質 0.7）。` },
        { status: 413 }
      );
    }

    const messages = [
      { role: "system", content: SYS_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: `物種：${species}；補充：${userText || "（無）"}` },
          { type: "image_url", image_url: { url: imageData } }
        ],
      },
    ];

    const chat = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.3,
      response_format: { type: "json_object" }
    });

    const raw = chat?.choices?.[0]?.message?.content?.trim() || "{}";
    let parsed = {};
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }

    const payload = {
      // 文字解析（第三人稱）
      state: parsed.state || "目前狀態不明顯，建議持續觀察牠的食慾、活動量與排泄狀況。",
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      severity: parsed.severity || "low",
      // 圖片泡泡（第一人稱）
      fun_one_liner: parsed.fun_one_liner?.trim()
        ? parsed.fun_one_liner
        : "我今天心情不錯，想多睡一會兒～",
    };

    // 可選：存 DB 方便回顧
    await supabase.from("image_analyses").insert({
      species,
      user_text: userText,
      image_data: imageData,
      reply: JSON.stringify(payload),
    });

    return NextResponse.json(payload);
  } catch (e) {
    console.error("Analyze error:", e);
    return NextResponse.json({ error: "Internal error", details: String(e?.message || e) }, { status: 500 });
  }
}
