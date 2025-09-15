// app/api/analyze/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// —— 小工具：把一句話「更像第一人稱、可愛又精煉」——
function polishOneLiner(species, text, lang = "zh") {
  let t = String(text || "").trim();

  // 常見冗詞 & 第三人稱 → 第一人稱
  const junk = [/^我覺得[，、:\s]?/, /^看起來[，、:\s]?/, /^似乎[，、:\s]?/, /^可能[，、:\s]?/];
  junk.forEach((re) => (t = t.replace(re, "")));

  // 把「牠/它/他」主語改成「我」
  t = t.replace(/^(牠|它|他)[是在有把的了地著過也都就還會呢嗎呀啊]+/u, "");
  t = t.replace(/(牠|它|他)覺得/g, "我覺得");
  t = t.replace(/(牠|它|他)想/g, "我想");
  t = t.replace(/(牠|它|他)要/g, "我要");

  // 物種小稱呼
  const nick =
    species === "dog" ? "本汪" :
    species === "cat" ? "本喵" :
    "我";

  // 若不是第一人稱，補一個第一人稱開頭
  if (!/^(我|本喵|本汪|本葉|俺|偶)/.test(t)) {
    t = `${nick}${t.startsWith("是") ? "" : (t.match(/^[，。、!?…]/) ? "" : " ")}${t}`;
  }

  // 避免太長（中文字抓 22 字，英文抓 ~50 字）
  if (lang === "zh") {
    const limit = 22;
    let count = 0, out = "";
    for (const ch of t) {
      count += 1;
      if (count > limit) break;
      out += ch;
    }
    t = out;
  } else {
    t = t.split(/\s+/).slice(0, 12).join(" ");
  }

  // 結尾語氣：可愛但不吵
  if (!/[。！!?～]$/.test(t)) t += (lang === "zh" ? "～" : "~");

  return t;
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { species = "cat", userText = "", imageData, lang = "zh" } = body || {};
    if (!imageData || !imageData.startsWith("data:image/")) {
      return NextResponse.json({ error: "Invalid imageData (need data URL)" }, { status: 400 });
    }

    const SYS =
      lang === "zh"
        ? `你是寵物影像解析助手，回覆**只用繁體中文**。
請輸出單一 JSON：{
  "state": string,              // 第三人稱、2~4 句：描述目前狀態（姿勢/神情/動作/環境）。
  "issues": string[],           // 0~4 項可能風險或需要留意的點（精煉名詞片語）。
  "suggestions": string[],      // 3~6 條可執行步驟（直接動詞開頭、短句）。
  "fun_one_liner": string       // 由寵物第一人稱說的一句話，可愛自然、口語、<= 22 字，不要出現「我覺得/看起來」，不要#與顏文字，最多 1 個結尾符號。
}
注意：
- "state" 與 "suggestions" 必須第三人稱敘述（牠/貓咪/狗狗）。
- "fun_one_liner" 必須第一人稱（我/本喵/本汪），自然口語，可愛、別說教，像是正在「心裡說話」。
- 內容僅做健康照護建議，**不得醫療診斷**。如有高度風險，請在 suggestions 內加入「儘速就醫/找專業」。`
        : `You are a pet image analyst. Output ONE JSON object only:
{
  "state": string,              // 2–4 sentences, third-person description of current posture/mood/environment.
  "issues": string[],           // 0–4 concise possible issues.
  "suggestions": string[],      // 3–6 actionable steps (imperative, concise).
  "fun_one_liner": string       // First-person witty inner monologue, ≤ 12 words, natural & cute, no hashtags or emojis.
}
No medical diagnosis. If high risk, include "seek a vet" inside suggestions.`;

    const USER =
      lang === "zh"
        ? `物種：${species}。\n使用者補充：${userText || "（無）"}。\n請先理解圖片再輸出 JSON。`
        : `Species: ${species}\nUser notes: ${userText || "(none)"}\nAnalyze the image then return JSON only.`;

    const chat = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
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

    // 後處理保險：確保有一個可愛的一句話
    const fun = polishOneLiner(species, parsed.fun_one_liner, lang);

    const payload = {
      state: typeof parsed.state === "string" ? parsed.state.trim() : "",
      issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 4) : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 6) : [],
      fun_one_liner: fun,
      model: "gpt-4o-mini",
    };

    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json({ error: "Internal error", details: String(e?.message || e) }, { status: 500 });
  }
}
