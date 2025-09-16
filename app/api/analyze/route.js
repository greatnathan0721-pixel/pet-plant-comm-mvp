// app/api/analyze/route.js
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // ← 強制不要被靜態化/快取

const S = (v, fb = "") => (typeof v === "string" ? v : fb);
const ensureSpecies = (s) => (["cat", "dog"].includes(s) ? s : "cat");

export async function POST(req) {
  const reqId = Math.random().toString(36).slice(2, 8);
  try {
    console.log(`[ANALYZE] v2-fetch start id=${reqId}`);
    const body = await req.json();
    const species = ensureSpecies(S(body?.species, "cat"));
    const userText = S(body?.userText, "");
    const imageData = S(body?.imageData, ""); // dataURL
    const lang = S(body?.lang, "zh");

    if (!process.env.OPENAI_API_KEY) {
      return json({ error: "Missing OPENAI_API_KEY" }, 500, reqId);
    }
    if (!imageData) {
      return json({ error: "缺少圖片 imageData" }, 400, reqId);
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

    console.log(`[ANALYZE] id=${reqId} calling OpenAI chat.completions via fetch`);
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      // 重要：避免邊緣網路快取
      cache: "no-store",
    });

    const text = await r.text();
    if (!r.ok) {
      console.error(`[ANALYZE] id=${reqId} OpenAI error:`, text);
      return json({ error: "OpenAI error", details: text }, 502, reqId);
    }

    let j;
    try { j = JSON.parse(text); } catch {
      console.error(`[ANALYZE] id=${reqId} JSON parse fail on OpenAI response`);
      return json({ error: "OpenAI bad JSON", details: text?.slice(0, 4000) }, 502, reqId);
    }

    const raw = j?.choices?.[0]?.message?.content || "{}";
    let data;
    try { data = JSON.parse(raw); } catch { data = {}; }

    const out = {
      state: S(data.state, "目前看起來精神穩定，建議持續觀察作息與食慾。"),
      issues: Array.isArray(data.issues) ? data.issues : [],
      suggestions: Array.isArray(data.suggestions) ? data.suggestions : ["維持規律飲食與飲水。", "觀察排便與活動量。"],
      fun_one_liner: S(data.fun_one_liner, species === "cat" ? "別吵，我在耍廢。" : "散步快點啦，我腳抖了！"),
    };

    console.log(`[ANALYZE] id=${reqId} ok`);
    return json(out, 200, reqId);
  } catch (err) {
    console.error(`[ANALYZE] id=${reqId} exception:`, err);
    return json({ error: "Internal error", details: String(err?.message || err) }, 500, reqId);
  }
}

function json(obj, status = 200, reqId = "") {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-analyze-version": "v2-fetch",
    ...(reqId ? { "x-req-id": reqId } : {}),
  });
  return new NextResponse(JSON.stringify(obj), { status, headers });
}
