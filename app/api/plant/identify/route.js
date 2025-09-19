// app/api/plant/identify/route.js
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const S = (v, fb = "") => (typeof v === "string" ? v : fb);

// 去重小工具
function uniq(arr = []) {
  return Array.from(new Set(arr.map((s) => String(s || "").trim()))).filter(Boolean);
}

export async function POST(req) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    const body = await req.json();
    const imageData = S(body?.imageData, "");
    const userText = S(body?.userText, "");
    if (!imageData) {
      return NextResponse.json({ error: "缺少圖片 imageData" }, { status: 400 });
    }

    // ✅ 更有洞見的 system prompt（植物版）
    const system = [
      "You are a houseplant expert. Identify likely plant (common & scientific name, with confidence 0~1) and assess health.",
      "Look for subtle cues: leaf edge (curl/crisp), venation color, petiole turgor, internode spacing, etiolation, soil moisture pattern, pot size/drainage, salt crust, dust, phototropism (leaning toward light).",
      "Return JSON with fields:",
      "common_name (string), scientific_name (string), confidence (number 0~1),",
      "state (3–5 sentences; include 1–2 subtle observations and what they imply),",
      "likely_issues (string[]: 2–4; do not repeat state),",
      "care_steps (string[]: 4–6 actionable; each ≤ 22 zh-TW chars; do not repeat issues).",
      "Use Traditional Chinese (Taiwan). Be specific but non-medical."
    ].join(" ");

    const userPrompt = userText ? `使用者補充：${userText}` : "請辨識此植物並評估狀態。";

    const payload = {
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            { type: "image_url", image_url: { url: imageData } }
          ]
        }
      ],
      temperature: 0.5
    };

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      cache: "no-store"
    });

    const text = await r.text();
    if (!r.ok) {
      return NextResponse.json({ error: "OpenAI error", details: text }, { status: 502 });
    }

    let j; try { j = JSON.parse(text); } catch { j = {}; }
    const raw = j?.choices?.[0]?.message?.content || "{}";
    let data; try { data = JSON.parse(raw); } catch { data = {}; }

    // ✅ 去重與收斂
    let likely_issues = Array.isArray(data.likely_issues) ? uniq(data.likely_issues).slice(0, 4) : [];
    let care_steps = Array.isArray(data.care_steps) ? uniq(data.care_steps) : [];
    const setIssues = new Set(likely_issues);
    care_steps = care_steps.filter((s) => !setIssues.has(String(s))).slice(0, 6);

    const result = {
      common_name: S(data.common_name, "未知"),
      scientific_name: S(data.scientific_name, ""),
      confidence: typeof data.confidence === "number" ? Math.max(0, Math.min(1, data.confidence)) : 0,
      state: S(data.state, "葉色與挺度穩定，暫無明顯壓力跡象。"),
      likely_issues,
      care_steps
    };

    return NextResponse.json(result, { status: 200, headers: { "x-version": "plant-identify-v1.1" } });
  } catch (err) {
    console.error("PLANT_IDENTIFY_ERROR:", err);
    return NextResponse.json(
      { error: "Internal error", details: String(err?.message || err) },
      { status: 500 }
    );
  }
}
