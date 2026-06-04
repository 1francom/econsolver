// ─── api/anthropic.js — Vercel Serverless Function ───────────────────────────
// Server-side proxy for Anthropic API.
// • Validates the user's Supabase JWT.
// • Checks profiles.tier — rejects non-premium users with 403.
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
const PREMIUM_TIERS = new Set(["premium", "pro"]);

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

  // ── 2. Validate JWT + tier check ────────────────────────────────────────────
  // createClient with the user's JWT as the auth header: all queries run in
  // the user's RLS context — no service role key needed.
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("tier")
    .eq("id", user.id)
    .single();

  if (profileErr) {
    console.error("[proxy] profiles query error:", profileErr.message);
    return res.status(500).json({ error: "Could not verify account tier" });
  }

  if (!PREMIUM_TIERS.has(profile?.tier)) {
    return res.status(403).json({ error: "premium_required" });
  }

  // ── 3. Forward to Anthropic ─────────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[proxy] ANTHROPIC_API_KEY not set in Vercel env");
    return res.status(500).json({ error: "Server misconfiguration" });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
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
  return res.status(anthropicRes.status).json(data);
}
