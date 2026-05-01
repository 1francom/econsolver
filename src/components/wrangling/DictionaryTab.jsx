// ─── ECON STUDIO · components/wrangling/DictionaryTab.jsx ──────────────────
import { useState, useEffect } from "react";
import { useTheme, mono, Lbl, Btn, Grid } from "./shared.jsx";
import { callAI } from "./utils.js";

// ─── DATA DICTIONARY TAB ─────────────────────────────────────────────────────
// Allows AI inference of column descriptions + manual editing.
// Props: headers, rows (sample), dict, setDict
function DataDictionaryTab({ headers, rows, dict, setDict }) {
  const { C } = useTheme();
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const [done,    setDone]    = useState(false);

  const infer = async () => {
    setLoading(true);
    setError("");
    setDone(false);
    try {
      const result = await inferVariableUnits(headers, rows.slice(0, 3));
      setDict(result);
      setDone(true);
    } catch (e) {
      setError(e?.message ?? "Inference failed. Check your API connection.");
    } finally {
      setLoading(false);
    }
  };

  const updateDesc = (col, val) => setDict(d => ({ ...d, [col]: val }));

  const hasDict = dict && Object.keys(dict).length > 0;

  return (
    <div>
      {/* ── Info banner ── */}
      <div style={{
        padding: "0.65rem 1rem", background: C.surface,
        border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.violet}`,
        borderRadius: 4, marginBottom: "1.2rem",
        fontSize: 11, color: C.textDim, lineHeight: 1.7,
        display: "flex", alignItems: "flex-start", gap: 10,
      }}>
        <span style={{ color: C.violet, fontSize: 13, lineHeight: 1 }}>◈</span>
        <div>
          <span style={{ color: C.text }}>Data Dictionary</span>
          {" — "}
          Map each column to a human-readable description. The AI Narrative in
          the Reporting Module uses these to phrase coefficients naturally
          (e.g.{" "}
          <span style={{ color: C.gold, fontFamily: mono }}>"one additional year of education"</span>
          {" "}instead of{" "}
          <span style={{ color: C.red, fontFamily: mono }}>"a 1 unit increase in educ"</span>
          ).
        </div>
      </div>

      {/* ── AI infer button ── */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: "1.2rem", flexWrap: "wrap" }}>
        <Btn
          onClick={infer}
          dis={loading}
          color={C.violet}
          v="solid"
          ch={loading ? "Inferring…" : "✦ Infer Descriptions with AI"}
        />
        {loading && <Spin />}
        {done && !loading && (
          <span style={{ fontSize: 10, color: C.green, fontFamily: mono }}>
            ✓ Inferred {headers.length} descriptions — edit below as needed.
          </span>
        )}
        {hasDict && !loading && !done && (
          <span style={{ fontSize: 10, color: C.textMuted, fontFamily: mono }}>
            Dictionary loaded — edit any cell directly.
          </span>
        )}
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{
          fontSize: 11, color: C.red, fontFamily: mono, lineHeight: 1.6,
          padding: "0.65rem 1rem", border: `1px solid ${C.red}40`,
          borderLeft: `3px solid ${C.red}`, borderRadius: 4, marginBottom: "1rem",
        }}>
          ⚠ {error}
        </div>
      )}

      {/* ── Editable table ── */}
      {hasDict ? (
        <div style={{ overflowX: "auto", borderRadius: 4, border: `1px solid ${C.border}` }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11, fontFamily: mono }}>
            <thead>
              <tr style={{ background: C.surface2 }}>
                {[["Variable", "34%", C.textDim], ["Description", "66%", C.textDim]].map(([label, w, c]) => (
                  <th key={label} style={{
                    width: w, padding: "0.45rem 0.85rem", textAlign: "left",
                    fontSize: 9, color: c, letterSpacing: "0.18em",
                    textTransform: "uppercase", fontWeight: 400,
                    borderBottom: `1px solid ${C.border}`,
                  }}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {headers.map((h, i) => {
                const desc = dict[h] ?? "";
                const isDummy  = desc.startsWith("dummy");
                const isLog    = desc.startsWith("log of");
                const accent   = isDummy ? C.purple : isLog ? C.teal : C.gold;
                return (
                  <tr key={h} style={{ background: i % 2 === 0 ? C.surface : C.surface2 }}>
                    {/* Variable name (read-only) */}
                    <td style={{
                      padding: "0.45rem 0.85rem",
                      borderBottom: `1px solid ${C.border}`,
                      color: accent, fontFamily: mono, fontSize: 11,
                      whiteSpace: "nowrap",
                    }}>
                      {h}
                      {isDummy  && <span style={{ marginLeft: 6, fontSize: 9, color: C.purple, opacity: 0.7 }}>dummy</span>}
                      {isLog    && <span style={{ marginLeft: 6, fontSize: 9, color: C.teal, opacity: 0.7 }}>log</span>}
                    </td>
                    {/* Editable description */}
                    <td style={{ padding: "0.3rem 0.65rem", borderBottom: `1px solid ${C.border}` }}>
                      <input
                        value={desc}
                        onChange={e => updateDesc(h, e.target.value)}
                        placeholder="Enter description…"
                        style={{
                          width: "100%", padding: "0.32rem 0.55rem",
                          background: "transparent",
                          border: `1px solid transparent`,
                          borderRadius: 3, color: C.text,
                          fontFamily: mono, fontSize: 11, outline: "none",
                          transition: "border-color 0.13s",
                        }}
                        onFocus={e  => { e.target.style.borderColor = C.border2; e.target.style.background = C.surface3; }}
                        onBlur={e   => { e.target.style.borderColor = "transparent"; e.target.style.background = "transparent"; }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* ── Empty state ── */
        <div style={{
          padding: "2.5rem 1.5rem", textAlign: "center",
          border: `1px dashed ${C.border2}`, borderRadius: 4,
        }}>
          <div style={{ fontSize: 24, marginBottom: 10 }}>◈</div>
          <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.7 }}>
            Click <span style={{ color: C.violet }}>"Infer Descriptions with AI"</span> to
            auto-populate the dictionary from your column names and sample data,
            or add descriptions manually after the table appears.
          </div>
        </div>
      )}

      {/* ── Manual add hint ── */}
      {!hasDict && (
        <div style={{ marginTop: "1rem", display: "flex", gap: 8 }}>
          <Btn
            onClick={() => {
              const empty = {};
              headers.forEach(h => { empty[h] = ""; });
              setDict(empty);
            }}
            color={C.textDim}
            sm
            ch="Create empty dictionary"
          />
        </div>
      )}
    </div>
  );
}


export default DataDictionaryTab;
