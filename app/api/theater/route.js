// app/api/theater/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 把 dataURL 轉為 {name, data:Buffer} 給 SDK 上傳
function dataURLtoFile(dataURL, filename = "file.png") {
  const [meta, b64] = (dataURL || "").split(",");
  if (!meta?.startsWith("data:image/") || !b64) return null;
  const buf = Buffer.from(b64, "base64");
  return { name: filename, data: buf };
}

export async function POST(req) {
  try {
    const { sceneData, humanData, bubbleText, lang = "zh", species = "pet" } =
      await req.json();

    if (!sceneData) {
      return NextResponse.json({ error: "Missing sceneData" }, { status: 400 });
    }

    const sceneFile = dataURLtoFile(sceneData, "scene.png");
    const humanFile = humanData ? dataURLtoFile(humanData, "human.png") : null;
    if (!sceneFile) {
      return NextResponse.json({ error: "Invalid sceneData" }, { status: 400 });
    }

    // Guideline（你定義的小人國規則）
    const guideline_zh = `
合成要求：
- 將人像小人國化，身高約為寵物/植物高度的 1/6。
- 臉部約 80% 相似原照，可更帥/更美，但不可走鐘、不可換人。
- 穿原始服裝（不要奇裝異服），與場景光影一致。
- 姿勢、表情要呼應寵物/植物當下心情（緊張→後退或半蹲安撫；慵懶→放鬆坐/蹲）。
- 視線必須看向寵物/植物。
- 對話泡泡只有寵物/植物一方，**人沒有台詞**。
- 在畫面中加入漫畫風黑邊泡泡，泡泡內文字使用繁體中文，內容：${bubbleText || "我今天心情很好～"}。
- 構圖自然不突兀；膚色、陰影、透視要合理。
`;

    const guideline_en = `
Compose these two images:
- Miniaturize the human to ~1/6 of the pet/plant's height.
- Face ~80% similar to the provided human photo, allow subtle beautification only.
- Keep the person's original clothes; match lighting to the scene.
- Pose/expression must respond to pet/plant mood (anxious→step back/crouch; relaxed→sit/chill).
- Person must look at the pet/plant.
- Only the pet/plant has a speech bubble (comic style black-outline). The person has NO text bubble.
- Add a comic-style speech bubble with the following text: ${bubbleText || "Feeling great today!"} (use Traditional Chinese if the UI is Chinese).
- Make shadows/perspective consistent and natural.
`;

    const prompt =
      lang === "zh"
        ? `請將下列兩張圖合成：背景為寵物/植物場景、人像小人國化。${guideline_zh}`
        : `Please compose the two images: scene (pet/plant) + human as miniature. ${guideline_en}`;

    // 使用 edits，把 scene/human 一起送進去做合成
    const images = [sceneFile, ...(humanFile ? [humanFile] : [])];
    const res = await openai.images.edits({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
      // 直接交給模型合成（不使用 mask）；它會根據 prompt 自行融合兩張圖
      image: images,
      // 為避免重口味風格，降低噪點
      n: 1,
      // 注意：不要加上 background removal；交給 prompt 做
    });

    const b64 = res?.data?.[0]?.b64_json;
    if (!b64) {
      return NextResponse.json(
        { error: "Image generation failed" },
        { status: 500 }
      );
    }
    const dataURL = `data:image/png;base64,${b64}`;
    return NextResponse.json({ image: dataURL });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Internal error", details: String(e?.message || e) },
      { status: 500 }
    );
  }
}
