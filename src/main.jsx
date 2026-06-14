import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ThemeProvider } from './ThemeContext.jsx'
import { AuthProvider } from './services/auth/AuthContext.jsx'
import AuthGate from './components/auth/AuthGate.jsx'

if (import.meta.env.DEV) {
  // Self-registers window.__validation.workbench() for in-browser symbolic-engine checks.
  import('./math/__validation__/workbenchEngineValidation.js')
  // Self-registers window.__validation.workbenchStore() for session-store shape checks.
  import('./math/__validation__/workbenchStoreValidation.js')
  // Self-registers window.__validation.workbenchOps() for card→engine→result checks.
  import('./math/__validation__/workbenchOpsValidation.js')
  // Self-registers window.__validation.faseX3() for AI-service hardening audit (caching/routing/privacy/LocalAI).
  import('./services/AI/__validation__/faseX3Validation.js')
}

if (new URLSearchParams(window.location.search).get('validation') === 'faseX4') {
  // Browser-only measurements must also run on the deployed build with real COOP/COEP headers.
  import('./services/data/__validation__/faseX4BrowserValidation.js')
}

if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('validation') === 'fase5') {
  import('./services/data/__validation__/fase5Validation.js')
    .then(({ runFase5NumericalValidation }) => runFase5NumericalValidation())
    .then(results => {
      document.documentElement.dataset.fase5Validation = JSON.stringify(
        results.map(({ cell, ok, maxCoefDiff, maxSeDiff, message }) => ({
          cell, ok, maxCoefDiff, maxSeDiff, message,
        })),
      )
    })
    .catch(error => {
      document.documentElement.dataset.fase5Validation = JSON.stringify({
        error: error?.message ?? String(error),
      })
    })
}

if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('validation') === 'fase6') {
  import('./services/data/__validation__/fase6Validation.js')
    .then(({ runFase6NumericalValidation }) => runFase6NumericalValidation())
    .then(results => {
      document.documentElement.dataset.fase6Validation = JSON.stringify(
        results.map(({ cell, ok, maxCoefDiff, maxSeDiff, logLikDiff, message }) => ({
          cell, ok, maxCoefDiff, maxSeDiff, logLikDiff, message,
        })),
      )
    })
    .catch(error => {
      document.documentElement.dataset.fase6Validation = JSON.stringify({
        error: error?.message ?? String(error),
      })
    })
}

if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('validation') === 'fase7') {
  import('./services/data/__validation__/fase7Validation.js')
    .then(({ runFase7NumericalValidation }) => runFase7NumericalValidation())
    .then(results => {
      document.documentElement.dataset.fase7Validation = JSON.stringify(
        results.map(({ cell, ok, maxDiff, message }) => ({
          cell, ok, maxDiff, message,
        })),
      )
    })
    .catch(error => {
      document.documentElement.dataset.fase7Validation = JSON.stringify({
        error: error?.message ?? String(error),
      })
    })
}

if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('validation') === 'fase8') {
  import('./services/data/__validation__/fase8Validation.js')
    .then(({ runFase8NumericalValidation }) => runFase8NumericalValidation())
    .then(results => {
      document.documentElement.dataset.fase8Validation = JSON.stringify(
        results.map(({ cell, ok, maxCoefDiff, maxSeDiff, kappaDiff, L, message }) => ({
          cell, ok, maxCoefDiff, maxSeDiff, kappaDiff, L, message,
        })),
      )
    })
    .catch(error => {
      document.documentElement.dataset.fase8Validation = JSON.stringify({
        error: error?.message ?? String(error),
      })
    })
}

if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('validation') === 'faseX3live') {
  // LIVE eval — real API calls (Tasks 4 & 5). Costs tokens; gated behind its own param.
  import('./services/AI/__validation__/faseX3LiveEval.js')
    .then(({ runFaseX3LiveEval }) => runFaseX3LiveEval())
    .then(out => {
      document.documentElement.dataset.faseX3LiveEval = JSON.stringify({
        unitAccuracy: out.t4?.accuracy, unitPass: out.t4?.pass,
        narrativeFlags: out.t5?.results?.filter(r => !r.ok).map(r => `${r.case}: ${r.note}`),
      })
    })
    .catch(error => {
      document.documentElement.dataset.faseX3LiveEval = JSON.stringify({ error: error?.message ?? String(error) })
    })
}

if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('validation') === 'polyRDD') {
  import('./services/data/__validation__/polyRDDValidation.js')
    .then(({ runPolyRDDValidation }) => runPolyRDDValidation())
    .then(results => {
      document.documentElement.dataset.polyRDDValidation = JSON.stringify(
        results.map(({ cell, ok, maxDiff, message }) => ({
          cell, ok, maxDiff, message,
        })),
      )
    })
    .catch(error => {
      document.documentElement.dataset.polyRDDValidation = JSON.stringify({
        error: error?.message ?? String(error),
      })
    })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <AuthGate>
          <App />
        </AuthGate>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
)
