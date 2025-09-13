// app/api/audio/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { toFile } from "openai/uploads";

// ✅ 讀環境變數（跟 /api/chat 一樣）
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// 把 dataURL 轉成 Buffer
function dataURLtoBuffer(dataURL) {
  const [, meta, b64] = dataURL.match(/^data:(.*?);base64,(.*)$/) || [];
  if (!b64) return null;
  return Buffer.from(b64, "base64");
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { species = "cat", audioDataURL, lang = "zh" } = body || {};
    if (!audioDataURL) {
      return NextResponse.json({ error: "缺少 audioDataURL" }, { status: 400 });
    }

    const buf = dataURLtoBuffer(audioDataURL);
    if (!buf) {
      return NextResponse.json({ error: "音檔格式錯誤" }, { status: 400 });
    }

    // 1) 語音轉文字（Whisper）
    const transcript = await openai.audio.transcriptions.create({
      file: await toFile(buf, "voice.webm"),
      // 你也可以用 gpt-4o-mini-transcribe；whisper-1 成本更低、穩定
      model: "whisper-1",
      // 可選：language 指示（"zh", "en"...）不指定也會自動偵測
      // language: lang === "zh" ? "zh" : undefined,
      response_format: "json",
      temperature: 0,
    });

    const text = transcript?.text?.trim() || "";
    if (!text) {
      return NextResponse.json({ error: "未取得轉文字結果" }, { status: 500 });
    }

    // 2) 用文字再做一次寵物/植物的 quick 建議（簡版）
    const sys =
      lang === "zh"
        ? `你是《寵物植物溝通 App》助理，用繁中回答；輸出三段：
1) 情境解讀（1-2句）
2) 專業建議（3點）
3) 趣味一句話（可愛但不喧賓奪主）
避免醫療診斷；有風險時提醒求助專業。物種：${species}`
        : `You are Pets & Plants Communication assistant; output:
1) Situation (1-2)
2) Advice (3 bullets)
3) Fun one-liner
No medical diagnosis. Species: ${species}`;

    const resp = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: sys },
        { role: "user", content: `使用者語音轉文字：${text}` },
      ],
      temperature: 0.5,
    });

    const advice = resp.output_text?.trim() || "";

    return NextResponse.json({
      ok: true,
      transcript: text,
      advice,
      model: "whisper-1+gpt-4.1-mini",
    });
  } catch (e) {
    console.error(e);
    // 盡量把錯誤訊息丟回前端方便你除錯
    return NextResponse.json(
      { error: "Internal error", details: String(e?.message || e) },
      { status: 500 }
    );
  }
}
