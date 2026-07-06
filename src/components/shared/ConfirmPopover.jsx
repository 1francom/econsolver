// ─── ECON STUDIO · components/shared/ConfirmPopover.jsx ─────────────────────
// Small anchored popover for confirming a destructive action (clear/delete/
// sign out). Render inside a `position:relative` wrapper around the trigger
// button; mount only while the action is pending.
//
// Props:
//   message       — string shown above the buttons
//   confirmLabel  — text on the destructive button (default "Confirm")
//   onConfirm()
//   onCancel()
//   align         — "left" | "right" anchor edge (default "right")

import { useTheme } from "../../ThemeContext.jsx";

export default function ConfirmPopover({ message, confirmLabel = "Confirm", onConfirm, onCancel, align = "right" }) {
  const { C, T, space, radius, elev } = useTheme();

  return (
    <div
      style={{
        position: "absolute", top: "100%", [align]: 0, marginTop: space[2],
        width: 230, background: C.surface, ...elev.popover,
        borderRadius: radius.md, padding: space[4], zIndex: 1000,
        fontFamily: T.code.fontFamily,
      }}
      onClick={e => e.stopPropagation()}
    >
      <div style={{ ...T.caption, color: C.text, marginBottom: space[3], lineHeight: 1.5 }}>{message}</div>
      <div style={{ display: "flex", gap: space[2], justifyContent: "flex-end" }}>
        <button
          onClick={onCancel}
          style={{
            ...T.caption, padding: `${space[2]}px ${space[3]}px`, background: "transparent",
            border: `1px solid ${C.border2}`, color: C.textDim, borderRadius: radius.sm, cursor: "pointer",
          }}
        >Cancel</button>
        <button
          onClick={onConfirm}
          style={{
            ...T.caption, padding: `${space[2]}px ${space[3]}px`, background: C.red,
            border: "none", color: "#fff", borderRadius: radius.sm, cursor: "pointer", fontWeight: 700,
          }}
        >{confirmLabel}</button>
      </div>
    </div>
  );
}
