// app/api/chat/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// ---- env ----
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CACHE_TTL_SECONDS = parseInt(process.env.RESPONSE_CACHE_TTL || "604800", 10); // 7天

// MVP：不做任何每日次數限制（這支無限制邏輯）
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ---- Chat with fallback ----
async function chatWithFallback(messages, temperature = 0.5) {
  // 你原本的候選；要升級可改為 ["gpt-4o-mini", "gpt-4.1-mini"]
  const candidates = ["gpt-4o-mini", "gpt-3.5-turbo"];
  let lastError;

  for (const model of candidates) {
    try {
      const chat = await openai.chat.completions.create({
        model,
        messages,
        temperature
      });
      const text = chat?.choices?.[0]?.message?.content?.trim();
      if (text) return { text, modelUsed: model };
      lastError = new Error("Empty completion");
    } catch (err) {
      const status = err?.status;
      const code = err?.code || err?.error?.code;
      const msg = (err?.message || "").toLowerCase();
      const soft =
        status === 429 ||
        code === "insufficient_quota" ||
        code === "rate_limit_exceeded" ||
        msg.includes("quota") ||
        msg.includes("rate limit") ||
        msg.includes("insufficient");
      if (!soft) throw err;
      lastError = err;
    }
  }
  throw lastError || new Error("All models failed");
}

// ---- helpers ----
function envOk() {
  return {
    OPENAI_API_KEY: !!OPENAI_API_KEY,
    SUPABASE_URL: !!SUPABASE_URL,
    SUPABASE_SERVICE_KEY: !!SUPABASE_SERVICE_KEY,
  };
}

function hashKey(parts) {
  const h = crypto.createHash("sha256");
  h.update(JSON.stringify(parts));
  return h.digest("hex");
}

// 命中就自動 +1，並回傳 payload 與命中前的 hits
async function getCached(hash) {
  const now = new Date().toISOString();
  const { data } = await supabase
    .from("response_cache")
    .select("payload, expire_at, hits")
    .eq("hash_key", hash)
    .gte("expire_at", now)
    .maybeSingle();

  if (!data) return null;

  // 命中就 +1
  await supabase
    .from("response_cache")
    .update({ hits: (data.hits || 0) + 1 })
    .eq("hash_key", hash);

  return { payload: data.payload, hits: data.hits ?? 0 };
}

async function setCached(hash, payload) {
  const expireAt = new Date(Date.now() + CACHE_TTL_SECONDS * 1000).toISOString();
  await supabase
    .from("response_cache")
    .upsert(
      { hash_key: hash, payload, expire_at: expireAt, hits: 0 },
      { onConflict: "hash_key" }
    );
}

async function resolveIntent(speciesSlug, intentSlug, text) {
  if (intentSlug) {
    const { data } = await supabase
      .from("intents_with_species")
      .select("*")
      .eq("species_slug", speciesSlug)
      .eq("slug", intentSlug)
      .limit(1);
    if (data?.[0]) return data[0];
  }
  const { data } = await supabase.rpc("search_intents", {
    p_species_slug: speciesSlug,
    p_query: text || ""
  });
  return data?.[0] ?? null;
}

async function loadRagByIntentId(intentId) {
  const [{ data: contexts }, { data: knowledge }, { data: fun }] = await Promise.all([
    supabase.from("contexts").select("severity, context_zh, context_en").eq("intent_id", intentId).limit(3),
    supabase.from("knowledge").select("body_zh, body_en").eq("intent_id", intentId).limit(3),
    supabase.from("fun_responses").select("text_zh, text_en").eq("intent_id", intentId).limit(5),
  ]);
  return { contexts: contexts || [], knowledge: knowledge || [], fun: fun || [] };
}

function sysPrompt(lang) {
  return lang === "zh"
    ? `你是《寵物植物溝通 App》助理，用繁體中文回答。
輸出結構：
1) 情境解讀（2-3句）
2) 專業建議（3-5點，具體步驟）
3) 趣味一句話（可愛但不喧賓奪主）
必要時加入「就醫/專業協助」提醒。不得做醫療診斷。`
    : `You are the Pets & Plants Communication assistant. Reply in English.
Output:
1) Situation interpretation (2-3 sentences)
2) Professional advice (3-5 bullets, actionable)
3) Fun one-liner (subtle)
Add “seek vet/pro help” when risk is high. No medical diagnosis.`;
}

function pickFun(list, lang) {
  if (!list?.length) return undefined;
  const x = list[Math.floor(Math.random() * list.length)];
  return lang === "zh" ? x.text_zh : x.text_en;
}

// ---------- GET: 健康檢查 ----------
export async function GET() {
  try {
    const envs = envOk();
    const { error: pingErr, count } = await supabase
      .from("intents")
      .select("*", { count: "exact", head: true });

    return NextResponse.json({
      ok: true,
      envs,
      supabase: {
        canQueryIntents: !pingErr,
        intentsCount: typeof count === "number" ? count : null,
        error: pingErr ? String(pingErr.message || pingErr) : null
      }
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

// ---------- POST: 主要聊天 ----------
export async function POST(req) {
  try {
    const envs = envOk();
    if (!envs.OPENAI_API_KEY || !envs.SUPABASE_URL || !envs.SUPABASE_SERVICE_KEY) {
      return NextResponse.json({ error: "Missing environment variables", details: envs }, { status: 500 });
    }

    const body = await req.json();
    const { species, userText, intentSlug, lang = "zh" } = body || {};
    if (!species || !userText) {
      return NextResponse.json({ error: "Missing species or userText" }, { status: 400 });
    }

    const intent = await resolveIntent(species, intentSlug, userText);
    const intentKey = intent?.slug || "general";
    const cacheKey = hashKey({ s: species, i: intentKey, q: userText, l: lang });

    // 命中快取 → 直接回覆，並附上 _cache / _hits
    const cached = await getCached(cacheKey);
    if (cached) {
      return NextResponse.json({ ...cached.payload, _cache: "hit", _hits: (cached.hits ?? 0) + 1 });
    }

    const rag = intent ? await loadRagByIntentId(intent.id) : { contexts: [], knowledge: [], fun: [] };

    const ragBlock =
      lang === "zh"
        ? `【情境模板】\n${rag.contexts.map((c) => c.context_zh).join("\n")}\n\n【專業建議庫】\n- ${rag.knowledge.map((k) => k.body_zh).join("\n- ")}`
        : `【Context Templates】\n${rag.contexts.map((c) => c.context_en).join("\n")}\n\n【Knowledge】\n- ${rag.knowledge.map((k) => k.body_en).join("\n- ")}`;

    const userMsg =
      lang === "zh"
        ? `使用者描述：${userText}\n意圖：${intentKey}`
        : `User description: ${userText}\nIntent: ${intentKey}`;

    const { text, modelUsed } = await chatWithFallback(
      [
        { role: "system", content: sysPrompt(lang) },
        { role: "system", content: ragBlock },
        { role: "user", content: userMsg }
      ],
      0.5
    );

    const payload = {
      reply: text,
      fun: pickFun(rag.fun, lang),
      sources: intent ? [{ type: "db", intent: intent.slug }] : [],
      model: modelUsed
    };

    await setCached(cacheKey, payload);
    return NextResponse.json({ ...payload, _cache: "miss", _hits: 0 });
  } catch (e) {
    return NextResponse.json({ error: "Internal error", details: String(e?.message || e) }, { status: 500 });
  }
}
