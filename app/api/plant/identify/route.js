// app/api/plant/identify/route.js
import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const S = (v, fb="") => (typeof v === "string" ? v : fb);
const N = (v, fb=0.6) => (typeof v === "number" ? v : fb);

export async function POST(req) {
  try {
    const body = await req.json();
    const imageData = S(body?.imageData, "");
    const userText = S(body?.userText, "");
    const lang = S(body?.lang, "zh");

    if (!imageData) {
      return NextResponse.json({ error: "缺少圖片 imageData" }, { status: 400 });
    }

    const sys = [
      "You are a helpful houseplant assistant.",
      "Identify the plant species from the photo, assess basic health, list likely issues and care steps.",
      "Return JSON with fields:",
      "common_name (string), scientific_name (string), confidence (0~1 number),",
      "state (string), likely_issues (string[]), care_steps (string[]), fun_one_liner (string).",
      "Write in Traditional Chinese. Keep fun_one_liner witty and short."
    ].join(" ");

    const userPrompt = [
      "請辨識植物並給出照護建議。",
      userText ? `使用者補充：${userText}` : ""
    ].filter(Boolean).join("\n");

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            { type: "image_url", image_url: { url: imageData } }
          ]
        }
      ],
      temperature: 0.5,
    });

    const raw = completion.choices?.[0]?.message?.content || "{}";
    let data;
    try { data = JSON.parse(raw); } catch { data = {}; }

    const result = {
      common_name: S(data.common_name, "未知"),
      scientific_name: S(data.scientific_name, ""),
      confidence: Math.max(0, Math.min(1, N(data.confidence, 0.6))),
      state: S(data.state, "整體看起來穩定，建議維持穩定日照與通風。"),
      likely_issues: Array.isArray(data.likely_issues) ? data.likely_issues : [],
      care_steps: Array.isArray(data.care_steps) ? data.care_steps : ["保持土壤微濕，避免積水。","給予明亮散射光。"],
      fun_one_liner: S(data.fun_one_liner, "我很綠，但不綠茶。"),
    };

    return NextResponse.json({ result }, { status: 200 });
  } catch (err) {
    console.error("PLANT_IDENTIFY_ROUTE_ERROR:", err);
    return NextResponse.json({ error: "Internal error", details: String(err?.message || err) }, { status: 500 });
  }
}
