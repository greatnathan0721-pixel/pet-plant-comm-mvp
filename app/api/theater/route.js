// app/api/theater/route.js
import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --------- 小工具（不依賴 zod） ----------
function ensureEnum(val, list, fb) { return list.includes(val) ? val : fb; }
function S(v, fb = "") { return typeof v === "string" ? v : fb; }
function B(v, fb = true) { return typeof v === "boolean" ? v : fb; }
function stripDataURL(u) { return typeof u === "string" && u.startsWith("data:") ? "" : u; }
function sanitizeLine(s, n = 80) { return S(s).replace(/\s+/g, " ").trim().slice(0, n); }

// 極短幹話備用（PG-13、無辱罵）
const QUIPS = [
  "別靠近我！我不認識你！",
  "先別摸，我還在評估你的人生價值。",
  "今天我只對零食開放友善模式。",
  "請帶著誠意和小魚乾再來談。",
  "我有在忙，忙著可愛。",
  "先排隊，謝謝配合。",
  "別急，我的親密度系統還在冷卻。",
];

// 把一段普通句子「幹話化」
function punchUpOneLiner(s) {
  const base = sanitizeLine(s, 50);
  if (!base) return QUIPS[Math.floor(Math.random() * QUIPS.length)];
  // 小幅度加料（避免太長、避免髒話）
  const tails = [" 懂？", " OK？", " 先謝謝。", " 我先說到這。", " 有意見私訊我經紀人。"];
  return (base + tails[Math.floor(Math.random() * tails.length)]).slice(0, 60);
}

// 解析 body（前端會丟 subjectImageData / humanImageData 為 dataURL）
function parseBody(body) {
  const subjectType = ensureEnum(body?.subjectType, ["pet", "plant"], "pet");
  const species = S(body?.species, subjectType === "plant" ? "plant" : "pet");
  const stylePreset = ensureEnum(
    body?.stylePreset,
    ["cute-cartoon", "storybook", "studio-portrait", "painted", "comic", "photo"],
    "photo"
  );
  const dialogue = {
    subject: S(body?.dialogue?.subject, ""),
    human: ""  // 永遠清空
  };
  const sceneContext = {
    mood: ensureEnum(body?.sceneContext?.mood, ["warm", "adventure", "serene", "playful", "mystery"], "warm"),
    environmentHint: S(body?.sceneContext?.environmentHint, ""),
    showBubbles: B(body?.sceneContext?.showBubbles, true),
  };
  const composition = { humanScale: 1/6, humanPosition: "bottom-left", enforceRules: true };

  return {
    // 文字欄位
    subjectType, species, stylePreset, dialogue, sceneContext, composition,
    // 參考URL（若前端給短網址可以加入；我們仍會過濾 dataURL）
    subjectImageUrl: stripDataURL(S(body?.subjectImageUrl, "")),
    humanImageUrl: stripDataURL(S(body?.humanImageUrl, "")),
    // 真正用於 image-to-image 的 dataURL（只傳後端，不進 prompt）
    subjectImageData: S(body?.subjectImageData, ""),
    humanImageData: S(body?.humanImageData, ""),
  };
}

// 把 dataURL 轉成 File（OpenAI SDK v4 輔助）
async function dataURLtoFile(dataURL, filename) {
  const base64 = dataURL.split(",")[1];
  if (!base64) return null;
  const buf = Buffer.from(base64, "base64");
  const { toFile } = await import("openai/uploads");
  // 猜 MIME：常見 image/jpeg / image/png
  const mime = dataURL.includes("png") ? "image/png" : "image/jpeg";
  return toFile(buf, filename, { type: mime });
}

export async function POST(req) {
  try {
    const body = await req.json();
    const p = parseBody(body);

    // 獨白（幹話風、PG-13）
    const bubbleText = p.sceneContext.showBubbles
      ? punchUpOneLiner(p.dialogue.subject)
      : "";

    const forbidCats =
      p.subjectType === "plant" ||
      (p.subjectType === "pet" && !/^(cat|cats|kitten|kittens)$/i.test(p.species));

    // 構建提示（不含 dataURL）
    let prompt = buildPromptText({
      ...p,
      dialogue: { subject: bubbleText, human: "" },
      forbidCats,
    });

    if (prompt.length > 30000) {
      // 保險刪掉參考行
      prompt = prompt.replace(/^Subject reference:.*$/gm, "")
                     .replace(/^Human reference:.*$/gm, "");
    }
    if (prompt.length > 32000) prompt = prompt.slice(0, 31900);

    const useEdit = !!p.subjectImageData; // 有主圖就走 edits
    let result;

    if (useEdit) {
      // --- Image-to-Image（以用戶主圖為 base），可帶入人像參考 ---
      const baseFile = await dataURLtoFile(p.subjectImageData, "subject.jpg");
      if (!baseFile) throw new Error("主圖 dataURL 解析失敗");

      // 可選：人像參考（第二張）
      let extraImages = [];
      if (p.humanImageData) {
        const humanFile = await dataURLtoFile(p.humanImageData, "human.jpg");
        if (humanFile) extraImages.push(humanFile);
      }

      // 嘗試帶兩張（base + human 參考）；若不被允許再退回只帶 base
      try {
        result = await client.images.edits({
          model: "gpt-image-1",
          image: baseFile,
          // @ts-ignore（SDK 允許陣列 image[]；如不支援會丟 400）
          additional_image: extraImages, // 有些版本參數名為 "image[]"/"images"，這裡作為 best-effort
          prompt,
          size: "1024x1024",
        });
      } catch (e) {
        // 版本不支援多圖 → 改用只有 base 的 edits
        result = await client.images.edits({
          model: "gpt-image-1",
          image: baseFile,
          prompt,
          size: "1024x1024",
        });
      }
    } else {
      // --- 純文字生成（沒有主圖時的保底） ---
      result = await client.images.generate({
        model: "gpt-image-1",
        prompt,
        size: "1024x1024",
      });
    }

    const url = result?.data?.[0]?.url;
    const b64 = result?.data?.[0]?.b64_json;
    if (!url && !b64) throw new Error("OpenAI 回傳空的影像資料");

    const imageUrl = url || `data:image/png;base64,${b64}`;
    return NextResponse.json({ ok: true, imageUrl, prompt, bubbleText }, { status: 200 });
  } catch (err) {
    console.error("THEATER_ROUTE_ERROR:", err);
    return NextResponse.json({ ok: false, error: err?.message || "Unknown error" }, { status: 400 });
  }
}

// 構建提示文字（不含任何 dataURL）
function buildPromptText(input) {
  const {
    subjectType, species, stylePreset, dialogue, sceneContext, composition,
    subjectImageUrl, humanImageUrl, forbidCats,
  } = input;

  const style =
    stylePreset === "photo"       ? "Style: realistic photography, cinematic light, shallow depth of field."
  : stylePreset === "storybook"   ? "Style: warm storybook illustration, watercolor textures."
  : stylePreset === "painted"     ? "Style: painterly illustration with brush strokes."
  : stylePreset === "comic"       ? "Style: comic panel with crisp lines and halftones."
  : stylePreset === "studio-portrait" ? "Style: studio portrait lighting, soft rim light."
  : "Style: cute cartoon, rounded shapes, gentle palette.";

  const lines = [
    `Subject: ${subjectType} (${species}).`,
    subjectImageUrl ? `Subject reference: ${subjectImageUrl}` : "",
    humanImageUrl ? `Human reference: ${humanImageUrl}` : "",
    // 幹話氣泡（只給主角）
    dialogue?.subject
      ? `Speech bubble (subject only, Traditional Chinese, irreverent PG-13, snarky like South Park PC Principal but safe, no slurs): “${sanitizeLine(dialogue.subject, 70)}”`
      : "No speech bubble if subject dialogue is empty.",
    // 場景與構圖規範
    `Mood: ${sceneContext?.mood || "warm"}.`,
    sceneContext?.environmentHint ? `Environment hint: ${sanitizeLine(sceneContext.environmentHint, 80)}` : "Environment: cozy, softly lit background.",
    style,
    "Aspect: 1:1 square, 1024x1024.",
    "Composition rules:",
    "- Make the primary subject large and central.",
    "- Include the human only if provided; place human at bottom-left, scaled to exactly 1/6 of the subject height; human is silent and has NO speech bubble.",
    "- Draw a clean speech bubble for the subject only if text is provided.",
    "Typography: bubble uses clean rounded font, high legibility.",
    "RULES:",
    "- Only the PET/PLANT may speak.",
    "- Human must be silent.",
    forbidCats
      ? "- Do NOT add cats/felines unless species is explicitly 'cat'."
      : "- Cat elements allowed only if species is 'cat'.",
  ].filter(Boolean);

  return lines.join("\n");
}
