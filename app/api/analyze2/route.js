// app/api/analyze2/route.js
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // 避免靜態化/舊快取

const S = (v, fb = "") => (typeof v === "string" ? v : fb);
const ensureSpecies = (s) =>
  ["cat", "dog", "plant"].includes(s) ? s : "cat";

// 去重工具
function uniq(arr = []) {
  return Array.from(new Set(arr.map((s) => String(s || "").trim()))).filter(
    Boolean
  );
}

// 統一輸出格式
function send(obj, status = 200, reqId = "") {
  return new NextResponse(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-analyze-version": "analyze2-v2.0",
      ...(reqId ? { "x-req-id": reqId } : {}),
    },
  });
}

export async function POST(req) {
  const reqId = Math.random().toString(36).slice(2, 8);
  try {
    const body = await req.json();
    const species = ensureSpecies(S(body?.species, "cat"));
    const userText = S(body?.userText, "");
    const imageData = S(body?.imageData, "");

    if (!process.env.OPENAI_API_KEY)
      return send({ error: "Missing OPENAI_API_KEY" }, 500, reqId);
    if (!imageData) return send({ error: "缺少圖片 imageData" }, 400, reqId);

    // system prompt 分流
    let system = "";
    if (species === "cat" || species === "dog") {
      system = `
You are a detailed, safety-first pet expert for household ${species}.
GOAL:
從單張「靜態」照片與使用者簡述，輸出 JSON：
- state：3–5 句，至少 2–3 個表層觀察 + 1–2 個深入洞察。
- issues：2–4 個可能風險（不得只是重寫 state）。
- suggestions：5–7 個具體步驟（前 2 點立即可做，後續含環境/作息/追蹤）。
- fun_one_liner：一句北爛台灣用語，符合 ${species} 身份。

STRICT DO/DON'T:
- 僅根據靜態可見線索，勿虛構呼吸/心跳/鏡頭外。
- 人若出現，只描述寵物相對人類的姿勢，不評斷情緒。
- 繁體中文（台灣），避免中國大陸用語。
- 僅回傳合法 JSON。`;
    } else if (species === "plant") {
      system = `
You are a professional plant care specialist.
GOAL:
從單張植物照片與使用者簡述，輸出 JSON：
- state：至少 2–3 個表層觀察 + 1–2 個深入洞察。
  若照片含多株，逐一點名品種並分別描述。
- issues：2–4 個潛在風險，須具體指出可能原因與長期後果。
- suggestions：5–7 個步驟（短期立即措施 + 中長期策略），具體可行。
- fun_one_liner：一句北爛台灣用語，符合植物身份。
  範例：「我很綠，但不綠茶。」、「別移我啦，我在追太陽。」

STRICT DO/DON'T:
- 僅根據靜態可見特徵推論，勿編造看不出的數據。
- 若多株植物，必須逐一分析。`;
    } else {
      system =
        "You are a helpful assistant. Return JSON with state, issues, suggestions, fun_one_liner.";
    }

    // user prompt
    const userPrompt = [
      `物種：${
        species === "cat" ? "貓" : species === "dog" ? "狗" : "植物"
      }`,
      userText ? `使用者補充：${userText}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    // payload
    const payload = {
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: userPrompt || "請分析照片中的狀態。",
            },
            { type: "image_url", image_url: { url: imageData } },
          ],
        },
      ],
    };

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    const text = await r.text();
    if (!r.ok) return send({ error: "OpenAI error", details: text }, 502, reqId);

    let j;
    try {
      j = JSON.parse(text);
    } catch {
      j = {};
    }
    const raw = j?.choices?.[0]?.message?.content || "{}";
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = {};
    }

    // 去重與收斂
    let issues = Array.isArray(data.issues)
      ? uniq(data.issues).slice(0, 4)
      : [];
    let suggestions = Array.isArray(data.suggestions)
      ? uniq(data.suggestions)
      : [];
    const issueSet = new Set(issues);
    suggestions = suggestions
      .filter((s) => !issueSet.has(String(s)))
      .slice(0, 6);

    const out = {
      state: S(
        data.state,
        "觀察到整體狀態穩定，建議持續追蹤日常變化。"
      ),
      issues,
      suggestions,
      fun_one_liner:
        S(data.fun_one_liner) ||
        (species === "cat"
          ? "別吵，我在耍廢。"
          : species === "dog"
          ? "散步快點啦，我腳抖了！"
          : "我很綠，但不綠茶。"),
    };

    return send(out, 200, reqId);
  } catch (err) {
    return send(
      { error: "Internal error", details: String(err?.message || err) },
      500,
      reqId
    );
  }
}

// GET 健康檢查
export async function GET() {
  return new NextResponse("OK /api/analyze2", {
    status: 200,
    headers: { "cache-control": "no-store" },
  });
}
