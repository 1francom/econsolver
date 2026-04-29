// ─── ECON STUDIO · WorkspaceBar.jsx ──────────────────────────────────────────
// 7-tab workspace navigation bar rendered at the top of every project view.
// Left side: DatasetManager button (always visible in every tab).
// Right side: 7 tab buttons. Tabs requiring output are locked until pipeline runs.

import DatasetManager from "./DatasetManager.jsx";

const C = {
  bg:"#080808", surface:"#0f0f0f", surface2:"#131313",
  border:"#1c1c1c", border2:"#252525",
  gold:"#c8a96e", goldDim:"#7a6040",
  text:"#ddd8cc", textDim:"#888", textMuted:"#444",
  teal:"#6ec8b4", violet:"#9e7ec8",
};
const mono = "'IBM Plex Mono','JetBrains Mono',Consolas,monospace";

const TABS = [
  { id: "data",      label: "Data",      icon: "⬡", requiresOutput: false },
  { id: "clean",     label: "Clean",     icon: "⌾", requiresOutput: false },
  { id: "explore",   label: "Explore",   icon: "◈", requiresOutput: true  },
  { id: "model",     label: "Model",     icon: "⊞", requiresOutput: true  },
  { id: "simulate",  label: "Simulate",  icon: "∿", requiresOutput: false },
  { id: "calculate", label: "Calculate", icon: "∑", requiresOutput: false },
  { id: "report",    label: "Report",    icon: "⊟", requiresOutput: true  },
];

export default function WorkspaceBar({ activeTab, onTabChange, hasOutput, activeDatasetId, onSelectDataset }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "stretch",
      height: 36,
      borderBottom: `1px solid ${C.border}`,
      background: C.surface,
      flexShrink: 0,
    }}>
      {/* ── Dataset Manager button — visible in every tab ── */}
      <DatasetManager
        activeDatasetId={activeDatasetId}
        onSelectDataset={onSelectDataset}
      />

      {/* ── Separator ── */}
      <div style={{ width: 1, background: C.border, flexShrink: 0, margin: "6px 0" }}/>

      {/* ── Tab buttons ── */}
      <div style={{ display: "flex", alignItems: "stretch", paddingLeft: "0.25rem", overflow: "hidden" }}>
        {TABS.map(tab => {
          const isActive   = tab.id === activeTab;
          const isLocked   = tab.requiresOutput && !hasOutput;

          return (
            <button
              key={tab.id}
              onClick={() => { if (!isLocked) onTabChange(tab.id); }}
              title={isLocked ? "Run pipeline in Clean tab first" : tab.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "0 0.8rem",
                background: isActive ? C.bg : "transparent",
                border: "none",
                borderBottom: isActive ? `2px solid ${C.teal}` : "2px solid transparent",
                borderTop: "2px solid transparent",
                color: isActive ? C.teal : isLocked ? C.textMuted : C.textDim,
                cursor: isLocked ? "not-allowed" : "pointer",
                fontFamily: mono,
                fontSize: 11,
                letterSpacing: "0.04em",
                transition: "color 0.12s, border-color 0.12s, background 0.12s",
                opacity: isLocked ? 0.42 : 1,
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
              onMouseEnter={e => {
                if (!isLocked && !isActive) e.currentTarget.style.color = C.text;
              }}
              onMouseLeave={e => {
                if (!isActive) e.currentTarget.style.color = isLocked ? C.textMuted : C.textDim;
              }}
            >
              <span style={{ fontSize: 10 }}>{tab.icon}</span>
              <span>{tab.label}</span>
              {isLocked && (
                <span style={{ fontSize: 8, color: C.textMuted, marginLeft: 1 }}>🔒</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
