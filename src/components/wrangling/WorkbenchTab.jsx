// ─── ECON STUDIO · components/wrangling/WorkbenchTab.jsx ───────────────────
// Merged "Workbench" tab: feature engineering + reshape + merge, all visible
// at once, separated by GroupTitle bands (no nested subtabs). Each child was
// flattened (its internal <Tabs> removed) so every operation renders stacked.
import FeatureTab from "./FeatureTab.jsx";
import ReshapeTab from "./ReshapeTab.jsx";
import MergeTab   from "./MergeTab.jsx";

function WorkbenchTab({ rows, headers, info, panel, filename, allDatasets, onAdd, onForkJoin, duckdbTableName, joinContext = null, leftTotal = null, joinLeftTable = null }) {
  return (
    <div>
      <FeatureTab rows={rows} headers={headers} panel={panel} info={info}
        onAdd={onAdd} duckdbTableName={duckdbTableName}/>
      <ReshapeTab rows={rows} headers={headers} info={info} onAdd={onAdd}/>
      <MergeTab rows={rows} headers={headers} filename={filename}
        allDatasets={allDatasets} onAdd={onAdd} onForkJoin={onForkJoin}
        joinContext={joinContext} leftTotal={leftTotal} duckdbTableName={joinLeftTable}/>
    </div>
  );
}

export default WorkbenchTab;
