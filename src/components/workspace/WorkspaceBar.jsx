// ─── ECON STUDIO · WorkspaceBar.jsx ──────────────────────────────────────────
// 7-tab workspace navigation bar rendered at the top of every project view.
// Left side: DatasetManager button (always visible in every tab).
// Right side: 7 tab buttons + theme toggle. Tabs requiring output are locked until pipeline runs.

import { useState } from "react";
import DatasetManager from "./DatasetManager.jsx";
import AppearancePanel from "./AppearancePanel.jsx";
import { useTheme } from "../../ThemeContext.jsx";
import { signOut } from "../../services/auth/authService.js";
import { clearAllLocalData } from "../../services/Persistence/indexedDB.js";


const TABS = [
  { id: "data",      label: "Data",      icon: "⬡", requiresOutput: false },
  { id: "clean",     label: "Clean",     icon: "⌾", requiresOutput: false },
  { id: "explore",   label: "Explore",   icon: "◈", requiresOutput: true  },
  { id: "model",     label: "Model",     icon: "⊞", requiresOutput: true  },
  { id: "spatial",   label: "Spatial",   icon: "⊙", requiresOutput: false },
  { id: "simulate",  label: "Stat & Simulation", icon: "∿", requiresOutput: false },
  { id: "calculate", label: "Calculate", icon: "∑", requiresOutput: false },
  { id: "report",    label: "Report",    icon: "⊟", requiresOutput: true  },
];

export default function WorkspaceBar({ activeTab, onTabChange, hasOutput, activeDatasetId, pid, onSelectDataset, onRemoveDataset, onStartTour, onOpenFeedback }) {
  const { C, T, theme, setTheme } = useTheme();
  const [showAppearance, setShowAppearance] = useState(false);

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
        pid={pid}
        onSelectDataset={onSelectDataset}
        onRemoveDataset={onRemoveDataset}
      />

      {/* ── Separator ── */}
      <div style={{ width: 1, background: C.border, flexShrink: 0, margin: "6px 0" }} />

      {/* ── Tab buttons ── */}
      <div style={{ display: "flex", alignItems: "stretch", paddingLeft: "0.25rem", overflow: "hidden", flex: 1 }}>
        {TABS.map(tab => {
          const isActive = tab.id === activeTab;
          const isLocked = tab.requiresOutput && !hasOutput;

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
                fontFamily: T.code.fontFamily,
                fontSize: T.code.fontSize,
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
              <span style={{ fontSize: T.caption.fontSize }}>{tab.icon}</span>
              <span>{tab.label}</span>
              {isLocked && (
                <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, marginLeft: 1 }}>🔒</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Feedback button ── */}
      <button
        onClick={() => onOpenFeedback?.()}
        title="Send feedback"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 32,
          flexShrink: 0,
          background: "transparent",
          border: "none",
          borderLeft: `1px solid ${C.border}`,
          color: C.textMuted,
          cursor: "pointer",
          fontSize: T.body.fontSize,
          fontFamily: T.code.fontFamily,
          transition: "color 0.12s",
        }}
        onMouseEnter={e => { e.currentTarget.style.color = C.teal; }}
        onMouseLeave={e => { e.currentTarget.style.color = C.textMuted; }}
      >
        ⚑
      </button>

      {/* ── Help / Tour button ── */}
      <button
        onClick={() => onStartTour?.()}
        title="Start tour"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 32,
          flexShrink: 0,
          background: "transparent",
          border: "none",
          borderLeft: `1px solid ${C.border}`,
          color: C.textMuted,
          cursor: "pointer",
          fontSize: T.body.fontSize,
          fontFamily: T.code.fontFamily,
          transition: "color 0.12s",
        }}
        onMouseEnter={e => { e.currentTarget.style.color = C.gold; }}
        onMouseLeave={e => { e.currentTarget.style.color = C.textMuted; }}
      >
        ?
      </button>

      {/* ── Theme toggle ── */}
      <button
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 32,
          flexShrink: 0,
          background: "transparent",
          border: "none",
          borderLeft: `1px solid ${C.border}`,
          color: C.textMuted,
          cursor: "pointer",
          fontSize: T.body.fontSize,
          transition: "color 0.12s",
        }}
        onMouseEnter={e => { e.currentTarget.style.color = C.gold; }}
        onMouseLeave={e => { e.currentTarget.style.color = C.textMuted; }}
      >
        {theme === "dark" ? "☀" : "☾"}
      </button>

      {/* ── Appearance settings ── */}
      <div style={{ position: "relative" }}>
        <button
          aria-label="Appearance settings"
          title="Appearance"
          onClick={() => setShowAppearance((s) => !s)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            flexShrink: 0,
            background: "transparent",
            border: "none",
            borderLeft: `1px solid ${C.border}`,
            color: C.textDim,
            cursor: "pointer",
            fontSize: T.body.fontSize,
            lineHeight: 1,
            height: "100%",
          }}
          onMouseEnter={e => { e.currentTarget.style.color = C.teal; }}
          onMouseLeave={e => { e.currentTarget.style.color = C.textDim; }}
        >⚙</button>
        {showAppearance && <AppearancePanel onClose={() => setShowAppearance(false)} />}
      </div>

      {/* ── Clear all local data ── */}
      <button
        onClick={async () => {
          if (!window.confirm("Clear ALL local data?\n\nThis deletes every dataset, pipeline, and project stored in this browser. This cannot be undone.")) return;
          await clearAllLocalData();
          window.location.reload();
        }}
        title="Clear all local data"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 32,
          flexShrink: 0,
          background: "transparent",
          border: "none",
          borderLeft: `1px solid ${C.border}`,
          color: C.textMuted,
          cursor: "pointer",
          fontSize: T.body.fontSize,
          fontFamily: T.code.fontFamily,
          transition: "color 0.12s",
        }}
        onMouseEnter={e => { e.currentTarget.style.color = C.red; }}
        onMouseLeave={e => { e.currentTarget.style.color = C.textMuted; }}
      >
        ⊘
      </button>

      {/* ── Sign out ── */}
      <button
        onClick={() => signOut()}
        title="Sign out"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 32,
          flexShrink: 0,
          background: "transparent",
          border: "none",
          borderLeft: `1px solid ${C.border}`,
          color: C.textMuted,
          cursor: "pointer",
          fontSize: T.code.fontSize,
          fontFamily: T.code.fontFamily,
          transition: "color 0.12s",
        }}
        onMouseEnter={e => { e.currentTarget.style.color = C.red; }}
        onMouseLeave={e => { e.currentTarget.style.color = C.textMuted; }}
      >
        ⏻
      </button>
    </div>
  );
}
