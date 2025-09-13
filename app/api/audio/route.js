// app/api/audio/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { toFile } from "openai/uploads";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 把 dataURL 拆出 base64 與格式
function parseDataURL(dataURL) {
  const m = /^data:(.*?);base64,(.*)$/.exec(dataURL || "");
  if (!m) return null;
  const mime = m[1] || "audio/webm";
  const base64 = m[2];
  // 推斷副檔名/格式（給多模態用）
  const format =
    mime.includes("webm") ? "webm" :
    mime.includes("mp3") ? "mp3" :
    mime.includes("m4a") ? "m4a" :
    mime.includes("wav") ? "wav" :
    "webm";
  return { mime, base64, format };
}

// 安全限制：2.5MB 以內（MVP 可依需要微調）
const MAX_BYTES = 2.5 * 1024 * 1024;

export async function POST(req) {
  try {
    const { species = "cat", audioDataURL, lang = "zh" } = await req.json();
    if (!audioDataURL) {
      return NextResponse.json({ error: "缺少 audioDataURL" }, { status: 400 });
    }

    const parsed = parseDataURL(audioDataURL);
    if (!parsed) {
      return NextResponse.json({ error: "音檔格式錯誤：非 dataURL/base64" }, { status: 400 });
    }

    const { mime, base64, format } = parsed;
    const buf = Buffer.from(base64, "base64");
    if (buf.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: `音檔過大（${(buf.byteLength/1024/1024).toFixed(2)}MB）` }, { status: 400 });
    }

    // 先嘗試轉文字（若有人聲/講話時有幫助；寵物叫聲沒文字也沒關係）
    let transcript = "";
    try {
      const whisper = await openai.audio.transcriptions.create({
        file: await toFile(buf, `voice.${format}`),
        model: "whisper-1",
        response_format: "json",
        temperature: 0,
      });
      transcript = (whisper?.text || "").trim();
    } catch {
      // 忽略 whisper 失敗，不要阻斷流程
    }

    // 多模態音訊理解（重點）：把原始音訊送進模型判讀
    const sys =
      lang === "zh"
        ? `你是《寵物植物溝通 App》助理。使用者提供的是「原始音訊」，可能是貓/狗的叫聲或環境聲。
請根據聲學特徵（節奏、頻率、時長、斷續、緊張度）推測可能的「情緒/需求」與「風險等級」。
輸出結構（繁中）：
1) 情境解讀（1-2句）
2) 專業建議（3-5點，具體可行）
3) 何時需要就醫/專業協助（若無風險寫「目前無」）
禁止醫療診斷；保守而實用。物種：${species}`
        : `You are the Pets & Plants assistant. The user sends raw audio (pet sounds/environment). 
Infer likely emotion/need and risk from acoustic patterns (tempo, frequency, intensity, burstiness).
Output:
1) Situation (1-2)
2) Advice (3-5 actionable bullets)
3) When to seek vet/pro help (or "None" if low risk)
No medical diagnosis. Species: ${species}`;

    const userParts = [];
    // 把音檔本體丟給模型（多模態）
    userParts.push({
      type: "input_audio",
      audio: { data: base64, format }
    });
    // 如果有轉文字（可能有人聲解說），附帶給模型參考
    if (transcript) {
      userParts.push({ type: "text", text: `（附帶人聲轉文字）${transcript}` });
    }

    const resp = await openai.responses.create({
      model: "gpt-4o-mini", // 支援音訊理解且成本較低，適合 MVP
      input: [
        { role: "system", content: sys },
        { role: "user", content: userParts }
      ],
      temperature: 0.4
    });

    const advice = resp.output_text?.trim() || "";

    return NextResponse.json({
      ok: true,
      hasTranscript: !!transcript,
      transcript,
      advice,
      model: "gpt-4o-mini + whisper-1"
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Internal error", details: String(e?.message || e) },
      { status: 500 }
    );
  }
}
