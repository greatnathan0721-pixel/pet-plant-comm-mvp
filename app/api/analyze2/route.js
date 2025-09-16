// app/api/analyze2/route.js
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // 避免靜態化/舊快取

const S = (v, fb = "") => (typeof v === "string" ? v : fb);
const ensureSpecies = (s) => (["cat", "dog"].includes(s) ? s : "cat");

export async function POST(req) {
  const reqId = Math.random().toString(36).slice(2, 8);
  try {
    const body = await req.json();
    const species = ensureSpecies(S(body?.species, "cat"));
    const userText = S(body?.userText, "");
    const imageData = S(body?.imageData, ""); // dataURL

    if (!process.env.OPENAI_API_KEY) {
      return send({ error: "Missing OPENAI_API_KEY" }, 500, reqId);
    }
    if (!imageData) {
      return send({ error: "缺少圖片 imageData" }, 400, reqId);
    }

    const system =
      "You are a helpful pet expert. Analyze the pet in the photo and the user's note. " +
      "Return JSON: state (string), issues (string[]), suggestions (string[]), fun_one_liner (string). " +
      "Write Traditional Chinese, practical, non-medical, safety-first. Keep fun_one_liner short and witty.";

    const userPrompt = [
      `物種：${species === "cat" ? "貓" : "狗"}`,
      userText ? `使用者補充：${userText}` : ""
    ]
      .filter(Boolean)
      .join("\n");

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
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      cache: "no-store"
    });

    const text = await r.text();
    if (!r.ok) {
      return send({ error: "OpenAI error", details: text?.slice(0, 1200) }, 502, reqId);
    }

    let j;
    try {
      j = JSON.parse(text);
    } catch {
      return send({ error: "OpenAI bad JSON", details: text?.slice(0, 1200) }, 502, reqId);
    }

    const raw = j?.choices?.[0]?.message?.content || "{}";
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = {};
    }

    const out = {
      state: S(data.state, "目前看起來精神穩定，建議持續觀察作息與食慾。"),
      issues: Array.isArray(data.issues) ? data.issues : [],
      suggestions: Array.isArray(data.suggestions)
        ? data.suggestions
        : ["維持規律飲食與飲水。", "觀察排便與活動量。"],
      fun_one_liner:
        S(
          data.fun_one_liner,
          species === "cat" ? "別吵，我在耍廢。" : "散步快點啦，我腳抖了！"
        )
    };

    return send(out, 200, reqId);
  } catch (err) {
    return send({ error: "Internal error", details: String(err?.message || err) }, 500, reqId);
  }
}

function send(obj, status = 200, reqId = "") {
  return new NextResponse(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-analyze-version": "analyze2-fetch",
      ...(reqId ? { "x-req-id": reqId } : {})
    }
  });
}

// 可選：GET 健康檢查（在瀏覽器直接打 /api/analyze2 看回應） 
export async function GET() {
  return new NextResponse("OK /api/analyze2", {
    status: 200,
    headers: { "cache-control": "no-store" }
  });
}
