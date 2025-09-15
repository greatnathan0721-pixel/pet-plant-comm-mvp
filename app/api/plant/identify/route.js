// app/api/plant/identify/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// 同一個可愛化工具（植物版）
function polishOneLinerPlant(text, lang = "zh") {
  let t = String(text || "").trim();
  const junk = [/^我覺得[，、:\s]?/, /^看起來[，、:\s]?/, /^似乎[，、:\s]?/, /^可能[，、:\s]?/];
  junk.forEach((re) => (t = t.replace(re, "")));
  // 若沒第一人稱，補「本葉」
  if (!/^(我|本葉|本花|本苗)/.test(t)) t = "本葉" + (t.startsWith("是") ? "" : " ") + t;
  if (lang === "zh") {
    const limit = 22;
    let count = 0, out = "";
    for (const ch of t) { count += 1; if (count > limit) break; out += ch; }
    t = out;
  } else {
    t = t.split(/\s+/).slice(0, 12).join(" ");
  }
  if (!/[。！!?～]$/.test(t)) t += (lang === "zh" ? "～" : "~");
  return t;
}

export async function POST(req) {
  try {
    const { imageData, userText = "", lang = "zh" } = await req.json();
    if (!imageData || !imageData.startsWith("data:image/")) {
      return NextResponse.json({ error: "Invalid imageData (need data URL)" }, { status: 400 });
    }

    const SYS =
      lang === "zh"
        ? `你是植物辨識與照護顧問，回覆**只用繁體中文**，輸出單一 JSON：
{
  "common_name": string,
  "scientific_name": string,
  "confidence": number,            // 0~1
  "state": string,                 // 第三人稱，2~4 句描述目前狀態（葉色/挺度/病蟲跡象/環境）
  "likely_issues": string[],       // 0~4 可能問題（精煉）
  "care_steps": string[],          // 3~6 具體照護步驟（動詞開頭）
  "severity": "low" | "medium" | "high",
  "fun_one_liner": string          // 植物第一人稱的短句、可愛自然、<= 22 字，不要#與顏文字
}
注意：
- "state" 與 "care_steps" 用第三人稱。
- "fun_one_liner" 用第一人稱（我/本葉/本花），像是植物的心聲。
- 禁止醫療診斷；高風險請在 care_steps 提醒「找專業」。`
        : `You are a plant ID & care assistant. Output ONE JSON only:
{
  "common_name": string,
  "scientific_name": string,
  "confidence": number,
  "state": string,
  "likely_issues": string[],
  "care_steps": string[],
  "severity": "low" | "medium" | "high",
  "fun_one_liner": string
}
No diagnosis. If high risk, add "seek a professional" in care_steps.`;

    const USER =
      lang === "zh"
        ? `使用者補充：${userText || "（無）"}。\n請先辨識再產出 JSON。`
        : `User notes: ${userText || "(none)"}\nIdentify first, then return JSON.`;

    const chat = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYS },
        {
          role: "user",
          content: [
            { type: "text", text: USER },
            { type: "image_url", image_url: { url: imageData } },
          ],
        },
      ],
    });

    const raw = chat?.choices?.[0]?.message?.content?.trim() || "{}";
    let parsed = {};
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }

    // 保險：可愛第一人稱
    const fun = polishOneLinerPlant(parsed.fun_one_liner, lang);

    const result = {
      common_name: parsed.common_name || "",
      scientific_name: parsed.scientific_name || "",
      confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0,
      state: typeof parsed.state === "string" ? parsed.state.trim() : "",
      likely_issues: Array.isArray(parsed.likely_issues) ? parsed.likely_issues.slice(0, 4) : [],
      care_steps: Array.isArray(parsed.care_steps) ? parsed.care_steps.slice(0, 6) : [],
      severity: /^(low|medium|high)$/.test(parsed.severity || "") ? parsed.severity : "low",
      fun_one_liner: fun,
      model: "gpt-4o-mini",
    };

    // 可選：儲存摘要（沿用既有表）
    const summary = [
      result.common_name ? `名稱：${result.common_name} (${result.scientific_name || "-"})` : "",
      `信心：${Math.round(result.confidence * 100)}%`,
      result.state ? `狀態：${result.state}` : "",
      result.likely_issues?.length ? `可能問題：${result.likely_issues.join("、")}` : "",
      result.care_steps?.length ? `照護步驟：\n- ${result.care_steps.join("\n- ")}` : "",
      `嚴重度：${result.severity}`,
      result.fun_one_liner ? `趣味：${result.fun_one_liner}` : "",
    ].filter(Boolean).join("\n");

    try {
      await supabase.from("image_analyses").insert({
        species: "plant",
        user_text: userText,
        image_data: imageData,
        reply: summary,
      });
    } catch (_) {
      // 忽略儲存錯誤，避免影響使用者流程
    }

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: "Internal error", details: String(e?.message || e) }, { status: 500 });
  }
}
