// ─── ECON STUDIO · components/panels/PanelHost.jsx ────────────────────────────
// Mount point for APP-SCOPED floating panels. Lives as a sibling of the tab
// panels, never inside one: App keeps tab panels mounted with display:none to
// preserve their state, and display:none on an ancestor hides position:fixed
// descendants too — so a panel mounted inside a module disappears whenever that
// module is not on screen.
//
// That behaviour is correct for the distinct-values panel, whose columns belong
// to Clean. It is exactly wrong for a plot viewer, whose whole point is to stay
// visible while you build a model in another tab.

import ArtifactViewerPanel from "./ArtifactViewerPanel.jsx";

export default function PanelHost({ pid, datasets, artifactViewerOpen, onCloseArtifactViewer, onOpenArtifact }) {
  if (!artifactViewerOpen) return null;
  return (
    <ArtifactViewerPanel
      pid={pid}
      datasets={datasets}
      onOpen={onOpenArtifact}
      onClose={onCloseArtifactViewer}
    />
  );
}
