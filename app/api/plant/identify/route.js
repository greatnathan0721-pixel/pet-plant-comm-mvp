// app/api/plant/identify/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function estimateBase64SizeKB(dataURL) {
  const base64 = (dataURL || "").split(",")[1] || "";
  const bytes = Math.ceil((base64.length * 3) / 4);
  return Math.round(bytes / 1024);
}

// 與動物端一致：泡泡後處理
function cleanFirstPersonLine(t = "") {
  let s = String(t || "").trim();
  s = s.replace(/^(我)?(覺得|想|認為|感覺|好像|看起來|似乎|可能)[，,:：\s]*/u, "");
  s = s.replace(/(它|牠)/g, "我");
  if (!/^我/.test(s)) s = "我" + s;
  if (!s || s === "我") s = "我想要剛剛好的陽光和一點水分～";
  const MAX = 24;
  if ([...s].length > MAX) s = [...s].slice(0, MAX - 1).join("") + "…";
  if (!/[。！？!]$/.test(s)) s += "！";
  return s;
}
function fallbackFromState(state = "") {
  const t = state.toString();
  if (/過水|積水|爛根|太濕|水太多|over/i.test(t)) return "我喝太多了，先讓土壤透氣一下～";
  if (/缺水|太乾|乾燥|皺/i.test(t)) return "我有點口渴，幫我補點水！";
  if (/日照|太陽|光線|陰暗|光不足/i.test(t)) return "我想多曬一點光，會更有精神！";
  if (/肥|營養|黃葉|貧瘠/i.test(t)) return "我想要一點點肥料，不用太多～";
  if (/蟲|介殼|蚜|病斑/i.test(t)) return "我被小蟲煩到，幫我清一清吧！";
  return "我喜歡穩定的光照與通風，這樣最舒服～";
}

export async function POST(req) {
  try {
    const { imageData, userText = "" } = await req.json();
    if (!imageData || !imageData.startsWith("data:image/")) {
      return NextResponse.json({ error: "Invalid imageData (need data URL)" }, { status: 400 });
    }
    const sizeKB = estimateBase64SizeKB(imageData);
    if (sizeKB > 700) {
      return NextResponse.json(
        { error: `Image too large (${sizeKB}KB). 請壓縮（建議最長邊 720、品質 0.7）。` },
        { status: 413 }
      );
    }

    const SYS = `You are a plant identification & care assistant. Return ONLY JSON:
{
  "common_name": string,
  "scientific_name": string,
  "confidence": number,
  "state": string,                 // current observation in THIRD person (Traditional Chinese)
  "likely_issues": string[],
  "care_steps": string[],          // 3-6 concise steps
  "severity": "low"|"medium"|"high",
  "fun_one_liner": string          // FIRST PERSON line for the plant; MUST start with "我", <= 24 Chinese chars, no "我覺得/看起來/似乎/可能/它/牠"
}
No extra text. All fields in Traditional Chinese except scientific_name.`;

    const USER = `使用者補充：${userText || "（無）"}`;

    const chat = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.35,
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

    let fun = cleanFirstPersonLine(parsed?.fun_one_liner);
    if (!fun) fun = cleanFirstPersonLine(fallbackFromState(parsed?.state));

    // 直接回頂層欄位（與前端 HomeClient2 取用對齊）
    return NextResponse.json({
      common_name: parsed?.common_name || "",
      scientific_name: parsed?.scientific_name || "",
      confidence: typeof parsed?.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0,
      state: typeof parsed?.state === "string" ? parsed.state : "",
      likely_issues: Array.isArray(parsed?.likely_issues) ? parsed.likely_issues : [],
      care_steps: Array.isArray(parsed?.care_steps) ? parsed.care_steps : [],
      severity: parsed?.severity || "low",
      fun_one_liner: fun,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Internal error", details: String(e?.message || e) }, { status: 500 });
  }
}
