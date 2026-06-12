// ─── ECON STUDIO · sessionState.js ───────────────────────────────────────────
// Session-level dataset registry and global pipeline store.
// Thin coordination layer — actual data rows + per-dataset pipeline steps live
// in DataStudio / WranglingModule (IndexedDB). This context stores metadata only.
//
// Mounted at workspace level with key={pid} so each project gets a fresh state.

import { createContext, useContext, useReducer, useEffect, useRef } from "react";
import { saveSessionMeta, loadSessionMeta } from "../Persistence/indexedDB.js";

// ─── CONTEXT ─────────────────────────────────────────────────────────────────
const StateCtx    = createContext(null);
const DispatchCtx = createContext(null);

// ─── INITIAL STATE ────────────────────────────────────────────────────────────
const initialState = {
  // { [id]: DatasetMeta }
  // DatasetMeta: { id, name, source, rowCount, colCount, headers[],
  //                crs?, loadOpts? }
  // source: 'loaded' | 'derived' | 'simulated' | 'calculated'
  // loadOpts: { format: 'csv' | 'tsv' | 'excel' | 'stata' | 'rds' | 'parquet' |
  //                     'shapefile-dbf' | 'shapefile-shp' | 'shapefile-zip',
  //             delimiter?, encoding?, sheetName?, engine? }
  //   — captured at parse time by DataStudio.parseFile so replication scripts
  //     and the Report-AI can faithfully recreate the load step.
  datasets: {},

  primaryDatasetId: null,

  // G-steps for cross-dataset operations (phase 9.3)
  // { id, type, leftId, rightId, outputId, params }
  globalPipeline: [],

  // Calculate tab variable workspace (phase 9.7)
  calcWorkspace: {
    variables: [],  // { id, name, type, value }
  },
};

// ─── REDUCER ──────────────────────────────────────────────────────────────────
function reducer(state, action) {
  switch (action.type) {

    case "REGISTER_DATASET":
      return {
        ...state,
        datasets: { ...state.datasets, [action.dataset.id]: action.dataset },
        primaryDatasetId: state.primaryDatasetId ?? action.dataset.id,
      };

    case "UPDATE_DATASET_META":
      return {
        ...state,
        datasets: {
          ...state.datasets,
          [action.id]: { ...state.datasets[action.id], ...action.patch },
        },
      };

    case "REMOVE_DATASET": {
      const { [action.id]: _removed, ...rest } = state.datasets;
      const newPrimary =
        state.primaryDatasetId === action.id
          ? Object.keys(rest)[0] ?? null
          : state.primaryDatasetId;
      return { ...state, datasets: rest, primaryDatasetId: newPrimary };
    }

    case "ADD_GLOBAL_STEP":
      return {
        ...state,
        globalPipeline: [...state.globalPipeline, action.step],
      };

    case "REMOVE_GLOBAL_STEP":
      return {
        ...state,
        globalPipeline: state.globalPipeline.filter(s => s.id !== action.id),
      };

    case "SET_CALC_WORKSPACE":
      return { ...state, calcWorkspace: action.workspace };

    case "HYDRATE_SESSION_META":
      return {
        ...state,
        globalPipeline: Array.isArray(action.meta?.globalPipeline) ? action.meta.globalPipeline : state.globalPipeline,
        calcWorkspace:  action.meta?.calcWorkspace ?? state.calcWorkspace,
      };

    default:
      return state;
  }
}

// ─── PROVIDER ─────────────────────────────────────────────────────────────────
export function SessionStateProvider({ children, pid = null }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const hydratedRef = useRef(false);

  // Hydrate cross-dataset lineage (globalPipeline) + calcWorkspace from IndexedDB
  // when the project opens. The dataset registry itself is restored separately by
  // DataStudio; G-steps reference stable dataset ids, so they resolve on reload.
  useEffect(() => {
    let cancelled = false;
    hydratedRef.current = false;
    if (!pid) { hydratedRef.current = true; return () => { cancelled = true; }; }
    loadSessionMeta(pid).then(meta => {
      if (cancelled) return;
      if (meta) dispatch({ type: "HYDRATE_SESSION_META", meta });
      hydratedRef.current = true;
    }).catch(() => { if (!cancelled) hydratedRef.current = true; });
    return () => { cancelled = true; };
  }, [pid]);

  // Debounced persist; never write before hydration completes (would clobber the
  // stored lineage with the empty initial state).
  useEffect(() => {
    if (!pid || !hydratedRef.current) return;
    const t = setTimeout(() => {
      saveSessionMeta(pid, { globalPipeline: state.globalPipeline, calcWorkspace: state.calcWorkspace }).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [pid, state.globalPipeline, state.calcWorkspace]);

  return (
    <StateCtx.Provider value={state}>
      <DispatchCtx.Provider value={dispatch}>
        {children}
      </DispatchCtx.Provider>
    </StateCtx.Provider>
  );
}

// ─── HOOKS ────────────────────────────────────────────────────────────────────
export function useSessionState()    { return useContext(StateCtx);    }
export function useSessionDispatch() { return useContext(DispatchCtx); }

// ─── ACTION CREATORS (convenience) ────────────────────────────────────────────
export function registerDataset(dispatch, dataset) {
  dispatch({ type: "REGISTER_DATASET", dataset });
}

export function updateDatasetMeta(dispatch, id, patch) {
  dispatch({ type: "UPDATE_DATASET_META", id, patch });
}

export function removeDataset(dispatch, id) {
  dispatch({ type: "REMOVE_DATASET", id });
}

export function addGlobalStep(dispatch, step) {
  dispatch({ type: "ADD_GLOBAL_STEP", step });
}

export function removeGlobalStep(dispatch, id) {
  dispatch({ type: "REMOVE_GLOBAL_STEP", id });
}

export function setCalcWorkspace(dispatch, workspace) {
  dispatch({ type: "SET_CALC_WORKSPACE", workspace });
}
