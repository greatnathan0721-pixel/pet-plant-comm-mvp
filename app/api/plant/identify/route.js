// app/api/plant/identify/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// 要模型回傳結構化 JSON（繁中，除了學名）
const SYS_PROMPT = `You are a plant identification and health analyst.
Return ONLY a JSON object with keys:
{
  "common_name": string,
  "scientific_name": string,
  "confidence": number,            // 0..1
  "likely_issues": string[],       // e.g. ["Overwatering", "Nitrogen deficiency"]
  "care_steps": string[],          // 3–6 concrete steps
  "severity": "low" | "medium" | "high",
  "fun_one_liner": string          // short, friendly inner monologue in Traditional Chinese
}
- Use Traditional Chinese in all fields except scientific_name.
- "fun_one_liner" should sound like the plant speaking about itself (first person). If mood is bad, keep it witty but gentle.
`;

// 估 dataURL 大小，避免成本爆衝
function estimateBase64SizeKB(dataURL) {
  const base64 = (dataURL || "").split(",")[1] || "";
  const bytes = Math.ceil((base64.length * 3) / 4);
  return Math.round(bytes / 1024);
}

// 簡易第一人稱轉換（繁中）
function forceFirstPersonZh(s = "") {
  let t = String(s || "").trim();

  // 常見第三人稱描述改成第一人稱
  t = t
    .replace(/(這株|這盆|這棵|這顆)?植物(覺得|想|正)/g, "我$2")
    .replace(/(這株|這盆|這棵|這顆)?(花|樹|葉子|多肉|仙人掌)(覺得|想|正)/g, "我$3")
    .replace(/它們/g, "我們")
    .replace(/牠們/g, "我們")
    .replace(/它/g, "我")
    .replace(/牠/g, "我")
    .replace(/本植物/g, "我")
    .replace(/植物我/g, "我");

  // 開頭若像「今天我…」OK；若開頭是名詞描述，補上「我」
  if (/^(看起來|感覺|今天|現在|有點|好像)/.test(t)) {
    // 自然
  } else if (!/^(我|我們)/.test(t)) {
    t = "我" + (t.startsWith("是") ? "" : " ") + t;
  }

  // 結尾句號
  if (!/[。！？!?]$/.test(t)) t += "。";
  return t;
}

export async function POST(req) {
  try {
    const { imageData, userText = "" } = await req.json();

    if (!imageData || !imageData.startsWith("data:image/")) {
      return NextResponse.json({ error: "Invalid imageData (need data URL)" }, { status: 400 });
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
          { type: "image_url", image_url: { url: imageData } }, // ← 物件形式
        ],
      },
    ];

    const chat = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.2,
      response_format: { type: "json_object" },
    });

    const raw = chat?.choices?.[0]?.message?.content?.trim() || "{}";
    let parsed = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
    }

    // ---- 後處理：強制 fun_one_liner 存在且為第一人稱 ----
    let fun = "";
    if (typeof parsed?.fun_one_liner === "string" && parsed.fun_one_liner.trim()) {
      fun = parsed.fun_one_liner.trim();
    }
    if (!fun) {
      fun = "我今天狀態普通，但只要補對光水與通風，很快就會更有精神！";
    }
    parsed.fun_one_liner = forceFirstPersonZh(fun);

    // 友善保底
    if (!Array.isArray(parsed.likely_issues)) parsed.likely_issues = [];
    if (!Array.isArray(parsed.care_steps)) parsed.care_steps = [];
    if (typeof parsed.confidence !== "number") parsed.confidence = 0;

    // 存 DB（沿用 image_analyses 表）
    const summaryText = [
      `名稱：${parsed.common_name || "未知"}（${parsed.scientific_name || "-"}）`,
      `信心：${parsed.confidence}`,
      parsed.likely_issues.length ? `可能問題：${parsed.likely_issues.join("、")}` : "",
      parsed.care_steps.length ? `照護步驟：\n- ${parsed.care_steps.join("\n- ")}` : "",
      `嚴重度：${parsed.severity || "-"}`,
      `趣味：${parsed.fun_one_liner}`,
    ]
      .filter(Boolean)
      .join("\n");

    await supabase.from("image_analyses").insert({
      species: "plant",
      user_text: userText,
      image_data: imageData,
      reply: summaryText,
    });

    return NextResponse.json({ result: parsed, model: "gpt-4o-mini" });
  } catch (e) {
    return NextResponse.json(
      { error: "Internal error", details: String(e?.message || e) },
      { status: 500 }
    );
  }
}
