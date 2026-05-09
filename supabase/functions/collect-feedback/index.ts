import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const AGENT_SECRET = Deno.env.get("AGENT_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

Deno.serve(async (req) => {
  // Auth check
  const secret = req.headers.get("x-secret");
  if (!secret || secret !== AGENT_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const body = await req.json().catch(() => ({}));
  const action = body.action;

  // Fetch unprocessed rows
  if (action === "fetch") {
    const { data, error } = await supabase
      .from("feedback")
      .select("*")
      .or("processed.eq.false,processed.is.null");

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ rows: data }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Mark rows as processed
  if (action === "mark_processed") {
    const ids: number[] = body.ids ?? [];
    if (ids.length === 0) {
      return new Response(JSON.stringify({ updated: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const { error, count } = await supabase
      .from("feedback")
      .update({ processed: true })
      .in("id", ids);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ updated: count }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "Unknown action" }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
});
