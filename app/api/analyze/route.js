// app/api/analyze/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// 估算 dataURL 大小（KB）
function estimateBase64SizeKB(dataURL) {
  const base64 = (dataURL || "").split(",")[1] || "";
  const bytes = Math.ceil((base64.length * 3) / 4); // 4/3 轉換
  return Math.round(bytes / 1024);
}

function sysPrompt(lang) {
  return lang === "zh"
    ? `你是《寵物植物溝通 App》助理，用繁體中文回答。
請根據使用者的照片與描述，輸出：
1) 情境解讀（2-3句）
2) 專業建議（3-5點，具體步驟）
3) 趣味一句話（可愛但不喧賓奪主）
必要時提醒就醫/專業協助。不做醫療診斷。`
    : `You are the Pets & Plants Communication assistant.
From the photo and the user's note, provide:
1) Situation interpretation (2–3 sentences)
2) Professional advice (3–5 actionable bullets)
3) Fun one-liner (subtle)
Add vet/pro-help warning when risk is high. No medical diagnosis.`;
}

export async function POST(req) {
  try {
    const { species = "cat", userText = "", imageData, lang = "zh" } = await req.json();

    if (!imageData || !imageData.startsWith("data:image/")) {
      return NextResponse.json(
        { error: "Invalid imageData: expecting data URL (data:image/...;base64,...)" },
        { status: 400 }
      );
    }

    // ⛔️ 大小限制：700KB（可依需求調整）
    const sizeKB = estimateBase64SizeKB(imageData);
    if (sizeKB > 700) {
      return NextResponse.json(
        { error: `Image too large (${sizeKB}KB). 請用較小尺寸上傳（建議最長邊 720、品質 0.7）。` },
        { status: 413 } // Payload Too Large
      );
    }

    const messages = [
      { role: "system", content: sysPrompt(lang) },
      {
        role: "user",
        content: [
          { type: "text", text: `物種: ${species}\n使用者描述: ${userText || "（無）"}` },
          { type: "image_url", image_url: { url: imageData } },
        ],
      },
    ];

    // 呼叫 GPT-4o-mini（支援 Vision）
    const chat = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.5,
    });

    const text = chat?.choices?.[0]?.message?.content?.trim() || "（沒有回覆）";

    // 寫入 DB（短期用 Base64 存，之後可改 Storage URL）
    const { error: dbError } = await supabase.from("image_analyses").insert({
      species,
      user_text: userText,
      image_data: imageData,
      reply: text,
    });
    if (dbError) console.error("寫入 image_analyses 錯誤：", dbError);

    return NextResponse.json({ reply: text, model: "gpt-4o-mini" });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Internal error", details: String(e?.message || e) },
      { status: 500 }
    );
  }
}
