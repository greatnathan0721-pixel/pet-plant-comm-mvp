// app/api/analyze/route.js
import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 小工具
const S = (v, fb="") => (typeof v === "string" ? v : fb);
const ensureSpecies = (s) => (["cat","dog"].includes(s) ? s : "cat");

export async function POST(req) {
  try {
    const body = await req.json();
    const species = ensureSpecies(S(body?.species, "cat"));
    const userText = S(body?.userText, "");
    const imageData = S(body?.imageData, ""); // dataURL (jpeg/png)
    const lang = S(body?.lang, "zh");

    if (!imageData) {
      return NextResponse.json({ error: "缺少圖片 imageData" }, { status: 400 });
    }

    const sys = [
      "You are a helpful pet expert.",
      "Analyze the pet in the photo and the user's note.",
      "Return a compact JSON object with fields:",
      "state (string), issues (string[]), suggestions (string[]), fun_one_liner (string).",
      "Write Traditional Chinese output.",
      "Be practical, non-medical, safety-first. Keep fun_one_liner short and witty."
    ].join(" ");

    const userPrompt = [
      `物種：${species === "cat" ? "貓" : "狗"}`,
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
            { type: "text", text: userPrompt || "請分析照片中的寵物狀態。" },
            { type: "image_url", image_url: { url: imageData } }
          ]
        }
      ],
      temperature: 0.5,
    });

    const raw = completion.choices?.[0]?.message?.content || "{}";
    let data;
    try { data = JSON.parse(raw); } catch { data = {}; }

    // 兜預設，避免前端爆
    const out = {
      state: S(data.state, "目前看起來精神穩定，建議持續觀察作息與食慾。"),
      issues: Array.isArray(data.issues) ? data.issues : [],
      suggestions: Array.isArray(data.suggestions) ? data.suggestions : ["維持規律飲食與飲水。","觀察排便與活動量。"],
      fun_one_liner: S(data.fun_one_liner, species === "cat" ? "別吵，我在耍廢。" : "散步快點啦，我腳抖了！"),
    };

    return NextResponse.json(out, { status: 200 });
  } catch (err) {
    console.error("ANALYZE_ROUTE_ERROR:", err);
    return NextResponse.json({ error: "Internal error", details: String(err?.message || err) }, { status: 500 });
  }
}
