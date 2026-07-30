// ─── ECON STUDIO · components/wrangling/WorkbenchTab.jsx ───────────────────
// Merged "Workbench" tab: feature engineering + reshape + merge, all visible
// at once, separated by GroupTitle bands (no nested subtabs). Each child was
// flattened (its internal <Tabs> removed) so every operation renders stacked.
import { useState, useCallback } from "react";
import FeatureTab from "./FeatureTab.jsx";
import ReshapeTab from "./ReshapeTab.jsx";
import MergeTab   from "./MergeTab.jsx";
import DistinctValuesPanel from "./DistinctValuesPanel.jsx";

function WorkbenchTab({ rows, headers, info, panel, filename, allDatasets, onAdd, duckdbTableName }) {
  // Rendered one level above FeatureTab/ReshapeTab/MergeTab (not inside
  // FeatureTab.jsx) so it floats above the whole Workbench page — including
  // if the user has scrolled into the Reshape or Merge sections — instead of
  // being tied to Feature's own scroll position.
  const [distinctCol, setDistinctCol] = useState(null);       // string | null — null = not mounted
  const [distinctMinimized, setDistinctMinimized] = useState(false);

  const openDistinct = useCallback((col) => {
    setDistinctCol(col);
    // Opening a (possibly different) column always re-expands — the user
    // just took an action to view something, so it shouldn't stay hidden.
    setDistinctMinimized(false);
  }, []);

  return (
    <div>
      <FeatureTab rows={rows} headers={headers} panel={panel} info={info}
        onAdd={onAdd} duckdbTableName={duckdbTableName} onViewDistinct={openDistinct}/>
      <ReshapeTab rows={rows} headers={headers} info={info} onAdd={onAdd}/>
      <MergeTab rows={rows} headers={headers} filename={filename}
        allDatasets={allDatasets} onAdd={onAdd}/>
      {distinctCol && (
        <DistinctValuesPanel
          col={distinctCol}
          tableName={duckdbTableName}
          rows={rows}
          minimized={distinctMinimized}
          onToggleMinimize={() => setDistinctMinimized(m => !m)}
          onClose={() => setDistinctCol(null)}
        />
      )}
    </div>
  );
}

export default WorkbenchTab;
