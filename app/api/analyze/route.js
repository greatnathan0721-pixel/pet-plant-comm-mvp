// app/api/analyze/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---- helpers ----
function cleanFirstPersonLine(t = "", species = "pet") {
  let s = String(t || "").trim();
  // 去掉「我覺得/看起來/似乎/可能」等前綴
  s = s.replace(/^(我)?(覺得|想|認為|感覺|好像|看起來|似乎|可能)[，,:：\s]*/u, "");
  // 牠/它 -> 我
  s = s.replace(/(牠|它)/g, "我");
  // 必須第一人稱起頭
  if (!/^我/.test(s)) s = "我" + s;
  // 預設兜底
  if (!s || s === "我") s = species === "dog" ? "我超想散步，現在就出發！" : "我今天心情很好，想窩一下～";
  // 限長（中文字以 codepoint 計）
  const MAX = 24;
  if ([...s].length > MAX) s = [...s].slice(0, MAX - 1).join("") + "…";
  // 結尾標點
  if (!/[。！？!]$/.test(s)) s += "！";
  return s;
}

function fallbackFromState(state = "", species = "pet") {
  const text = (state || "").toString();
  const rules = [
    { k: /(放鬆|舒服|安穩|躺著|睡)/, out: "我現在超放鬆，先睡一小會兒～" },
    { k: /(緊張|害怕|不安|警戒)/, out: "我有點緊張，先給我點距離好嗎？" },
    { k: /(飢|餓|食慾|吃)/, out: "我想先填飽肚子，再聊！" },
    { k: /(渴|水|喝)/, out: "我想喝水，補充一下能量！" },
    { k: /(悶熱|熱|流汗)/, out: "我有點熱，幫我換個涼快的地方～" },
    { k: /(冷|發抖)/, out: "我有點冷，想靠近你取暖。" },
    { k: /(疼|痛|不適|不舒服)/, out: "我哪裡不太舒服，請幫我看看…" },
  ];
  for (const r of rules) if (r.k.test(text)) return r.out;
  return species === "dog" ? "我想出去走走，順便聞聞世界！" : "我今天狀態不錯，想被摸摸～";
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { species = "cat", userText = "", imageData, lang = "zh" } = body || {};
    if (!imageData) {
      return NextResponse.json({ error: "Missing imageData" }, { status: 400 });
    }

    const SYS =
      lang === "zh"
        ? `你是寵物圖片分析助理。請以「第三人稱」提供專業觀察，不做醫療診斷；必要時提醒就醫。
輸出唯一 JSON：
{
  "state": string,              // 目前狀態（第三人稱）
  "issues": string[],           // 可能問題（第三人稱）
  "suggestions": string[],      // 3~6 點具體建議（第三人稱）
  "fun_one_liner": string       // 內心小劇場用的一句話，必須：第一人稱（以「我」起頭）、不超過 24 個中文字、不得包含「我覺得/看起來/似乎/可能/牠/它」等
}
只回 JSON，不要其他文字。`
        : `You are a pet image assistant. Provide analysis in third person; no medical diagnosis. Return ONLY JSON:
{
  "state": string, "issues": string[], "suggestions": string[],
  "fun_one_liner": string  // first-person, starts with "I", <= 60 chars, no "I think/it seems/it/its"
}`;

    const USER =
      lang === "zh"
        ? `物種：${species}；使用者補充：${userText || "（無）"}`
        : `Species: ${species}; User notes: ${userText || "(none)"}`;

    const chat = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
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

    // 產圖台詞（第一人稱）強化與兜底
    let fun = cleanFirstPersonLine(parsed?.fun_one_liner, species);
    if (!fun || fun === "我！" || fun === "我…！") {
      fun = cleanFirstPersonLine(fallbackFromState(parsed?.state, species), species);
    }

    const payload = {
      state: typeof parsed?.state === "string" ? parsed.state : "",
      issues: Array.isArray(parsed?.issues) ? parsed.issues : [],
      suggestions: Array.isArray(parsed?.suggestions) ? parsed.suggestions : [],
      fun_one_liner: fun,
    };

    return NextResponse.json(payload);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Internal error", details: String(e?.message || e) },
      { status: 500 }
    );
  }
}
