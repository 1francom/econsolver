// oecd-proxy: server-side proxy for OECD SDMX-JSON API (bypasses browser CORS).
// sdmx.oecd.org accepts JSON via the Accept header — no format= query param needed.

const OECD_BASE = "https://sdmx.oecd.org/public/rest";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, apikey, authorization",
};

// Try Accept headers in sequence; return the first non-406 response.
// Some datasets (e.g. DSD_NAAG@DF_NAAG_I) only support older SDMX-JSON versions.
const ACCEPT_SEQUENCE = [
  "application/vnd.sdmx.data+json; version=2",
  "application/vnd.sdmx.data+json; version=1.0.0",
  "application/json",
];

async function fetchWithFallback(url: string): Promise<Response> {
  let lastRes: Response | null = null;
  for (const accept of ACCEPT_SEQUENCE) {
    const res = await fetch(url, { headers: { Accept: accept } });
    if (res.status !== 406) return res;
    lastRes = res;
  }
  return lastRes!;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  try {
    const { dataset, key, startYear, endYear } = await req.json();

    const url =
      `${OECD_BASE}/data/${dataset}/${key}` +
      `?startPeriod=${startYear}&endPeriod=${endYear}&dimensionAtObservation=AllDimensions`;

    const res = await fetchWithFallback(url);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return new Response(
        JSON.stringify({ error: `OECD API error ${res.status}`, url, detail: body.slice(0, 500) }),
        { status: res.status, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Guard: if OECD returns non-JSON, report it instead of crashing
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("json")) {
      const text = await res.text();
      return new Response(
        JSON.stringify({ error: `OECD returned non-JSON (${contentType})`, url, detail: text.slice(0, 500) }),
        { status: 502, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const data = await res.json();
    return new Response(JSON.stringify(data), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String(e) }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
