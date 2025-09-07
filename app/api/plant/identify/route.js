// app/api/plant/identify/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// 請模型輸出結構化 JSON，方便前端顯示
const SYS_PROMPT = `You are a plant identification and health analyst.
Return ONLY a JSON object with keys:
{
  "common_name": string,
  "scientific_name": string,
  "confidence": number,            // 0~1
  "likely_issues": string[],       // e.g. ["Overwatering", "Nitrogen deficiency"]
  "care_steps": string[],          // 3~6 concrete steps
  "severity": "low" | "medium" | "high",
  "fun_one_liner": string          // short, friendly
}
If you are unsure, keep confidence low and list "uncertain". Use Traditional Chinese in all fields except scientific_name.`;

function estimateBase64SizeKB(dataURL) {
  const base64 = (dataURL || "").split(",")[1] || "";
  const bytes = Math.ceil((base64.length * 3) / 4);
  return Math.round(bytes / 1024);
}

export async function POST(req) {
  try {
    const { imageData, userText = "" } = await req.json();
    if (!imageData || !imageData.startsWith("data:image/")) {
      return NextResponse.json({ error: "Invalid imageData (need data URL)" }, { status: 400 });
    }
    // 與既有策略一致：限制大小，避免成本爆掉
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
          { type: "image_url", image_url: { url: imageData } },
        ],
      },
    ];

    const chat = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.2,
      response_format: { type: "json_object" }, // 要求回傳 JSON
    });

    const raw = chat?.choices?.[0]?.message?.content?.trim() || "{}";
    let parsed = {};
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }

    // 存入 DB（沿用目前的 image_analyses 表，不改 schema）
    const summaryText = [
      `名稱：${parsed.common_name || "未知"} (${parsed.scientific_name || "-"})`,
      `信心：${parsed.confidence ?? "-"}`,
      parsed.likely_issues?.length ? `可能問題：${parsed.likely_issues.join("、")}` : "",
      parsed.care_steps?.length ? `照護步驟：\n- ${parsed.care_steps.join("\n- ")}` : "",
      `嚴重度：${parsed.severity || "-"}`,
      parsed.fun_one_liner ? `趣味：${parsed.fun_one_liner}` : "",
    ].filter(Boolean).join("\n");

    await supabase.from("image_analyses").insert({
      species: "plant",
      user_text: userText,
      image_data: imageData,
      reply: summaryText, // 直接存摘要，方便回顧
    });

    return NextResponse.json({ result: parsed, model: "gpt-4o-mini" });
  } catch (e) {
    return NextResponse.json({ error: "Internal error", details: String(e?.message || e) }, { status: 500 });
  }
}
