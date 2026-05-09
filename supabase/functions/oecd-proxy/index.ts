// oecd-proxy: server-side proxy for OECD SDMX-JSON API (bypasses browser CORS).
// Uses sdmx.oecd.org/public/rest with full dataflow IDs (e.g. OECD.SDD.NAD,DSD_NAAG@DF_NAAG_I).
// dimensionAtObservation=AllDimensions puts REF_AREA + TIME_PERIOD in observation keys
// so the front-end SDMX-JSON parser can locate them by id.

const OECD_BASE = "https://sdmx.oecd.org/public/rest";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, apikey, authorization",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  try {
    const { dataset, key, startYear, endYear } = await req.json();

    // Full URL: /data/{dataflow}/{key}?format=json&startPeriod=...&endPeriod=...&dimensionAtObservation=AllDimensions
    const url = [
      `${OECD_BASE}/data/${dataset}/${key}`,
      `?format=json`,
      `&startPeriod=${startYear}`,
      `&endPeriod=${endYear}`,
      `&dimensionAtObservation=AllDimensions`,
    ].join("");

    const res = await fetch(url, {
      headers: { Accept: "application/vnd.sdmx.data+json" },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return new Response(
        JSON.stringify({ error: `OECD API error ${res.status}`, url, detail: body.slice(0, 300) }),
        { status: res.status, headers: { ...CORS, "Content-Type": "application/json" } }
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
