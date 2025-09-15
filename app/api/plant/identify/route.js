// app/api/plant/identify/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ★ 系統提示：要求輸出結構化 JSON，且 fun_one_liner 必須是「第一人稱」
//   例如：「我今天有點口渴」「我覺得有點曬過頭了」等。
const SYS_PROMPT = `You are a plant identification and health analyst.
Return ONLY a JSON object with keys:
{
  "common_name": string,
  "scientific_name": string,
  "confidence": number,            // 0~1
  "likely_issues": string[],       // e.g. ["Overwatering", "Nitrogen deficiency"]
  "care_steps": string[],          // 3~6 concrete steps, concise and actionable
  "severity": "low" | "medium" | "high",
  "fun_one_liner": string          // Speak in FIRST PERSON as if the plant is talking (e.g., "我今天有點口渴", "我覺得有點曬過頭了")
}
If you are unsure, keep confidence low and list "uncertain".
Use Traditional Chinese for all fields except scientific_name. Output ONLY the JSON object without extra text.`;

// 粗估 base64 data URL 大小（KB）
function estimateBase64SizeKB(dataURL) {
  const base64 = (dataURL || "").split(",")[1] || "";
  const bytes = Math.ceil((base64.length * 3) / 4);
  return Math.round(bytes / 1024);
}

// 將看起來像第三人稱的句子轉成第一人稱（保守處理）
function forceFirstPerson(t) {
  if (!t || typeof t !== "string") return "";
  let s = t.trim();

  // 若以第三人稱主詞開頭，換成第一人稱語氣
  s = s.replace(/^(\s*)(它|這株|那株|這盆|那盆)\s*(覺得|好像|可能|今天|現在)?/i, "$1我$3");
  // 常見英文第三人稱（保險）
  s = s.replace(/\bthe plant\b/gi, "我");
  s = s.replace(/\bit\b/gi, "我");

  // 若全文仍沒有「我」與第一人稱語氣，補一句開場
  if (!/[我]/.test(s)) {
    s = "我想說—" + s.replace(/^(\s*[:：-]\s*)/, "");
  }
  return s;
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
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }

    // ---- 後處理：強制 fun_one_liner 為第一人稱，並填入預設值 ----
    let fun = typeof parsed?.fun_one_liner === "string" ? parsed.fun_one_liner.trim() : "";
    if (!fun) {
      fun = "我現在還說不太清楚，但幫我多觀察幾天吧！";
    }
    fun = forceFirstPerson(fun);
    parsed.fun_one_liner = fun;

    // 組合摘要文字（沿用你現有的存檔方式）
    const summaryText = [
      `名稱：${parsed.common_name || "未知"}（${parsed.scientific_name || "-"}）`,
      `信心：${typeof parsed.confidence === "number" ? parsed.confidence : "-"}`,
      Array.isArray(parsed.likely_issues) && parsed.likely_issues.length
        ? `可能問題：${parsed.likely_issues.join("、")}`
        : "",
      Array.isArray(parsed.care_steps) && parsed.care_steps.length
        ? `照護步驟：\n- ${parsed.care_steps.join("\n- ")}`
        : "",
      `嚴重度：${parsed.severity || "-"}`,
      parsed.fun_one_liner ? `趣味：${parsed.fun_one_liner}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    // 存入 DB（沿用目前的 image_analyses 表，不改 schema）
    try {
      await supabase.from("image_analyses").insert({
        species: "plant",
        user_text: userText,
        image_data: imageData,
        reply: summaryText, // 直接存摘要，方便回顧
      });
    } catch {
      // 寫入失敗不阻斷主要流程
    }

    return NextResponse.json({ result: parsed, model: "gpt-4o-mini" });
  } catch (e) {
    return NextResponse.json(
      { error: "Internal error", details: String(e?.message || e) },
      { status: 500 }
    );
  }
}
