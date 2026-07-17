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

// Service-role client (lazy singleton) — used ONLY for privileged writes that
// mutate SHARED state and therefore must not be callable with the public anon
// key (i.e. add_free_pool_spend). Returns null when the key isn't configured, so
// callers fail open. Never use this for anything derived from the user's identity
// (it has no auth.uid()) — user-scoped RPCs keep running under the user's JWT.
let _svcClient = null;
function serviceClient() {
  if (_svcClient) return _svcClient;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  _svcClient = createClient(process.env.SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _svcClient;
}

// Credit cost per API call, based on model + expected output size.
// Haiku calls are cheap enough to be free; large-output calls (script
// replication, max_tokens >= 5000) cost 15; everything else costs 2.
function creditCost(body) {
  const model = body?.model ?? "";
  if (model.includes("haiku")) return 0;
  if ((body?.max_tokens ?? 0) >= 5000) return 15;
  return 2;
}

// Per-MTok list prices ($/1M tokens). Since $/MTok == micro-USD per token, these
// numbers ARE the per-token micro-USD input/output rates. Verify against
// platform.claude.com/pricing if models or prices change.
const PRICES = {
  opus:   { in: 5, out: 25 },  // claude-opus-4-8
  sonnet: { in: 3, out: 15 },  // claude-sonnet-4-6
  haiku:  { in: 1, out: 5  },  // claude-haiku-4-5
};
function priceFor(model = "") {
  const m = model.toLowerCase();
  if (m.includes("haiku"))  return PRICES.haiku;
  if (m.includes("sonnet")) return PRICES.sonnet;
  return PRICES.opus; // opus + any unknown default
}
// Real cost of one call in micro-USD from its usage. Ephemeral (5-min) cache:
// reads ≈ 0.1× input rate, writes ≈ 1.25× input rate.
function costMicros(model, u) {
  if (!u) return 0;
  const p  = priceFor(model);
  const inp = u.input_tokens ?? 0;
  const out = u.output_tokens ?? 0;
  const cr  = u.cache_read_input_tokens ?? 0;
  const cw  = u.cache_creation_input_tokens ?? 0;
  return Math.round(inp * p.in + out * p.out + cr * p.in * 0.1 + cw * p.in * 1.25);
}
// Add a free-tier call's real micro-USD cost to the aggregate monthly pool.
// Goes through the SERVICE-ROLE client: add_free_pool_spend mutates shared state
// with a caller-supplied amount, so it is NOT callable with the public anon key
// (revoked from anon/authenticated). Best-effort — never throws; if the service
// key is unset, the write is skipped (pool stops accruing → fail open).
async function addFreePoolSpend(model, usage) {
  const micros = costMicros(model, usage);
  if (micros <= 0) return;
  const svc = serviceClient();
  if (!svc) return;
  try {
    await svc.rpc("add_free_pool_spend", { p_micros: micros });
  } catch (err) {
    console.error("[proxy] add_free_pool_spend failed:", err?.message ?? err);
  }
}

// Best-effort usage log — writes one row via the SECURITY DEFINER RPC. Never
// throws into the request path: instrumentation must not break an AI call.
async function logUsage(supabase, { task, model, usage, advisorTokens = 0, cost = 0 }) {
  try {
    await supabase.rpc("log_ai_usage", {
      p_task:           (task ?? "misc").toString().slice(0, 40),
      p_model:          model ?? null,
      p_input:          usage?.input_tokens ?? 0,
      p_output:         usage?.output_tokens ?? 0,
      p_cache_read:     usage?.cache_read_input_tokens ?? 0,
      p_cache_creation: usage?.cache_creation_input_tokens ?? 0,
      p_advisor:        advisorTokens ?? 0,
      p_cost:           cost ?? 0,
    });
  } catch (err) {
    console.error("[proxy] log_ai_usage failed:", err?.message ?? err);
  }
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
  const task = (req.headers["x-litux-task"] ?? "misc").toString().slice(0, 40);

  // ── 3a. Resolve tier ONCE (Franco 2026-07-17) ───────────────────────────────
  // Anonymous (guest) users are free by definition — skip the profiles lookup.
  // Authenticated users get a single indexed PK read. Used by both gates below.
  const isAnon = !!user.is_anonymous;
  let tier = "free";
  if (!isAnon) {
    const { data: prof, error: tierErr } = await supabase
      .from("profiles").select("tier").eq("id", user.id).single();
    if (tierErr) {
      console.error("[proxy] tier lookup error:", tierErr.message);
      return res.status(500).json({ error: "Tier check failed" });
    }
    tier = prof?.tier ?? "free";
  }
  const isFree = isAnon || tier === "free";

  // ── 3b. Replication is a PAID-tier feature ──────────────────────────────────
  // Script replication (Opus, max_tokens >= 5000 → cost 15) is the single most
  // expensive call. Removed from the free tier entirely — free/guest rejected
  // BEFORE any credit is spent. Paid tiers pass through and pay the 15 credits.
  if (cost >= 15 && isFree) {
    return res.status(403).json({ error: "replication_paid_only" });
  }

  // ── 3c. Global monthly free-tier spend pool ─────────────────────────────────
  // Per-user credits still cap each head; this is an ADDITIONAL aggregate ceiling
  // on the whole free tier's real AI cost (market-research budget). When the
  // month's aggregate reaches the cap, free/guest AI degrades to a local message.
  // Fail-OPEN on infra error (e.g. migration not applied yet) — never hard-block
  // the coach on a pool-check failure.
  if (isFree) {
    const { data: exhausted, error: poolErr } = await supabase.rpc("free_pool_exhausted");
    if (poolErr) {
      console.error("[proxy] free_pool_exhausted error:", poolErr.message);
    } else if (exhausted === true) {
      return res.status(429).json({ error: "free_pool_exhausted" });
    }
  }

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
    // Sniff usage from the SSE passthrough without altering the forwarded bytes:
    // message_start carries input/cache tokens, message_delta the running output.
    const decoder  = new TextDecoder();
    const usageAgg = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    let sniff = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
        sniff += decoder.decode(value, { stream: true });
        const parts = sniff.split("\n\n");
        sniff = parts.pop() ?? "";
        for (const evt of parts) {
          const dl = evt.split("\n").find(l => l.startsWith("data:"));
          if (!dl) continue;
          try {
            const p = JSON.parse(dl.slice(5).trim());
            if (p.type === "message_start" && p.message?.usage) {
              const u = p.message.usage;
              usageAgg.input_tokens                = u.input_tokens ?? 0;
              usageAgg.cache_read_input_tokens     = u.cache_read_input_tokens ?? 0;
              usageAgg.cache_creation_input_tokens = u.cache_creation_input_tokens ?? 0;
              usageAgg.output_tokens               = u.output_tokens ?? 0;
            } else if (p.type === "message_delta" && p.usage?.output_tokens != null) {
              usageAgg.output_tokens = p.usage.output_tokens;
            }
          } catch { /* non-JSON keep-alive line */ }
        }
      }
    } catch {
      // client disconnect / upstream abort — fall through to end()
    }
    res.end();
    if (anthropicRes.ok) {
      await logUsage(supabase, { task, model: body.model, usage: usageAgg, cost });
      if (isFree) await addFreePoolSpend(body.model, usageAgg);
    }
    return;
  }

  const data = await anthropicRes.json();
  if (creditsRemaining !== null) res.setHeader("X-Credits-Remaining", creditsRemaining);
  if (anthropicRes.ok) {
    await logUsage(supabase, { task, model: body.model, usage: data?.usage, cost });
    if (isFree) await addFreePoolSpend(body.model, data?.usage);
  }
  return res.status(anthropicRes.status).json(data);
}
