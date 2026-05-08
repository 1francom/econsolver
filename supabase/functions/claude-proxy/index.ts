// ─── LITUX · Supabase Edge Function: claude-proxy ─────────────────────────────
// Proxies Anthropic API calls server-side so the API key never reaches the browser.
//
// Setup (one-time):
//   supabase secrets set ANTHROPIC_KEY=sk-ant-api03-...
//   supabase functions deploy claude-proxy --no-verify-jwt
//
// The function is intentionally open (no JWT required) — access is rate-limited
// by the Supabase project URL being non-public. Add JWT checks + subscription
// table lookup here when user auth is implemented.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_KEY") ?? "";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, anthropic-beta",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  if (!ANTHROPIC_KEY) {
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_KEY not configured. Run: supabase secrets set ANTHROPIC_KEY=sk-ant-..." }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  // ── Optional future hook: JWT + subscription check ────────────────────────
  // const authHeader = req.headers.get("Authorization");
  // if (authHeader) {
  //   const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  //   const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  //   const { data: sub } = await supabase.from("subscriptions").select("active").eq("user_id", user?.id).single();
  //   if (!sub?.active) return new Response(JSON.stringify({ error: "Premium required." }), { status: 402, headers: cors });
  // }

  try {
    const body = await req.json();

    // Forward prompt-caching beta header if the client sent it
    const betaHeader = req.headers.get("anthropic-beta") ?? "prompt-caching-2024-07-31";

    const upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta":    betaHeader,
      },
      body: JSON.stringify(body),
    });

    const data = await upstream.json();

    return new Response(JSON.stringify(data), {
      status: upstream.status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
