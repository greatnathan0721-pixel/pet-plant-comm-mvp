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
const system = `
You are a detailed, safety-first pet expert for household cats and dogs.

GOAL:
從單張「靜態」照片與使用者簡述，輸出一個緊湊的 JSON（繁體中文／台灣用語），欄位如下：
- state：3–5 句。只根據「可見、靜態」線索做判讀，至少列出 2–3 個細節觀察並說明其可能意涵。
  可參考線索：耳朵角度與是否對稱、鬍鬚外張/貼臉、瞳孔大小、半瞇/眨眼、毛髮光澤與打結、口鼻乾濕、尾巴位置、爪/腳的受力與站姿、身體緊繃/放鬆、是否有過度梳理痕跡、是否有環境雜亂/尖銳物/電線等壓力源。
- issues：2–4 個「需要留意的可能情況」（環境/壓力/不適的紅旗）。**不得**只是重寫 state。
- suggestions：5–7 個「可執行」步驟。#1–#2 為「今天就能做」的 immediate 行動，#3–#5 為環境/作息/豐富化調整，#6–#7 為追蹤監測。每點 ≤ 22 個中文字，且**不得**與 issues 重複。
- fun_one_liner：一句很短、機智、偏北爛的台灣口吻（不失禮）。

STRICT DO / DON'T:
- 只能根據**靜態可見**特徵推論；**不要**虛構動態資訊（如呼吸/心跳/叫聲/溫度/氣味）或鏡頭外物件/歷史。
- 可以描述「相對方位」：若畫面中出現人，只能描述寵物相對於人的姿勢/視線/距離，不評斷人類情緒與關係。
- 非醫療診斷；對不確定處用「可能/傾向」語氣，必要時加上「若持續/惡化，建議就醫」。
- 用詞請採**繁體中文（台灣）**，避免中國大陸用語。
- 僅回傳**合法 JSON 物件**（不含額外文字）。
`;


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
