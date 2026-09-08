import { SYSTEM_PROMPT } from "../../src/kb.js";

// כתובות שמהן מותר לקרוא ל-API. החליפו בכתובת האתר שלכם.
// כל בקשה ממקור אחר נדחית, כדי שאתרים אחרים לא ישתמשו בחשבון שלכם.
const ALLOWED_ORIGINS = [
  "https://msw-bot.pages.dev",
  "https://sw.huji.ac.il",
];

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1000;
const MAX_MESSAGES = 30;
const MAX_CHARS = 4000;

function cors(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function fail(status, message, origin) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });
}

export async function onRequestOptions({ request }) {
  return new Response(null, { status: 204, headers: cors(request.headers.get("Origin")) });
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin");

  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return fail(403, "מקור לא מורשה", origin);
  }
  if (!env.ANTHROPIC_API_KEY) {
    return fail(500, "המפתח אינו מוגדר בשרת", origin);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "בקשה לא תקינה", origin);
  }

  // מקבלים מהדפדפן אך ורק את ההודעות. הפרומפט, המודל ותקרת האורך
  // נקבעים כאן, כדי שאי אפשר יהיה להשתמש בנתיב הזה כ-Claude חופשי.
  const messages = Array.isArray(body?.messages) ? body.messages : null;
  if (!messages || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return fail(400, "מבנה ההודעות אינו תקין", origin);
  }
  for (const m of messages) {
    if (
      (m.role !== "user" && m.role !== "assistant") ||
      typeof m.content !== "string" ||
      m.content.length > MAX_CHARS
    ) {
      return fail(400, "מבנה ההודעות אינו תקין", origin);
    }
  }

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });

  if (!upstream.ok) {
    return fail(502, "השירות אינו זמין כרגע", origin);
  }

  const data = await upstream.json();
  return new Response(JSON.stringify({ content: data.content }), {
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });
}
