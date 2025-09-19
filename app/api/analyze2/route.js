// app/api/analyze2/route.js
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // 避免靜態化/舊快取

const S = (v, fb = "") => (typeof v === "string" ? v : fb);
const ensureSpecies = (s) => (["cat", "dog"].includes(s) ? s : "cat");

// 簡單去重工具
function uniq(arr = []) {
  return Array.from(new Set(arr.map((s) => String(s || "").trim()))).filter(Boolean);
}

function send(obj, status = 200, reqId = "") {
  return new NextResponse(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-analyze-version": "analyze2-v1.2",
      ...(reqId ? { "x-req-id": reqId } : {})
    }
  });
}

export async function POST(req) {
  const reqId = Math.random().toString(36).slice(2, 8);
  try {
    const body = await req.json();
    const species = ensureSpecies(S(body?.species, "cat"));
    const userText = S(body?.userText, "");
    const imageData = S(body?.imageData, ""); // dataURL

    if (!process.env.OPENAI_API_KEY) return send({ error: "Missing OPENAI_API_KEY" }, 500, reqId);
    if (!imageData) return send({ error: "缺少圖片 imageData" }, 400, reqId);

    // ✅ 更有洞見的 system prompt（要求細節；避免重複；給步驟）
    const system = [
      "You are a detailed, safety-first pet expert for cats and dogs.",
      "Look for subtle signals owners might miss: posture asymmetry, tail set, ear angle, blink rate, pupil size, coat sheen, grooming pattern, respiration rhythm, shoulder/hip tension, avoidance/approach, environment hazards (wires, plants, clutter).",
      "Return JSON with fields:",
      "state (3–5 sentences; include 1–2 subtle observations and what they imply).",
      "issues (string[]: 2–4 concrete potential concerns to WATCH; do not repeat state verbatim).",
      "suggestions (string[]: 4–6 practical, step-by-step actions; do not repeat issues; each ≤ 22 zh-TW chars).",
      "fun_one_liner (string: witty, Taiwan slang, short).",
      "Answer in Traditional Chinese (Taiwan). Be non-medical but specific and actionable."
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
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      cache: "no-store"
    });

    const text = await r.text();
    if (!r.ok) return send({ error: "OpenAI error", details: text }, 502, reqId);

    let j; try { j = JSON.parse(text); } catch { j = {}; }
    const raw = j?.choices?.[0]?.message?.content || "{}";
    let data; try { data = JSON.parse(raw); } catch { data = {}; }

    // ✅ 去重與收斂
    let issues = Array.isArray(data.issues) ? uniq(data.issues).slice(0, 4) : [];
    let suggestions = Array.isArray(data.suggestions) ? uniq(data.suggestions) : [];
    const issueSet = new Set(issues);
    suggestions = suggestions.filter((s) => !issueSet.has(String(s))).slice(0, 6);

    const out = {
      state: S(
        data.state,
        "觀察到整體精神穩定、肢體放鬆，暫無明顯壓力訊號。建議持續觀察飲水、食慾與活動量。"
      ),
      issues,
      suggestions,
      fun_one_liner: S(data.fun_one_liner) || (species === "cat" ? "別吵，我在耍廢。" : "散步快點啦，我腳抖了！")
    };

    return send(out, 200, reqId);
  } catch (err) {
    return send({ error: "Internal error", details: String(err?.message || err) }, 500, reqId);
  }
}

// GET 健康檢查
export async function GET() {
  return new NextResponse("OK /api/analyze2", { status: 200, headers: { "cache-control": "no-store" } });
}
