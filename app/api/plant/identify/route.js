// app/api/plant/identify/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ---- helpers ----
function estimateBase64SizeKB(dataURL) {
  const base64 = (dataURL || "").split(",")[1] || "";
  const bytes = Math.ceil((base64.length * 3) / 4);
  return Math.round(bytes / 1024);
}

function cleanFirstPersonLine(t = "") {
  let s = String(t || "").trim();
  s = s.replace(/^(我)?(覺得|想|認為|感覺|好像|看起來|似乎|可能)[，,:：\s]*/u, "");
  s = s.replace(/(其|牠|它|該)植物/g, "我");
  s = s.replace(/(它|牠)/g, "我");
  if (!/^我/.test(s)) s = "我" + s;
  if (!s || s === "我") s = "我想伸展枝葉，曬曬太陽～";
  const MAX = 24;
  if ([...s].length > MAX) s = [...s].slice(0, MAX - 1).join("") + "…";
  if (!/[。！？!]$/.test(s)) s += "！";
  return s;
}

export async function POST(req) {
  try {
    const { imageData, userText = "" } = await req.json();
    if (!imageData || !imageData.startsWith("data:image/")) {
      return NextResponse.json({ error: "Invalid imageData (need data URL)" }, { status: 400 });
    }

    // 控成本：限制大小
    const sizeKB = estimateBase64SizeKB(imageData);
    if (sizeKB > 700) {
      return NextResponse.json(
        { error: `Image too large (${sizeKB}KB). 請壓縮（建議最長邊 720、品質 0.7）。` },
        { status: 413 }
      );
    }

    const SYS = `You are a plant identification and health analyst.
Return ONLY a JSON object with keys (Traditional Chinese for all except scientific_name):
{
  "common_name": string,
  "scientific_name": string,
  "confidence": number,            // 0..1
  "likely_issues": string[],       // third-person
  "care_steps": string[],          // 3..6 actionable, third-person
  "severity": "low" | "medium" | "high",
  "fun_one_liner": string          // first-person (starts with "我"), <=24 Chinese chars, no "我覺得/看起來/似乎/可能/它/牠"
}
If unsure, keep confidence low and include "uncertain" in likely_issues.`;

    const chat = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.25,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYS },
        {
          role: "user",
          content: [
            { type: "text", text: `使用者補充：${userText || "（無）"}` },
            { type: "image_url", image_url: { url: imageData } },
          ],
        },
      ],
    });

    const raw = chat?.choices?.[0]?.message?.content?.trim() || "{}";
    let parsed = {};
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }

    // 後處理：欄位與型別兜底
    const result = {
      common_name: typeof parsed.common_name === "string" ? parsed.common_name : "未知",
      scientific_name: typeof parsed.scientific_name === "string" ? parsed.scientific_name : "",
      confidence:
        typeof parsed.confidence === "number"
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0,
      likely_issues: Array.isArray(parsed.likely_issues) ? parsed.likely_issues : [],
      care_steps: Array.isArray(parsed.care_steps) ? parsed.care_steps : [],
      severity: ["low", "medium", "high"].includes(parsed.severity) ? parsed.severity : "low",
      fun_one_liner: cleanFirstPersonLine(parsed.fun_one_liner),
    };

    // 存入 DB（延續你原本的寫法）
    const summaryText = [
      `名稱：${result.common_name} (${result.scientific_name || "-"})`,
      `信心：${result.confidence}`,
      result.likely_issues?.length ? `可能問題：${result.likely_issues.join("、")}` : "",
      result.care_steps?.length ? `照護步驟：\n- ${result.care_steps.join("\n- ")}` : "",
      `嚴重度：${result.severity}`,
      result.fun_one_liner ? `趣味：${result.fun_one_liner}` : "",
    ].filter(Boolean).join("\n");

    await supabase.from("image_analyses").insert({
      species: "plant",
      user_text: userText,
      image_data: imageData,
      reply: summaryText, // 仍存摘要
    });

    return NextResponse.json({ result, model: "gpt-4o-mini" });
  } catch (e) {
    return NextResponse.json({ error: "Internal error", details: String(e?.message || e) }, { status: 500 });
  }
}
