// ─── api/anthropic.js — Vercel Serverless Function ───────────────────────────
// Server-side proxy for Anthropic API.
// • Validates the user's Supabase JWT.
// • Atomically deducts credits via spend_credits() RPC before forwarding.
//   Cost: 0 for Haiku, 15 for replication (max_tokens >= 5000), 2 otherwise.
//   Returns 402 {error:"insufficient_credits"} when balance is zero.
// • Forwards the request to Anthropic using the server-side API key.
//
// Required Vercel environment variables (set in dashboard, NOT in .env):
//   ANTHROPIC_API_KEY      — Anthropic secret key (never exposed to browser)
//   SUPABASE_URL           — same value as VITE_SUPABASE_URL
//   SUPABASE_ANON_KEY      — same value as VITE_SUPABASE_ANON_KEY

import { createClient } from "@supabase/supabase-js";

// Vercel Pro: extend function timeout to 60s for long AI responses.
// On Hobby plan this is ignored (max 10s) — streaming would be needed there.
export const maxDuration = 60;

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

// Credit cost per API call, based on model + expected output size.
// Haiku calls are cheap enough to be free; large-output calls (script
// replication, max_tokens >= 5000) cost 15; everything else costs 2.
function creditCost(body) {
  const model = body?.model ?? "";
  if (model.includes("haiku")) return 0;
  if ((body?.max_tokens ?? 0) >= 5000) return 15;
  return 2;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── 1. Extract JWT ──────────────────────────────────────────────────────────
  const authHeader = req.headers.authorization ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing Authorization header" });
  }
  const token = authHeader.slice(7);

  // ── 2. Validate JWT ────────────────────────────────────────────────────────
  // createClient with the user's JWT as the auth header: all queries (incl.
  // spend_credits RPC) run in the user's RLS context — no service role needed.
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  // ── 3. Deduct credits (atomic, server-side) ────────────────────────────────
  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const cost = creditCost(body);
  let creditsRemaining = null;
  if (cost > 0) {
    const { data: remaining, error: creditErr } = await supabase.rpc("spend_credits", { p_amount: cost });
    if (creditErr) {
      console.error("[proxy] spend_credits error:", creditErr.message);
      return res.status(500).json({ error: "Credit check failed" });
    }
    if (remaining === -1) {
      return res.status(402).json({ error: "insufficient_credits" });
    }
    creditsRemaining = remaining;
  }

  // ── 4. Forward to Anthropic ─────────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[proxy] ANTHROPIC_API_KEY not set in Vercel env");
    return res.status(500).json({ error: "Server misconfiguration" });
  }

  let anthropicRes;
  try {
    anthropicRes = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta":    "prompt-caching-2024-07-31",
      },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    return res.status(502).json({ error: `Upstream network error: ${networkErr.message}` });
  }

  // Streaming pass-through: forward the upstream SSE bytes unchanged so the
  // browser sees text deltas as they arrive and an abort halts generation.
  if (body.stream) {
    res.status(anthropicRes.status);
    res.setHeader("Content-Type",  "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection",    "keep-alive");
    if (creditsRemaining !== null) res.setHeader("X-Credits-Remaining", creditsRemaining);
    if (!anthropicRes.ok || !anthropicRes.body) {
      const errText = await anthropicRes.text();
      res.end(errText);
      return;
    }
    const reader = anthropicRes.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    } catch {
      // client disconnect / upstream abort — fall through to end()
    }
    res.end();
    return;
  }

  const data = await anthropicRes.json();
  if (creditsRemaining !== null) res.setHeader("X-Credits-Remaining", creditsRemaining);
  return res.status(anthropicRes.status).json(data);
}
