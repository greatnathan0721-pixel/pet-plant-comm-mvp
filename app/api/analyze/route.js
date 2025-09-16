// app/api/analyze/route.js
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const S = (v, fb = "") => (typeof v === "string" ? v : fb);
const ensureSpecies = (s) => (["cat", "dog"].includes(s) ? s : "cat");

export async function POST(req) {
  try {
    const body = await req.json();
    const species = ensureSpecies(S(body?.species, "cat"));
    const userText = S(body?.userText, "");
    const imageData = S(body?.imageData, ""); // dataURL
    const lang = S(body?.lang, "zh");

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }
    if (!imageData) {
      return NextResponse.json({ error: "缺少圖片 imageData" }, { status: 400 });
    }

    const system = [
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

    const payload = {
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt || "請分析照片中的寵物狀態。" },
            { type: "image_url", image_url: { url: imageData } }
          ]
        }
      ],
      temperature: 0.5
    };

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      return NextResponse.json({ error: "OpenAI error", details: errText }, { status: 502 });
    }

    const j = await r.json();
    const raw = j?.choices?.[0]?.message?.content || "{}";
    let data;
    try { data = JSON.parse(raw); } catch { data = {}; }

    const out = {
      state: S(data.state, "目前看起來精神穩定，建議持續觀察作息與食慾。"),
      issues: Array.isArray(data.issues) ? data.issues : [],
      suggestions: Array.isArray(data.suggestions) ? data.suggestions : ["維持規律飲食與飲水。", "觀察排便與活動量。"],
      fun_one_liner: S(data.fun_one_liner, species === "cat" ? "別吵，我在耍廢。" : "散步快點啦，我腳抖了！"),
    };

    return NextResponse.json(out, { status: 200 });
  } catch (err) {
    console.error("ANALYZE_ROUTE_ERROR:", err);
    return NextResponse.json({ error: "Internal error", details: String(err?.message || err) }, { status: 500 });
  }
}
