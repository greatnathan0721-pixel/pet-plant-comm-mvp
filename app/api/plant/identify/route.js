export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const SYS_PROMPT = `You are a plant identification and health analyst.
Return ONLY a JSON object with keys:
{
  "common_name": string,
  "scientific_name": string,
  "confidence": number,      
  "state": string,           // 植物當下狀態，用繁體中文
  "likely_issues": string[], 
  "care_steps": string[],    
  "severity": "low" | "medium" | "high",
  "fun_one_liner": string    // 植物第一人稱說的一句話
}
Rules:
- All fields required.
- Use Traditional Chinese for all except scientific_name.
- "fun_one_liner" 必須第一人稱（例：我覺得有點渴了）。`;

function estimateBase64SizeKB(dataURL) {
  const base64 = (dataURL || "").split(",")[1] || "";
  const bytes = Math.ceil((base64.length * 3) / 4);
  return Math.round(bytes / 1024);
}

export async function POST(req) {
  try {
    const { imageData, userText = "" } = await req.json();
    if (!imageData || !imageData.startsWith("data:image/")) {
      return NextResponse.json({ error: "Invalid imageData" }, { status: 400 });
    }

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
          { type: "text", text: `使用者補充：${userText || "（無）"}` },
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
      common_name: parsed.common_name || "未知植物",
      scientific_name: parsed.scientific_name || "-",
      confidence: typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0,
      state: parsed.state || "我現在的狀態還不明顯，但請再仔細觀察我的葉片和土壤！",
      likely_issues: Array.isArray(parsed.likely_issues) ? parsed.likely_issues : [],
      care_steps: Array.isArray(parsed.care_steps) ? parsed.care_steps : [],
      severity: parsed.severity || "low",
      fun_one_liner: parsed.fun_one_liner?.trim()
        ? parsed.fun_one_liner
        : "哈囉！我是這株小植物，今天也想被好好照顧 🌱",
    };

    await supabase.from("image_analyses").insert({
      species: "plant",
      user_text: userText,
      image_data: imageData,
      reply: JSON.stringify(payload),
    });

    return NextResponse.json(payload);
  } catch (e) {
    console.error("Plant identify error:", e);
    return NextResponse.json({ error: "Internal error", details: String(e?.message || e) }, { status: 500 });
  }
}
