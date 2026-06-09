// ─── ECON STUDIO · modeling/runners/estimationDispatch.js ─────────────────────
// Pure per-estimator dispatch extracted from ModelingTab._runEstimation.
// No React — takes the already-resolved row set plus a `ctx` bundle of all the
// model state it needs, and returns { result, panelFE, panelFD } | { error }.
// The caller (ModelingTab) keeps the useCallback + dep array so memoization and
// the historical stale-closure guards are unchanged; this file is just the body.

import {
  runOLS, runWLS, run2SLS, runFE, runFD, runSharpRDD,
  run2x2DiD, runTWFEDiD, ikBandwidth,
  runLogit, runProbit,
  runGMM, runLIML, runIVPoisson,
  runFuzzyRDD, runEventStudy, runLSDV, runPoisson, runPoissonFE, runPoissonFEMulti, runNegBinFE,
  runSunAbraham, runSyntheticControl, runCallawayCS,
  runSpatialRDD, runSpatialRegressionFromRows,
  wrapResult, diagnoseFit,
} from "../../../math/index.js";
import { applyFactors, expandInteractions, resolveEstimator } from "../helpers.js";

export function dispatchEstimation(dataRows, ctx) {
  const {
    yVar, xVars, wVars, factorVars,
    interactionTerms = [],
    model, family, weightVar, seOpts, seType, panel,
    zVars, postVar, treatVar,
    runningVar, cutoff, bwMode, bwManual, kernel, polyOrder,
    treatedUnit, synthTreatTime, treatTimeCol, kPre, kPost, lsdvTimeFE,
    poissonEntityCol, poissonOffsetCol, poissonExtraFE,
    cohortCol, periodCol, saUnitCol, saControlMode, saRefPeriod,
    csTreatCol, csEntityCol, csTimeCol, csCompGroup, csRelMin, csRelMax,
    spatialModel, spatialWeightsMode, spatialGeomCol, spatialWeightsDatasetId,
    resolveSpatialWeights,
  } = ctx;

  const y = yVar[0];
  if (!y) return { error: "Select a dependent variable (Y)." };
  // ── Interaction + factor expansion (outside try to avoid TDZ) ──────────────
  const { rows: ixRows, xVars: ixX, wVars: ixW } =
    expandInteractions(dataRows, xVars, wVars, interactionTerms, factorVars);
  const { rows: _r1, vars: expX } = applyFactors(ixRows, ixX, factorVars);
  const { rows: expRows, vars: expW } = applyFactors(_r1, ixW, factorVars);
  dataRows = expRows; // parameter reassignment: safe in JS
  const effModel = resolveEstimator(model, family, !!weightVar[0]);
  try {
    const allX = [...expX, ...expW];

    if (effModel === "OLS") {
      if (!allX.length) return { error: "Select at least one regressor." };
      const res = runOLS(dataRows, y, allX, seOpts);
      if (!res) return { error: diagnoseFit(dataRows, y, allX, null) };
      return { result: wrapResult("OLS", res, { yVar: y, xVars: expX, wVars: expW, weightCol: null }), panelFE: null, panelFD: null };

    } else if (effModel === "FE") {
      if (!allX.length) return { error: "Select at least one regressor." };
      const ec = panel.entityCol, tc = panel.timeCol;
      const feRaw = runFE(dataRows, y, allX, ec, tc, seOpts);
      if (!feRaw || feRaw.error) return { error: feRaw?.error ?? "Fixed Effects estimation failed." };
      const panelSpec = { yVar: y, xVars: allX, wVars: expW, entityCol: ec, timeCol: tc };
      const feRes = wrapResult("FE", feRaw, panelSpec);
      return { result: { type: "FE", fe: feRes, fd: null }, panelFE: feRes, panelFD: null };

    } else if (effModel === "FD") {
      if (!allX.length) return { error: "Select at least one regressor." };
      const ec = panel.entityCol, tc = panel.timeCol;
      const fdRaw = runFD(dataRows, y, allX, ec, tc, seOpts);
      if (!fdRaw || fdRaw.error) return { error: fdRaw?.error ?? "First Differences estimation failed." };
      const panelSpec = { yVar: y, xVars: allX, wVars: expW, entityCol: ec, timeCol: tc };
      const fdRes = wrapResult("FD", fdRaw, panelSpec);
      return { result: { type: "FD", fe: null, fd: fdRes }, panelFE: null, panelFD: fdRes };

    } else if (effModel === "2SLS") {
      if (!expX.length) return { error: "Select endogenous regressor(s) in Features (X)." };
      if (!zVars.length) return { error: "Select at least one instrument (Z)." };
      const res = run2SLS(dataRows, y, expX, expW, zVars, seOpts);
      if (!res || res.error) return { error: res?.error ?? "2SLS failed. Check that instruments are valid (not in X) and data is sufficient." };
      return { result: wrapResult("2SLS", res, { yVar: y, xVars: expX, wVars: expW, zVars }), panelFE: null, panelFD: null };

    } else if (effModel === "DiD") {
      if (!postVar[0] || !treatVar[0]) return { error: "Select Post and Treated binary columns for DiD." };
      const res = run2x2DiD(dataRows, y, postVar[0], treatVar[0], expW, seOpts);
      if (!res) return { error: "DiD failed. Post and Treated must be 0/1 binary variables." };
      return { result: wrapResult("DiD", res, { yVar: y, wVars: expW, postVar: postVar[0], treatVar: treatVar[0] }), panelFE: null, panelFD: null };

    } else if (effModel === "TWFE") {
      if (!treatVar[0]) return { error: "Select the treatment indicator column." };
      const ec = panel.entityCol, tc = panel.timeCol;
      const res = runTWFEDiD(dataRows, y, ec, tc, treatVar[0], expW, seOpts);
      if (!res) return { error: "TWFE DiD failed. Check panel structure and treatment variable." };
      return { result: wrapResult("TWFE", res, { yVar: y, wVars: expW, entityCol: ec, timeCol: tc, treatVar: treatVar[0] }), panelFE: null, panelFD: null };

    } else if (effModel === "RDD") {
      if (!runningVar[0]) return { error: "Select a running variable." };
      const c0 = parseFloat(cutoff);
      if (isNaN(c0)) return { error: "Enter a valid cutoff value." };
      const runVals = dataRows.map(r => r[runningVar[0]]).filter(v => typeof v === "number" && isFinite(v));
      const yVals   = dataRows.map(r => r[y]).filter(v => typeof v === "number" && isFinite(v));
      const h = bwMode === "ik" ? ikBandwidth(runVals, yVals, c0, polyOrder) : parseFloat(bwManual);
      if (isNaN(h) || h <= 0) return { error: "Invalid bandwidth." };
      const res = runSharpRDD(dataRows, y, runningVar[0], c0, h, kernel, expW, seOpts, polyOrder);
      if (!res) return { error: "RDD failed. Not enough observations within bandwidth." };
      return { result: wrapResult("RDD", res, { yVar: y, wVars: expW, runningVar: runningVar[0], cutoff: c0, bandwidth: h, kernel, polyOrder }, { h }), panelFE: null, panelFD: null };

    } else if (effModel === "Logit" || effModel === "Probit") {
      if (!allX.length) return { error: "Select at least one regressor (X)." };
      const fn  = effModel === "Logit" ? runLogit : runProbit;
      const res = fn(dataRows, y, allX, seOpts);
      if (!res || res.error) return { error: res?.error ?? `${effModel} failed. Ensure Y is binary (0/1) and X columns are numeric.` };
      if (!res.converged) console.warn(`${effModel} did not converge after ${res.iterations} iterations.`);
      return { result: wrapResult(effModel, res, { yVar: y, xVars: expX, wVars: expW }), panelFE: null, panelFD: null };

    } else if (effModel === "GMM") {
      if (!expX.length) return { error: "Select endogenous regressor(s) in Features (X)." };
      if (!zVars.length) return { error: "Select at least one excluded instrument (Z)." };
      const res = runGMM(dataRows, y, expX, expW, zVars, seOpts);
      if (!res || res.error) return { error: res?.error ?? "GMM failed. Check instruments and data." };
      return { result: wrapResult("GMM", res, { yVar: y, xVars: expX, wVars: expW, zVars }), panelFE: null, panelFD: null };

    } else if (effModel === "IVPoisson") {
      if (!expX.length) return { error: "Select at least one endogenous regressor (X)." };
      if (!zVars.length) return { error: "IV-Poisson requires at least one excluded instrument (Z)." };
      const res = runIVPoisson(dataRows, y, expX, expW, zVars, seOpts);
      if (!res || res.error) return { error: res?.error ?? "IV-Poisson estimation failed." };
      return { result: wrapResult("IVPoisson", res, { yVar: y, xVars: expX, wVars: expW, zVars }), panelFE: null, panelFD: null };

    } else if (effModel === "LIML") {
      if (!expX.length) return { error: "Select endogenous regressor(s) in Features (X)." };
      if (!zVars.length) return { error: "Select at least one excluded instrument (Z)." };
      const res = runLIML(dataRows, y, expX, expW, zVars, seOpts);
      if (!res || res.error) return { error: res?.error ?? "LIML failed. Check instruments and data." };
      return { result: wrapResult("LIML", res, { yVar: y, xVars: expX, wVars: expW, zVars }), panelFE: null, panelFD: null };

    } else if (effModel === "WLS") {
      if (!allX.length) return { error: "Select at least one regressor." };
      const wCol = weightVar[0];
      if (!wCol) return { error: "WLS: select a weight variable in Model Configuration." };
      const weights = dataRows.map(r => {
        const v = r[wCol];
        return typeof v === "number" && isFinite(v) && v > 0 ? v : null;
      });
      if (weights.every(w => w === null))
        return { error: `Weight column '${wCol}' has no valid positive values.` };
      const res = runWLS(dataRows, y, allX, weights, seOpts);
      if (!res) return { error: diagnoseFit(dataRows, y, allX, wCol) };
      return { result: wrapResult("WLS", res, { yVar: y, xVars: expX, wVars: expW, weightCol: wCol }), panelFE: null, panelFD: null };

    } else if (effModel === "LSDV") {
      if (!allX.length) return { error: "Select at least one regressor (X)." };
      const ec = panel.entityCol, tc = panel.timeCol;
      const res = runLSDV(dataRows, y, allX, ec, tc, { timeFE: lsdvTimeFE }, seOpts);
      if (!res || res.error) return { error: res?.error ?? "LSDV failed. Check panel structure." };
      return { result: wrapResult("LSDV", res, { yVar: y, xVars: allX, wVars: expW, entityCol: ec, timeCol: tc }), panelFE: null, panelFD: null };

    } else if (effModel === "EventStudy") {
      if (!treatTimeCol[0]) return { error: "Select the treatment time column (period when each unit was first treated)." };
      const ec = panel.entityCol, tc = panel.timeCol;
      const pre  = Math.max(1, kPre  || 3);
      const post = Math.max(1, kPost || 3);
      const res = runEventStudy(dataRows, y, ec, tc, treatTimeCol[0], pre, post, expW, seOpts);
      if (!res || res.error) return { error: res?.error ?? "Event Study failed. Check panel structure and treatment time column." };
      return { result: wrapResult("EventStudy", res, { yVar: y, xVars: expX, wVars: expW, entityCol: ec, timeCol: tc, treatTimeCol: treatTimeCol[0] }), panelFE: null, panelFD: null };

    } else if (effModel === "FuzzyRDD") {
      if (!treatVar[0])   return { error: "Select the treatment receipt column (D: actual 0/1 take-up)." };
      if (!runningVar[0]) return { error: "Select a running variable." };
      const c0 = parseFloat(cutoff);
      if (isNaN(c0)) return { error: "Enter a valid cutoff value." };
      const runVals = dataRows.map(r => r[runningVar[0]]).filter(v => typeof v === "number" && isFinite(v));
      const yVals   = dataRows.map(r => r[y]).filter(v => typeof v === "number" && isFinite(v));
      const h = bwMode === "ik" ? ikBandwidth(runVals, yVals, c0, polyOrder) : parseFloat(bwManual);
      if (isNaN(h) || h <= 0) return { error: "Invalid bandwidth." };
      const res = runFuzzyRDD(dataRows, y, treatVar[0], runningVar[0], c0, { bandwidth: h, kernel, seOpts, polyOrder });
      if (!res || res.error) return { error: res?.error ?? "Fuzzy RDD failed. Check treatment, running variable, and bandwidth." };
      return { result: wrapResult("FuzzyRDD", res, { yVar: y, wVars: expW, treatVar: treatVar[0], runningVar: runningVar[0], cutoff: c0, bandwidth: h, kernel, polyOrder }), panelFE: null, panelFD: null };

    } else if (effModel === "SpatialRDD") {
      // Keele & Titiunik 2015 geographic RD: signed running variable built from
      // a distance-to-boundary column + a 0/1 indicator for the treated side.
      if (!treatVar[0])   return { error: "Select the treated-side indicator column (0/1)." };
      if (!runningVar[0]) return { error: "Select the distance-to-boundary column." };
      const bwManualNum = bwMode === "manual" ? parseFloat(bwManual) : null;
      if (bwMode === "manual" && (!isFinite(bwManualNum) || bwManualNum <= 0))
        return { error: "Invalid manual bandwidth." };
      let res;
      try {
        res = runSpatialRDD({
          rows:       dataRows,
          y,
          dist:       runningVar[0],
          treatment:  treatVar[0],
          covariates: expW,
          bandwidth:  bwManualNum,           // null ⇒ IK auto-bandwidth
          kernel,
          seOpts,
          polyOrder,
        });
      } catch (e) {
        return { error: e.message || "Spatial RDD failed." };
      }
      if (!res || res.error) return { error: res?.error ?? "Spatial RDD failed." };
      return {
        result: wrapResult("SpatialRDD", res, {
          yVar: y, wVars: expW,
          distCol:      runningVar[0],
          treatmentCol: treatVar[0],
          runningVar:   runningVar[0],
          cutoff:       0,
          bandwidth:    res.bandwidth,
          kernel,
        }, { h: res.bandwidth }),
        panelFE: null, panelFD: null,
      };

    } else if (effModel === "SpatialRegression") {
      if (!allX.length) return { error: "Select at least one regressor (X)." };
      const W = resolveSpatialWeights(dataRows);
      if (!W || W.error) return { error: W?.error ?? "Spatial weights W could not be built." };
      const res = runSpatialRegressionFromRows(dataRows, y, allX, W, {
        model: spatialModel,
        seType,
      });
      if (!res || res.error) return { error: res?.error ?? "Spatial regression failed." };
      return {
        result: wrapResult("SpatialRegression", res, {
          yVar: y,
          xVars: expX,
          wVars: expW,
          spatialModel,
          spatialWeightsMode,
          spatialGeomCol: spatialWeightsMode === "inline" ? spatialGeomCol : null,
          spatialWeightsDatasetId: spatialWeightsMode === "dataset" ? spatialWeightsDatasetId : null,
        }),
        panelFE: null,
        panelFD: null,
      };

    } else if (effModel === "Poisson") {
      if (!allX.length) return { error: "Select at least one regressor (X)." };
      const offCol = poissonOffsetCol || null;
      const res = runPoisson(dataRows, y, allX, seOpts, offCol);
      if (!res || res.error) return { error: res?.error ?? "Poisson GLM failed. Ensure Y is a non-negative count or rate variable." };
      return { result: wrapResult("Poisson", res, { yVar: y, xVars: allX, wVars: expW, offsetCol: offCol }), panelFE: null, panelFD: null };

    } else if (effModel === "PoissonFE") {
      if (!allX.length) return { error: "Select at least one regressor (X)." };
      const ec = panel?.entityCol || poissonEntityCol;
      if (!ec) return { error: "Select an Entity (i) column in the configuration panel below." };
      // Full FE list: entity dim + any additional FE dims (dedup, drop empties/X overlaps)
      const feCols = [ec, ...poissonExtraFE].filter((c, i, a) => c && a.indexOf(c) === i && !allX.includes(c));
      const offCol = poissonOffsetCol || null;
      let res;
      // runPoissonFEMulti supports offsetCol; use it for multi-way FE or when offset is present
      if (feCols.length > 1 || offCol) {
        res = runPoissonFEMulti(dataRows, y, allX, feCols, seOpts, { offsetCol: offCol });
      } else {
        res = runPoissonFE(dataRows, y, allX, ec, seOpts);
      }
      if (!res || res.error) return { error: res?.error ?? "Poisson FE failed. Ensure Y is a non-negative count variable." };
      return { result: wrapResult("PoissonFE", res, { yVar: y, xVars: allX, wVars: expW, entityCol: ec, feCols, offsetCol: offCol }), panelFE: null, panelFD: null };

    } else if (effModel === "NegBinFE") {
      if (!allX.length) return { error: "Select at least one regressor (X)." };
      const ec = panel?.entityCol || poissonEntityCol;
      if (!ec) return { error: "Select an Entity (i) column in the configuration panel below." };
      const feCols = [ec, ...poissonExtraFE].filter((c, i, a) => c && a.indexOf(c) === i && !allX.includes(c));
      const offCol = poissonOffsetCol || null;
      const res = runNegBinFE(dataRows, y, allX, feCols, seOpts, offCol);
      if (!res || res.error) return { error: res?.error ?? "Negative Binomial FE failed. Ensure Y is a non-negative count variable." };
      return { result: wrapResult("NegBinFE", res, { yVar: y, xVars: allX, wVars: expW, entityCol: ec, feCols, offsetCol: offCol }), panelFE: null, panelFD: null };

    } else if (effModel === "SunAbraham") {
      const cCol = cohortCol[0];
      const pCol = periodCol[0];
      const uCol = panel?.entityCol || saUnitCol;
      if (!cCol) return { error: "Select a Cohort column in the configuration panel below." };
      if (!pCol) return { error: "Select a Period column in the configuration panel below." };
      if (!uCol) return { error: "Select a Unit (entity) fixed-effect column, or declare a panel structure in Wrangling." };
      const feCols = [uCol, pCol];
      // Extra control covariates = user X/W minus the structural cohort/period/unit cols.
      const saControls = allX.filter(c => c !== cCol && c !== pCol && c !== uCol);
      const res = runSunAbraham(
        dataRows, y, saControls,
        { cohortCol: cCol, periodCol: pCol, feCols, refPeriod: Number(saRefPeriod), controlMode: saControlMode },
        seOpts,
      );
      if (!res || res.error) return { error: res?.error ?? "Sun-Abraham estimation failed. Ensure Y is a non-negative count and cohort/period are valid." };
      return {
        result: wrapResult("SunAbraham", res, {
          yVar: y, xVars: saControls, wVars: expW,
          cohortCol: cCol, periodCol: pCol, feCols,
          entityCol: uCol, timeCol: pCol,
          controlMode: saControlMode, refPeriod: Number(saRefPeriod),
        }),
        panelFE: null, panelFD: null,
      };

    } else if (effModel === "CallawayCS") {
      const tcol = csTreatCol[0];
      if (!tcol) return { error: "Select the First-Treatment-Period column in the configuration panel below." };
      const ecol = panel?.entityCol || csEntityCol[0];
      if (!ecol) return { error: "Select an Entity column or declare a panel structure in Wrangling." };
      const timeColCS = panel?.timeCol || csTimeCol[0];
      if (!timeColCS) return { error: "Select a Time column or declare a panel structure in Wrangling." };
      const relMinNum = csRelMin !== "" ? Number(csRelMin) : -Infinity;
      const relMaxNum = csRelMax !== "" ? Number(csRelMax) :  Infinity;
      const res = runCallawayCS(
        dataRows,
        {
          yCol: y, entityCol: ecol, timeCol: timeColCS,
          treatCol: tcol,
          compGroup: csCompGroup,
          relMin: isFinite(relMinNum) ? relMinNum : -Infinity,
          relMax: isFinite(relMaxNum) ? relMaxNum :  Infinity,
        },
        seOpts,
      );
      if (!res || res.error) return { error: res?.error ?? "Callaway-Sant'Anna estimation failed." };
      return {
        result: wrapResult("CallawayCS", res, {
          yVar: y, xVars: [], wVars: expW,
          entityCol: ecol, timeCol: timeColCS,
          treatCol: tcol,
          compGroup: csCompGroup,
        }),
        panelFE: null, panelFD: null,
      };

    } else if (effModel === "SyntheticControl") {
      if (!panel?.entityCol || !panel?.timeCol) return { error: "Declare a panel structure (Entity + Time columns) in Wrangling before running Synthetic Control." };
      if (!treatedUnit) return { error: "Select the treated unit." };
      const synthTime = parseFloat(synthTreatTime);
      if (isNaN(synthTime)) return { error: "Enter a valid treatment time period (numeric)." };
      const ec = panel.entityCol, tc = panel.timeCol;
      const predictors = expX.length ? expX : [];
      const res = runSyntheticControl(dataRows, y, ec, tc, treatedUnit, synthTime, { predictorCols: predictors });
      return { result: wrapResult("SyntheticControl", res, { yVar: y, xVars: expX, entityCol: ec, timeCol: tc, treatedUnit, treatTime: synthTime }), panelFE: null, panelFD: null };
    }

    return { error: `Unknown estimator: ${effModel}` };
  } catch (e) {
    return { error: `Estimation error: ${e.message}` };
  }
}
