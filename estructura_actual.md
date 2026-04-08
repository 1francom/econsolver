# estructura_actual.md — Econ Studio
_Generado el 2026-04-08. Refleja el estado real del repositorio en `src/`._

---

## Visión general

Browser-based econometrics research platform. React + Vite + JavaScript puro.
Sin librerías UI externas. Styling con inline styles vía objeto `C` (dark/teal/gold).
Tipografía IBM Plex Mono. 58 archivos en `src/`.

---

## Árbol de archivos

```
src/
├── App.jsx                        ← Router raíz + gestión de proyectos + demo CSV (795 líneas)
├── DataStudio.jsx                 ← Shell de proyecto (pid-scoped, IndexedDB) (479 líneas)
├── WranglingModule.jsx            ← Orquestador de pipeline + router de tabs (425 líneas)
├── ExplorerModule.jsx             ← Explorador de dataset (656 líneas)
├── ReportingModule.jsx            ← LaTeX Stargazer, forest plots, narrativa AI (992 líneas)
├── EconometricsEngine.js          ← (legacy / standalone)
├── index.css
├── main.jsx
│
├── math/                          ← Pure JS. Sin React. Sin imports UI.
│   ├── index.js                   ← Barrel export único para todos los engines
│   ├── LinearEngine.js            ← OLS, WLS, álgebra matricial, diagnósticos, export (298 líneas)
│   ├── PanelEngine.js             ← FE, FD, TWFE, 2×2 DiD (307 líneas)
│   ├── CausalEngine.js            ← 2SLS/IV, Sharp RDD, McCrary, IK bandwidth (429 líneas)
│   └── NonLinearEngine.js         ← Logit/Probit (IRLS/Newton-Raphson), McFadden R², MEM (350 líneas)
│
├── core/                          ← Pure JS. Sin React.
│   ├── diagnostics/
│   │   ├── heteroskedasticity.js  ← Breusch-Pagan, White test
│   │   ├── autocorrelation.js     ← Durbin-Watson, Breusch-Godfrey
│   │   ├── normality.js           ← Jarque-Bera, Shapiro-Wilk
│   │   └── multicollinearity.js   ← VIF, número de condición
│   └── validation/
│       └── dataQuality.js         ← Patrones de missings, flags de outliers, consistencia de tipos
│
├── pipeline/
│   ├── runner.js                  ← applyStep + runPipeline — 27 step types (891 líneas)
│   ├── registry.js                ← STEP_REGISTRY + helpers (599 líneas)
│   ├── validator.js               ← validatePanel, buildInfo
│   └── auditor.js                 ← auditPipeline → AuditTrail + markdown
│
├── components/
│   ├── AIContextSidebar.jsx       ← Sidebar AI global, contextual por módulo (303 líneas)
│   ├── ModelingTab.jsx            ← Orquestador de modelado, estimate(), todo el estado del modelo (1377 líneas)
│   │
│   ├── wrangling/
│   │   ├── shared.jsx             ← C, mono, Lbl, Tabs, Btn, Badge, Grid
│   │   ├── utils.js               ← fuzzyGroups, callAI, audit (lsGet/lsSave deprecados)
│   │   ├── History.jsx            ← Sidebar de pipeline con undo/redo
│   │   ├── ExportMenu.jsx         ← CSV + pipeline.json export
│   │   ├── CleanTab.jsx           ← NormalizePanel, FilterBuilder, FillNaSection
│   │   ├── PanelTab.jsx           ← Heatmap + declaración de panel
│   │   ├── FeatureTab.jsx         ← Transforms: log, sq, z-score, winsorize, lag/lead, dummies, fechas
│   │   ├── ReshapeTab.jsx         ← pivot_longer, group_summarize
│   │   ├── DictionaryTab.jsx      ← Inferencia AI + edición manual de metadatos
│   │   ├── MergeTab.jsx           ← LEFT/INNER JOIN + APPEND
│   │   └── DataQualityReport.jsx
│   │
│   └── modeling/
│       ├── shared.jsx             ← VarPanel, Section, Chip, C, mono (modeling-specific)
│       ├── EstimatorSidebar.jsx   ← Selección de estimador
│       ├── VariableSelector.jsx   ← Selectores Y, X, W
│       ├── ModelConfiguration.jsx ← Config por estimador (instrumentos Z, DiD, RDD, pesos WLS)
│       ├── ModelPlots.jsx         ← RDDPlot, DiDPlot, EventStudyPlot, FirstStagePlot, etc.
│       ├── ResidualPlots.jsx      ← ResidualVsFitted, QQPlot
│       ├── DiagnosticsPanel.jsx   ← Tests post-estimación (BP, White, DW, BG, JB, SW, VIF, Hausman) (398 líneas)
│       └── ResearchCoach.jsx      ← Advisor AI conversacional sobre el modelo activo (371 líneas)
│
├── services/
│   ├── AI/
│   │   ├── AIService.js           ← Único egress point a Anthropic API (628 líneas)
│   │   │                            Exports: callClaude, inferVariableUnits, interpretRegression,
│   │   │                                     suggestCleaning, compareModels, researchCoach
│   │   ├── LocalAI.js             ← Algoritmos sin API: fuzzy clustering, PII, outliers, type inference
│   │   └── Prompts/
│   │       └── index.js           ← SHARED_CONTEXT + todos los prompts versionados (360 líneas)
│   │
│   ├── Privacy/
│   │   ├── index.js               ← Barrel re-export
│   │   ├── piiDetector.js         ← detectPII, isPII, PII_SENSITIVITY (126 líneas)
│   │   ├── anonymizer.js          ← buildPseudoMap, applyPseudoMap, suppress, mask, generalize (123 líneas)
│   │   ├── privacyFilter.js       ← filterSampleRows, filterVariableNames, buildEgressReport (163 líneas)
│   │   └── PrivacyConfigPanel.jsx ← UI de configuración de privacidad
│   │
│   ├── export/
│   │   ├── rScript.js             ← Pipeline + modelo → R script (fixest/modelsummary) (621 líneas)
│   │   ├── pythonScript.js        ← Pipeline + modelo → Python script (338 líneas)
│   │   └── stataScript.js         ← Pipeline + modelo → Stata do-file (316 líneas)
│   │
│   └── persistence/
│       └── indexedDB.js           ← loadPipeline, savePipeline, saveRawData, migrateFromLocalStorage
│
└── assets/
    ├── hero.png
    ├── react.svg
    └── vite.svg
```

---

## Estimadores implementados

| Estimador | Archivo | Estado |
|-----------|---------|--------|
| OLS | `math/LinearEngine.js` | ✓ validado vs R (6 decimales) |
| WLS (survey weights) | `math/LinearEngine.js` | ✓ runWLS — SSR sin ponderar para σ² |
| FE (within) | `math/PanelEngine.js` | ✓ |
| FD (first differences) | `math/PanelEngine.js` | ✓ |
| TWFE DiD | `math/PanelEngine.js` | ✓ |
| 2×2 DiD | `math/PanelEngine.js` | ✓ |
| 2SLS / IV | `math/CausalEngine.js` | ✓ |
| Sharp RDD | `math/CausalEngine.js` | ✓ IK bandwidth, kernel triangular/epanechnikov/uniform |
| McCrary density test | `math/CausalEngine.js` | ✓ |
| Logit / Probit | `math/NonLinearEngine.js` | ✓ IRLS/Newton-Raphson MLE — McFadden R², AIC/BIC, MEM, odds ratios |

---

## Step types del pipeline (`runner.js`) — 27 implementados

| Categoría | Steps |
|-----------|-------|
| **Cleaning** | `rename`, `drop`, `filter`, `drop_na`, `fill_na`, `fill_na_grouped`, `type_cast`, `quickclean`, `recode`, `normalize_cats`, `winz`, `trim_outliers`, `flag_outliers`, `extract_regex`, `ai_tr` |
| **Features** | `log`, `sq`, `std`, `dummy`, `lag`, `lead`, `diff`, `ix`, `did`, `date_parse`, `date_extract`, `mutate`, `factor_interactions` |
| **Reshape** | `arrange`, `group_summarize`, `pivot_longer` |
| **Merge** | `join`, `append` |

---

## Servicios AI (`services/AI/AIService.js`)

Único egress point. Toda llamada a Anthropic pasa por aquí.

| Función exportada | Modelo | Uso |
|-------------------|--------|-----|
| `callClaude()` | configurable | Base caller con prompt caching |
| `inferVariableUnits()` | `claude-haiku-4-5-20251001` | Inferir unidades de columnas |
| `interpretRegression()` | `claude-sonnet-4-20250514` | Narrativa del modelo estimado |
| `suggestCleaning()` | sonnet | Sugerencias a partir del DataQualityReport |
| `compareModels()` | sonnet | Comparación narrativa entre dos modelos |
| `researchCoach()` | sonnet | Advisor conversacional en ResearchCoach.jsx |

**Prompt caching:** `SHARED_CONTEXT` (~800 tokens) se envía como bloque cacheado (`cache_control: {type:"ephemeral"}`). Header `"anthropic-beta": "prompt-caching-2024-07-31"` presente en cada llamada.

---

## Servicios de privacidad (`services/Privacy/`)

Sistema de filtrado PII client-side antes de cualquier egreso de datos.

- **`piiDetector.js`** — Detecta columnas/valores con información personal identificable
- **`anonymizer.js`** — Pseudoanonimización, supresión, masking, generalización numérica
- **`privacyFilter.js`** — Filtra filas de muestra y nombres de variables antes de enviar a AI
- **`LocalAI.js`** — Algoritmos locales (sin API): fuzzy clustering, inferencia de tipos, scoring de outliers

---

## Exportación de scripts de replicación (`services/export/`)

| Archivo | Output |
|---------|--------|
| `rScript.js` | R script con `fixest` + `modelsummary` (621 líneas) |
| `pythonScript.js` | Python script con `statsmodels`/`linearmodels` (338 líneas) |
| `stataScript.js` | Stata do-file (316 líneas) |

---

## Invariantes arquitectónicas

1. **Pipeline no-destructivo**: los steps siempre se reproducen sobre `rawData`. `runner.js` es la fuente de verdad.
2. **Cero React en math files**: `src/math/` y `src/core/` son JS puro, sin imports React o UI.
3. **Single API egress**: todas las llamadas a Anthropic pasan por `AIService.js`. Sin `fetch` directo a la API en ningún otro archivo.
4. **IndexedDB, no localStorage**: persistencia en `services/persistence/indexedDB.js`. localStorage deprecado para pipeline/datos.
5. **`STEP_REGISTRY` sincronizado con `runner.js`** en todo momento.

---

## Pendiente (prioridad ordenada)

1. **Logit/Probit UI** — Conectar `NonLinearEngine.js` a `ModelingTab.jsx` + `EstimatorSidebar.jsx` + plots (ROC, confusion matrix, histograma de probabilidades predichas)
2. **Replication Package UI** — Bundle ZIP con R, Python y Stata scripts + botón de descarga
3. **AuditTrail UI** — `components/validation/AuditTrail.jsx` que surfacea `auditor.js`
4. **Validación de estimadores vs R** — Benchmark sistemático: RDD (`rdrobust`), Panel FE (`fixest`), 2SLS (`AER`), Logit/Probit (`glm`)
5. **DuckDB-WASM** — Target de cómputo final para datasets > 50k filas

---

## Diferencias respecto al CLAUDE.md

| Item | CLAUDE.md | Estado real |
|------|-----------|-------------|
| Step types | 23 | **27** (se agregaron `trim_outliers`, `flag_outliers`, `extract_regex`, `factor_interactions`) |
| `services/AI/` | `AIService.js` + `Prompts/index.js` | + **`LocalAI.js`** (algoritmos sin API) |
| `services/export/` | solo `rScript.js` (+ `latex.js`, `csv.js`) | **`rScript.js` + `pythonScript.js` + `stataScript.js`** |
| `services/Privacy/` | no listado | **Módulo completo** (piiDetector, anonymizer, privacyFilter, PrivacyConfigPanel, index) |
| `components/modeling/` | 6 archivos | **8 archivos** (+ `DiagnosticsPanel.jsx`, `ResearchCoach.jsx`) |
| `components/` root | no listado | **`AIContextSidebar.jsx`** (sidebar AI global) |
| `NonLinearEngine.js` | listado como implementado | ✓ presente, **UI pendiente** |
| `latex.js`, `csv.js` en export/ | listados | **no encontrados** en árbol actual |
| `services/geo/photon.js` | listado | **no encontrado** en árbol actual |
| `services/data/parsers/` | listado | **no encontrado** en árbol actual |
