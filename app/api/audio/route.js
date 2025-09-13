// app/api/audio/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const species = (formData.get("species") || "unknown").toString();
    const lang = (formData.get("lang") || "zh").toString();

    if (!file) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    // 寫到 /tmp 以供轉錄
    const buf = Buffer.from(await file.arrayBuffer());
    const safeName = (file.name || "voice.webm").replace(/[^\w.\-]+/g, "_");
    const tmpPath = path.join("/tmp", safeName);
    await fs.writeFile(tmpPath, buf);

    // 1) 語音轉文字（可用 whisper-1 或 gpt-4o-mini-transcribe）
    let transcriptText = "";
    try {
      const tr = await openai.audio.transcriptions.create({
        file: await import("node:fs").then(m => m.createReadStream(tmpPath)),
        model: "gpt-4o-mini-transcribe",
      });
      transcriptText = (tr.text || "").trim();
    } catch (err) {
      // 轉錄失敗也要安全回覆
      await safeUnlink(tmpPath);
      return NextResponse.json(
        { error: "Transcription failed", details: String(err?.message || err) },
        { status: 500 }
      );
    } finally {
      await safeUnlink(tmpPath);
    }

    // 2) 讓模型輸出 專業建議 + 趣味一句話 + 物種偵測
    const sys =
      lang === "zh"
        ? `你是《寵物植物溝通 App》的聲音分析助理。輸入是寵物或植物的叫聲之轉錄文字。
請：
- 先用 2–3 句解讀情境/可能原因（避免醫療診斷）
- 提出 3–5 點具體照護建議（步驟化）
- 給 1 句簡短的趣味話（不喧賓奪主）
同時你 *務必* 僅輸出下列 JSON（不要任何多餘文字）：
{
  "reply": "string",              // 專業建議（繁體中文）
  "fun": "string",                // 趣味一句話，可留空字串
  "detected_species": "cat" | "dog" | "plant" | "unknown",
  "confidence": number            // 0..1，對 detected_species 的信心
}
若不確定物種就回 "unknown" 與 0。`
        : `You are the Pets & Plants voice analysis assistant. Input is the transcription of an animal/plant sound.
Please:
- Interpret the situation in 2–3 sentences (no medical diagnosis)
- Provide 3–5 concrete care tips
- Add one short fun one-liner
You MUST output ONLY this JSON (no extra text):
{
  "reply": "string",
  "fun": "string",
  "detected_species": "cat" | "dog" | "plant" | "unknown",
  "confidence": number
}
If unsure, return "unknown" and 0.`;

    const userMsg =
      lang === "zh"
        ? `使用者選的物種：${species}\n語音轉文字：${transcriptText || "(空白)"}\n請依規格只回 JSON。`
        : `User selected species: ${species}\nTranscript: ${transcriptText || "(empty)"}\nReturn JSON only.`;

    const resp = await openai.responses.create({
      model: "gpt-4.1-mini",
      temperature: 0.5,
      input: [
        { role: "system", content: sys },
        { role: "user", content: userMsg },
      ],
    });

    const raw = resp.output_text?.trim() || "";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}$/);
      parsed = m ? JSON.parse(m[0]) : {};
    }

    const payload = {
      reply: typeof parsed.reply === "string" ? parsed.reply : "（沒有回覆）",
      fun: typeof parsed.fun === "string" ? parsed.fun : "",
      detected_species:
        parsed.detected_species === "cat" ||
        parsed.detected_species === "dog" ||
        parsed.detected_species === "plant"
          ? parsed.detected_species
          : "unknown",
      confidence:
        typeof parsed.confidence === "number"
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0,
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

async function safeUnlink(p) {
  try { await fs.unlink(p); } catch {}
}
