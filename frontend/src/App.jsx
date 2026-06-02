import { useState, useEffect, useRef } from 'react'
import './index.css'
import PortfolioSummary from './components/PortfolioSummary'
import PerStockCards from './components/PerStockCards'
import CorrelationHeatmap from './components/CorrelationHeatmap'
import EfficientFrontier from './components/EfficientFrontier'
import BenchmarkCard from './components/BenchmarkCard'
import CumulativePerformanceChart from './components/CumulativePerformanceChart'
import MonteCarloResults from './components/MonteCarloResults'
import Sidebar from './components/Sidebar'
import Methodology from './components/Methodology'
import Compare from './components/Compare'
import { fmtCurrency } from './utils/format'

const SIDEBAR_KEY = 'portfolio-sidebar-collapsed'
const TAB_KEY = 'portfolio-active-tab'
const BENCHMARK_TICKERS = { 'sp500': '^SP500TR', 'tsx': '^SPTSXCATR', 'tsx60': '^TXTY' }
// Monte Carlo "Compare With" uses the spot index tickers (no total-return).
// Backend falls back through ^SPTSE60 → XIU.TO if ^TXTY is unavailable.
const MC_COMPARE_TICKERS = { 'sp500': '^GSPC', 'tsx': '^GSPTSE', 'tsx60': '^TXTY' }

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4"/>
      <line x1="12" y1="2" x2="12" y2="4"/>
      <line x1="12" y1="20" x2="12" y2="22"/>
      <line x1="4.93" y1="4.93" x2="6.34" y2="6.34"/>
      <line x1="17.66" y1="17.66" x2="19.07" y2="19.07"/>
      <line x1="2" y1="12" x2="4" y2="12"/>
      <line x1="20" y1="12" x2="22" y2="12"/>
      <line x1="4.93" y1="19.07" x2="6.34" y2="17.66"/>
      <line x1="17.66" y1="6.34" x2="19.07" y2="4.93"/>
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  )
}

const MAX_STOCKS = 20
let _id = 0
const uid = () => ++_id

const emptyStock = () => ({ id: uid(), ticker: '', amount: '' })

const STORAGE_KEY = 'portfolio-optimizer-saved'

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

// Mirrors the backend risk-decomposition so Apply weights keeps the
// Risk Decomposition section populated without a full re-analysis.
function computeRiskDecomp(weights, tickers, perStock, covMonthly, mktVarM) {
  const n = weights.length
  // Total portfolio variance from the covariance matrix.
  let totalVarM = 0
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      totalVarM += weights[i] * weights[j] * covMonthly[i][j]
    }
  }
  // Portfolio beta = weighted average of individual betas.
  let portBeta = 0
  for (let i = 0; i < n; i++) {
    const m = perStock[tickers[i]]
    if (m && Number.isFinite(m.beta)) portBeta += weights[i] * m.beta
  }
  const systematicVarM = portBeta * portBeta * mktVarM
  const specificVarM = Math.max(totalVarM - systematicVarM, 0)
  return {
    portfolio_beta: portBeta,
    systematic_risk: Math.sqrt(systematicVarM * 12),
    specific_risk: Math.sqrt(specificVarM * 12),
  }
}

// Mirrors backend metrics.calc_portfolio_metrics so Apply weights can update
// the user's portfolio point without re-running the full analysis (which would
// shift the frontier + reference markers off their original-portfolio anchors).
function computePortfolioMetrics(weights, meanMonthly, covMonthly, rfAnnual) {
  const n = weights.length
  let pRetM = 0
  for (let i = 0; i < n; i++) pRetM += weights[i] * meanMonthly[i]
  let pVarM = 0
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      pVarM += weights[i] * weights[j] * covMonthly[i][j]
    }
  }
  const pVolM = Math.sqrt(Math.max(pVarM, 0))
  const annR = Math.pow(1 + pRetM, 12) - 1
  const annV = pVolM * Math.sqrt(12)
  const sharpe = annV > 0 ? (annR - rfAnnual) / annV : 0
  return {
    expected_monthly_return: pRetM,
    monthly_volatility: pVolM,
    annualized_return: annR,
    annualized_volatility: annV,
    sharpe_ratio: sharpe,
  }
}

export default function App() {
  const [stocks, setStocks] = useState([emptyStock(), emptyStock()])
  const [currency, setCurrency] = useState('USD')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)
  const [saveName, setSaveName] = useState('')
  const [saved, setSaved] = useState(loadSaved)
  const [originalSnapshot, setOriginalSnapshot] = useState(null)
  const [originalResults, setOriginalResults] = useState(null)
  const [activeKey, setActiveKey] = useState(null)
  // True when `stocks` reflects values the user typed in. Set to false only by
  // Apply-weights writes. This lets handleAnalyze ignore optimized amounts that
  // happen to be sitting in the inputs after a currency toggle.
  const [stocksFromUser, setStocksFromUser] = useState(true)
  const [periodMode, setPeriodMode] = useState('annual')
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('portfolio-theme')
    if (saved) return saved === 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  // Sidebar state
  const [mcResults, setMcResults] = useState(null)
  const [mcLoading, setMcLoading] = useState(false)

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem(SIDEBAR_KEY) === 'true'
  })
  const [activeTab, setActiveTab] = useState(() => {
    const stored = localStorage.getItem(TAB_KEY)
    if (stored === 'methodology' || stored === 'compare') return stored
    return 'portfolio'
  })
  const [analysisMode, setAnalysisMode] = useState('no-short')
  const [benchmark, setBenchmark] = useState('none')
  const [customBenchmark, setCustomBenchmark] = useState('')
  const [riskFreeOverride, setRiskFreeOverride] = useState(false)
  const [riskFreeOverrideValue, setRiskFreeOverrideValue] = useState('4.50')
  const [liveRiskFreeRate, setLiveRiskFreeRate] = useState(null)
  const [liveRiskFreeRateLoading, setLiveRiskFreeRateLoading] = useState(false)
  // CAPM is the default expected-return method; users can switch to Historical
  // from the Sidebar. If CAPM data is unavailable for a particular analysis
  // (e.g. benchmark fetch failed), components silently fall back to Historical.
  const [returnMethod, setReturnMethod] = useState('capm')
  const [riskAversion, setRiskAversion] = useState(4)
  const [advancedMode, setAdvancedMode] = useState(false)
  // The sidebar benchmark drives both the Benchmark Comparison card and the
  // Monte Carlo "Compare With" simulation — a single shared state.

  const resultsRef = useRef(null)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
    localStorage.setItem('portfolio-theme', isDark ? 'dark' : 'light')
  }, [isDark])

  const toggleTheme = () => setIsDark(d => !d)

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, sidebarCollapsed ? 'true' : 'false')
  }, [sidebarCollapsed])

  useEffect(() => {
    localStorage.setItem(TAB_KEY, activeTab)
  }, [activeTab])

  // Fetch live risk-free rate when currency changes
  useEffect(() => {
    let cancelled = false
    setLiveRiskFreeRateLoading(true)
    fetch(`/api/risk-free?currency=${currency}`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(data => {
        if (!cancelled && typeof data.rate === 'number') {
          setLiveRiskFreeRate(data.rate)
        }
      })
      .catch(() => {
        if (!cancelled) setLiveRiskFreeRate(null)
      })
      .finally(() => {
        if (!cancelled) setLiveRiskFreeRateLoading(false)
      })
    return () => { cancelled = true }
  }, [currency])

  useEffect(() => {
    if (results && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [results])

  // ── Stock list helpers ────────────────────────────────────────

  const addStock = () => {
    if (stocks.length < MAX_STOCKS) {
      setStocks(prev => [...prev, emptyStock()])
      setStocksFromUser(true)
    }
  }

  const removeStock = (id) => {
    setStocks(prev => prev.filter(s => s.id !== id))
    setStocksFromUser(true)
  }

  const updateStock = (id, field, value) => {
    setStocks(prev =>
      prev.map(s => s.id === id ? { ...s, [field]: value } : s)
    )
    setStocksFromUser(true)
  }

  // ── Validation ────────────────────────────────────────────────

  const validStocks = () =>
    stocks.filter(s => s.ticker.trim() !== '' && parseFloat(s.amount) > 0)

  // ── Analyze ───────────────────────────────────────────────────

  const runAnalysis = async (stocksList, currencyVal) => {
    const valid = stocksList.filter(
      s => s.ticker.trim() !== '' && parseFloat(s.amount) > 0
    )
    if (valid.length < 2) {
      setError('Please enter at least 2 stocks with a valid ticker and a positive dollar amount.')
      return null
    }
    setError(null)
    setLoading(true)

    let rfOverride = null
    if (riskFreeOverride) {
      const pct = parseFloat(riskFreeOverrideValue)
      if (Number.isFinite(pct)) rfOverride = pct / 100
    }

    const benchmarkTicker =
      benchmark === 'none'   ? null
      : benchmark === 'custom' ? (customBenchmark.trim().toUpperCase() || null)
      : (BENCHMARK_TICKERS[benchmark] || null)

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stocks: valid.map(s => ({
            ticker: s.ticker.trim().toUpperCase(),
            amount: parseFloat(s.amount),
          })),
          currency: currencyVal,
          short_selling: analysisMode === 'with-short',
          ...(rfOverride !== null ? { risk_free_rate_override: rfOverride } : {}),
          ...(benchmarkTicker    ? { benchmark_ticker: benchmarkTicker }   : {}),
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Server error ${res.status}`)
      }
      return await res.json()
    } catch (e) {
      setError(e.message || 'Could not reach the backend. Make sure start.sh is running.')
      return null
    } finally {
      setLoading(false)
    }
  }

  // Derive portfolio weights from the current input amounts matched against
  // the tickers in a previous analysis result. Falls back to portfolio.weights
  // if the amounts don't sum to ~1 (e.g. user changed tickers).
  const weightsFromCurrentStocks = (analysisResults) => {
    const { tickers, total_investment, portfolio } = analysisResults
    if (!Array.isArray(tickers) || !total_investment) return portfolio.weights
    const w = tickers.map(t => {
      const s = stocks.find(st => st.ticker.trim().toUpperCase() === t)
      const amt = s ? parseFloat(s.amount) : 0
      return Number.isFinite(amt) ? amt / total_investment : 0
    })
    const sum = w.reduce((a, b) => a + b, 0)
    return Math.abs(sum - 1) < 0.15 ? w : portfolio.weights
  }

  // POST to /api/monte-carlo. `analysisResults` provides cov/total/rf;
  // `weights` is passed explicitly so callers can use current-input weights
  // rather than the weights frozen in the analysis snapshot. `method` picks
  // the CAPM vs Historical mean vector so MC simulates the right distribution.
  // `compare` is the MC-compare benchmark id ('none' | 'sp500' | 'tsx' | 'tsx60').
  const fetchMcData = async (analysisResults, weights, method = 'capm', compare = 'none') => {
    const useCapm = method === 'capm' && Array.isArray(analysisResults.mean_monthly_capm)
    const meanVec = useCapm ? analysisResults.mean_monthly_capm : analysisResults.mean_monthly
    const compareTicker = compare && compare !== 'none' ? MC_COMPARE_TICKERS[compare] : null
    setMcLoading(true)
    try {
      const mcRes = await fetch('/api/monte-carlo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mean_monthly:     meanVec,
          cov_monthly:      analysisResults.cov_monthly,
          weights,
          total_investment: analysisResults.total_investment,
          rf_annual:        analysisResults.risk_free_rate,
          currency:         analysisResults.currency,
          ...(compareTicker ? { benchmark_ticker: compareTicker } : {}),
        }),
      })
      if (mcRes.ok) setMcResults(await mcRes.json())
    } catch { /* MC error doesn't block main results */ }
    finally { setMcLoading(false) }
  }

  // When user switches to the Monte Carlo tab and results already exist,
  // auto-trigger the simulation immediately with the current portfolio weights.
  const handleAnalysisModeChange = (mode) => {
    setAnalysisMode(mode)
    if (mode === 'monte-carlo' && originalResults) {
      setMcResults(null)
      fetchMcData(originalResults, weightsFromCurrentStocks(originalResults), returnMethod, benchmark)
    }
  }

  // Toggle between CAPM and Historical. Re-runs Monte Carlo if it's the
  // active view since MC paths depend on which mean vector we feed it.
  const handleReturnMethodChange = (method) => {
    if (method === returnMethod) return
    setReturnMethod(method)
    if (analysisMode === 'monte-carlo' && originalResults) {
      setMcResults(null)
      fetchMcData(originalResults, weightsFromCurrentStocks(originalResults), method, benchmark)
    }
  }

  // Fetch benchmark data for the frontier tabs without re-running the full analysis.
  // Aligns the benchmark to the portfolio's original observation window (dates).
  const fetchBenchmarkForFrontier = async (id) => {
    if (!originalResults) return

    const ticker =
      id === 'none'    ? null
      : id === 'custom' ? (customBenchmark.trim().toUpperCase() || null)
      : (BENCHMARK_TICKERS[id] || null)

    if (!ticker) {
      setResults(prev => prev ? { ...prev, benchmark: null } : prev)
      setOriginalResults(prev => prev ? { ...prev, benchmark: null } : prev)
      return
    }

    try {
      const res = await fetch('/api/benchmark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          benchmark_ticker: ticker,
          currency: originalResults.currency,
          dates: originalResults.dates,
          rf_annual: originalResults.risk_free_rate,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setResults(prev => prev ? { ...prev, benchmark: data.benchmark } : prev)
        setOriginalResults(prev => prev ? { ...prev, benchmark: data.benchmark } : prev)
      }
    } catch { /* silently fail — stale benchmark stays visible */ }
  }

  // Unified benchmark handler — updates the sidebar dropdown, re-runs Monte
  // Carlo when MC is active, and live-updates the benchmark comparison on
  // frontier tabs without a full re-analysis.
  const handleBenchmarkChange = (id) => {
    if (id === benchmark) return
    setBenchmark(id)
    if (analysisMode === 'monte-carlo' && originalResults) {
      setMcResults(null)
      fetchMcData(originalResults, weightsFromCurrentStocks(originalResults), returnMethod, id)
    } else if (originalResults) {
      fetchBenchmarkForFrontier(id)
    }
  }

  const handleAnalyze = async () => {
    // MC mode with existing results: only re-run the simulation.
    // Don't touch results/originalResults — Portfolio Summary stays as-is.
    if (analysisMode === 'monte-carlo' && originalResults) {
      setMcResults(null)
      await fetchMcData(originalResults, weightsFromCurrentStocks(originalResults), returnMethod, benchmark)
      return
    }

    let stocksForAnalysis = stocks

    if (analysisMode !== 'monte-carlo') {
      // Non-MC: restore original amounts if applied weights are showing so the
      // frontier stays anchored to the user's actual portfolio, not an optimized one.
      if (!stocksFromUser && originalSnapshot) {
        stocksForAnalysis = originalSnapshot.stocks.map(s => ({
          id: uid(),
          ticker: s.ticker,
          amount: s.amount,
        }))
        setStocks(stocksForAnalysis)
      }
      setOriginalSnapshot({
        stocks: stocksForAnalysis.map(s => ({ ticker: s.ticker, amount: s.amount })),
        currency,
      })
      setStocksFromUser(true)
    } else {
      // MC mode, first analysis (originalResults === null): full analysis needed.
      if (stocksFromUser || !originalSnapshot) {
        setOriginalSnapshot({
          stocks: stocks.map(s => ({ ticker: s.ticker, amount: s.amount })),
          currency,
        })
        setStocksFromUser(true)
      }
    }

    setResults(null)
    setOriginalResults(null)
    setActiveKey(null)
    setMcResults(null)
    const json = await runAnalysis(stocksForAnalysis, currency)
    if (json) {
      setResults(json)
      setOriginalResults(json)
      setActiveKey('original')
      if (analysisMode === 'monte-carlo') {
        await fetchMcData(json, json.portfolio.weights, returnMethod, benchmark)
      }
    }
  }

  // Restore the user's originally-typed amounts and re-run the full analysis.
  const handleResetToOriginal = async () => {
    if (!originalSnapshot) return
    const restored = originalSnapshot.stocks.map(s => ({
      id: uid(),
      ticker: s.ticker,
      amount: s.amount,
    }))
    setStocks(restored)
    setCurrency(originalSnapshot.currency)
    setStocksFromUser(true)
    setResults(null)
    setOriginalResults(null)
    setActiveKey(null)
    setMcResults(null)
    const json = await runAnalysis(restored, originalSnapshot.currency)
    if (json) {
      setResults(json)
      setOriginalResults(json)
      setActiveKey('original')
      if (analysisMode === 'monte-carlo') {
        await fetchMcData(json, json.portfolio.weights, returnMethod, benchmark)
      }
    }
  }

  // ── Apply weights (client-side recompute, no chart movement) ──
  //
  // Updates the "current portfolio" (summary cards, per-stock cards, input
  // rows) to reflect the chosen weights, but leaves originalResults — and
  // therefore the chart — untouched. Picking 'original' restores the user's
  // first-entered amounts.

  const handleApplyWeights = (weights, key, pointOverride = null) => {
    if (!originalResults || !originalSnapshot) return

    if (key === 'original') {
      const restored = originalSnapshot.stocks.map(s => ({
        id: uid(),
        ticker: s.ticker,
        amount: s.amount,
      }))
      setStocks(restored)
      setCurrency(originalSnapshot.currency)
      setResults(originalResults)
      setActiveKey('original')
      // Restored amounts equal the user's original entry, so a follow-up
      // Analyze should snapshot from `stocks` directly.
      setStocksFromUser(true)
      return
    }

    const tickers = originalResults.tickers
    const total = originalResults.total_investment
    const meanMonthly = originalResults.mean_monthly
    const meanMonthlyCapm = originalResults.mean_monthly_capm
    const covMonthly = originalResults.cov_monthly
    const rfAnnual = originalResults.risk_free_rate
    if (!Array.isArray(weights) || !Array.isArray(tickers) ||
        weights.length !== tickers.length || !(total > 0) ||
        !Array.isArray(meanMonthly) || !Array.isArray(covMonthly)) {
      return
    }

    const newAmounts = tickers.map((_, i) => total * weights[i])
    // CML portfolios mix the tangency portfolio with T-bills, so their risky
    // weights sum to < 1. Trust the backend-supplied CML metrics instead of
    // recomputing from cov (which would ignore the T-bill leg).
    const isCml = pointOverride && Number.isFinite(pointOverride.t_bill_weight)
    const cmlPortfolio = isCml ? {
      expected_monthly_return: Math.pow(1 + pointOverride.annualized_return, 1 / 12) - 1,
      monthly_volatility: pointOverride.annualized_volatility / Math.sqrt(12),
      annualized_return: pointOverride.annualized_return,
      annualized_volatility: pointOverride.annualized_volatility,
      sharpe_ratio: pointOverride.sharpe_ratio,
      t_bill_weight: pointOverride.t_bill_weight,
      tangency_fraction: pointOverride.tangency_fraction,
    } : null

    const newPortfolio = isCml
      ? cmlPortfolio
      : computePortfolioMetrics(weights, meanMonthly, covMonthly, rfAnnual)
    newPortfolio.weights = weights.map(w => Number(w))

    // Recompute the CAPM-method portfolio in parallel so the Return Method
    // toggle stays in sync after an Apply.
    let newPortfolioCapm = null
    if (Array.isArray(meanMonthlyCapm)) {
      newPortfolioCapm = isCml
        ? { ...cmlPortfolio }
        : computePortfolioMetrics(weights, meanMonthlyCapm, covMonthly, rfAnnual)
      newPortfolioCapm.weights = weights.map(w => Number(w))
      // Recompute risk decomposition so the Risk Decomposition section stays
      // visible after applying optimized weights (portfolio_beta etc. are not
      // produced by computePortfolioMetrics and must be added separately).
      const mktVarM = originalResults.capm_info?.mkt_var_m
      if (Number.isFinite(mktVarM)) {
        Object.assign(newPortfolioCapm, computeRiskDecomp(
          weights, originalResults.tickers, originalResults.per_stock,
          covMonthly, mktVarM
        ))
      }
    }

    setResults({
      ...originalResults,
      portfolio: newPortfolio,
      portfolio_capm: newPortfolioCapm,
      amounts: newAmounts,
      total_investment: total,
    })

    // ── INVARIANT: always rebuild ALL input rows from the original ticker universe.
    //
    // Rule: iterate over originalResults.tickers — every stock that was part of
    // the analysis must appear in the input after any Apply Weights action,
    // regardless of its new weight value.
    //
    //  • weight = 0  → shows "$0.00"   (still visible, user can see it was zeroed)
    //  • weight = very small → shows the computed cent amount (e.g. "$0.01")
    //  • weight < 0  → short position, shows negative dollar amount
    //
    // DO NOT filter, slice, or conditionally skip any ticker here.
    // If a ticker is dropped from the input it can never come back on the next
    // Apply (because subsequent Applies iterate this same array), which is the
    // recurring bug this block is designed to prevent.
    const updated = originalResults.tickers.map((t, i) => {
      const w = Number.isFinite(weights[i]) ? weights[i] : 0
      return { id: uid(), ticker: t, amount: (total * w).toFixed(2) }
    })

    setStocks(updated)
    setActiveKey(key)
    setStocksFromUser(false)
  }

  // ── Save / load ───────────────────────────────────────────────

  const handleSave = () => {
    const name = saveName.trim()
    if (!name) return
    const valid = validStocks()
    if (valid.length < 1) {
      setError('Add at least one stock before saving.')
      return
    }
    const updated = {
      ...saved,
      [name]: {
        stocks: valid.map(s => ({ ticker: s.ticker.trim().toUpperCase(), amount: s.amount })),
        currency,
        savedAt: new Date().toISOString(),
      },
    }
    setSaved(updated)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
    setSaveName('')
  }

  const handleLoad = (name) => {
    const entry = saved[name]
    if (!entry) return
    setStocks(entry.stocks.map(s => ({ id: uid(), ticker: s.ticker, amount: s.amount })))
    setCurrency(entry.currency)
    setResults(null)
    setError(null)
    setOriginalSnapshot(null)
    setOriginalResults(null)
    setActiveKey(null)
    setStocksFromUser(true)
  }

  const handleDelete = (name) => {
    const updated = { ...saved }
    delete updated[name]
    setSaved(updated)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  }

  // ── Render ────────────────────────────────────────────────────

  const savedNames = Object.keys(saved)
  const valid = validStocks()
  const totalInvestment = valid.reduce((sum, s) => sum + parseFloat(s.amount || 0), 0)
  // Short-selling breakdown: longAmount sums positive holdings, shortAmount the
  // absolute value of negatives, equityAmount = longAmount - shortAmount (the
  // user's own capital, since applied weights sum to 1 over total_investment).
  const longAmount = stocks.reduce((sum, s) => {
    const a = parseFloat(s.amount)
    return Number.isFinite(a) && a > 0 ? sum + a : sum
  }, 0)
  const shortAmount = stocks.reduce((sum, s) => {
    const a = parseFloat(s.amount)
    return Number.isFinite(a) && a < 0 ? sum + Math.abs(a) : sum
  }, 0)
  const hasShortPositions = shortAmount > 0
  const equityAmount = longAmount - shortAmount

  // CML breakdown: t_bill_weight is only present on the portfolio object when
  // CML weights are applied (set in handleApplyWeights via cmlPortfolio).
  // Positive t_bill_weight → investing in T-bills (left of tangency).
  // Negative t_bill_weight → borrowing at risk-free rate (leveraged, right of tangency).
  const cmlTBillWeight = results?.portfolio?.t_bill_weight
  const hasCml = Number.isFinite(cmlTBillWeight)
  const cmlTotal = results?.total_investment ?? 0
  const cmlInTBills = hasCml ? cmlTotal * cmlTBillWeight : 0
  const cmlInStocks = hasCml ? cmlTotal * (results.portfolio.tangency_fraction ?? 0) : 0
  const cmlIsLeveraged = hasCml && cmlTBillWeight < 0

  const isComingSoon = false
  const comingSoonLabel = ''
  const isShortSelling = analysisMode === 'with-short'
  const isMonteCarlo = analysisMode === 'monte-carlo'

  // Resolve which portfolio/frontier the current Return Method points to.
  // Falls back to Historical if CAPM data is missing for this run.
  const useCapm = returnMethod === 'capm' && results && results.portfolio_capm
  const effectiveMethod = useCapm ? 'capm' : 'historical'
  const activePortfolio = useCapm ? results.portfolio_capm : (results && results.portfolio)
  const activeFrontier = originalResults
    ? (effectiveMethod === 'capm' && originalResults.frontier_capm
        ? originalResults.frontier_capm
        : originalResults.frontier)
    : null
  const activeFrontierNoShort = originalResults
    ? (effectiveMethod === 'capm' && originalResults.frontier_no_short_capm
        ? originalResults.frontier_no_short_capm
        : originalResults.frontier_no_short)
    : null
  const activeResults = results ? { ...results, portfolio: activePortfolio || results.portfolio } : null

  // The original diamond on the frontier chart must always anchor to the
  // user's first-analysis portfolio position, even after applying other weights.
  const originalPortfolio = originalResults
    ? (effectiveMethod === 'capm' && originalResults.portfolio_capm
        ? originalResults.portfolio_capm
        : originalResults.portfolio)
    : null

  return (
    <div className={`app-shell${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}`}>
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed(c => !c)}
        analysisMode={analysisMode}
        onAnalysisModeChange={handleAnalysisModeChange}
        benchmark={benchmark}
        onBenchmarkChange={handleBenchmarkChange}
        customBenchmark={customBenchmark}
        onCustomBenchmarkChange={setCustomBenchmark}
        currency={currency}
        onCurrencyChange={setCurrency}
        periodMode={periodMode}
        onPeriodModeChange={setPeriodMode}
        liveRiskFreeRate={liveRiskFreeRate}
        liveRiskFreeRateLoading={liveRiskFreeRateLoading}
        riskFreeOverride={riskFreeOverride}
        onRiskFreeOverrideChange={setRiskFreeOverride}
        riskFreeOverrideValue={riskFreeOverrideValue}
        onRiskFreeOverrideValueChange={setRiskFreeOverrideValue}
        returnMethod={returnMethod}
        onReturnMethodChange={handleReturnMethodChange}
        riskAversion={riskAversion}
        onRiskAversionChange={setRiskAversion}
        advancedMode={advancedMode}
        onAdvancedModeChange={setAdvancedMode}
        capmAvailable={
          originalResults
            ? !!(originalResults.capm_info && originalResults.capm_info.available)
            : true
        }
      />
      <div className="app-content">
        <header className="navbar">
          <div className="navbar-inner">
            <a className="navbar-brand" href="/" aria-label="Foliovex home">
              <span className="navbar-brand-icon" aria-hidden="true">
                <span className="navbar-brand-icon-text">FV</span>
              </span>
              <span className="navbar-brand-text">Foliovex</span>
            </a>
            <div className="navbar-right">
              <nav className="navbar-tabs" role="tablist" aria-label="Main navigation">
                <button
                  role="tab"
                  aria-selected={activeTab === 'portfolio'}
                  className={`navbar-tab${activeTab === 'portfolio' ? ' is-active' : ''}`}
                  onClick={() => setActiveTab('portfolio')}
                >
                  Portfolio
                </button>
                <button
                  role="tab"
                  aria-selected={activeTab === 'compare'}
                  className={`navbar-tab${activeTab === 'compare' ? ' is-active' : ''}`}
                  onClick={() => setActiveTab('compare')}
                >
                  Compare
                </button>
                <button
                  role="tab"
                  aria-selected={activeTab === 'methodology'}
                  className={`navbar-tab${activeTab === 'methodology' ? ' is-active' : ''}`}
                  onClick={() => setActiveTab('methodology')}
                >
                  Methodology
                </button>
              </nav>
              <div className="navbar-divider" />
              <button
                className={`theme-switch${isDark ? ' is-dark' : ''}`}
                onClick={toggleTheme}
                role="switch"
                aria-checked={isDark}
                aria-label="Toggle dark mode"
              >
                <span className={`theme-switch-icon${!isDark ? ' is-active' : ''}`}>
                  <SunIcon />
                </span>
                <span className="theme-switch-track">
                  <span className="theme-switch-thumb" />
                </span>
                <span className={`theme-switch-icon${isDark ? ' is-active' : ''}`}>
                  <MoonIcon />
                </span>
              </button>
            </div>
          </div>
        </header>

      <main className="main">

        {activeTab === 'methodology' && <Methodology />}

        {activeTab === 'compare' && <Compare saved={saved} />}

        {activeTab === 'portfolio' && (
        <>

        {isComingSoon && (
          <div className="coming-soon">
            <div className="coming-soon-title">{comingSoonLabel} — Coming Soon</div>
            <p className="coming-soon-subtitle">
              This analysis mode isn't available yet. Switch back to <strong>No Short Selling</strong>
              {' '}in the sidebar to continue using the app.
            </p>
          </div>
        )}

        {!isComingSoon && (
        <>
        {/* ── Input card ──────────────────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <h2>Portfolio Holdings</h2>
          </div>

          <div className="stock-list-header">
            <span>Ticker</span>
            <span>Amount ({currency})</span>
            <span />
          </div>
          <p className="ticker-hint">💡 For stocks &amp; ETFs only listed in Canada, add .TO suffix (e.g. RY.TO, XIU.TO)</p>

          <div className="stock-rows">
            {stocks.map(stock => (
              <div key={stock.id} className="stock-row">
                <input
                  type="text"
                  className="input ticker-input"
                  placeholder="e.g. AAPL"
                  value={stock.ticker}
                  maxLength={10}
                  onChange={e =>
                    updateStock(stock.id, 'ticker', e.target.value.toUpperCase())
                  }
                />
                <input
                  type="number"
                  className="input"
                  placeholder="0.00"
                  value={stock.amount}
                  min="0"
                  step="100"
                  onChange={e => updateStock(stock.id, 'amount', e.target.value)}
                />
                <button
                  className="remove-btn"
                  onClick={() => removeStock(stock.id)}
                  disabled={stocks.length <= 1}
                  title="Remove row"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="actions">
            <button
              className="btn btn-secondary"
              onClick={addStock}
              disabled={stocks.length >= MAX_STOCKS}
            >
              + Add Stock
              {stocks.length >= MAX_STOCKS
                ? ' (max)'
                : ` (${stocks.length}/${MAX_STOCKS})`}
            </button>

            {hasCml ? (
              <div className="holdings-totals">
                <div>
                  Your Investment:{' '}
                  <strong>{fmtCurrency(cmlTotal, currency, 2)}</strong>
                </div>
                {cmlIsLeveraged ? (
                  <>
                    <div className="holdings-borrowed">
                      Borrowed (leverage):{' '}
                      <strong>{fmtCurrency(Math.abs(cmlInTBills), currency, 2)}</strong>
                    </div>
                    <div>
                      Total Deployed:{' '}
                      <strong>{fmtCurrency(cmlInStocks, currency, 2)}</strong>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="holdings-tbill">
                      In T-bills:{' '}
                      <strong>{fmtCurrency(cmlInTBills, currency, 2)}</strong>
                    </div>
                    <div>
                      In Stocks:{' '}
                      <strong>{fmtCurrency(cmlInStocks, currency, 2)}</strong>
                    </div>
                  </>
                )}
              </div>
            ) : hasShortPositions ? (
              <div className="holdings-totals">
                <div>
                  Your Investment:{' '}
                  <strong>{fmtCurrency(equityAmount, currency, 2)}</strong>
                </div>
                <div className="holdings-borrowed">
                  Borrowed (short):{' '}
                  <strong>{fmtCurrency(shortAmount, currency, 2)}</strong>
                </div>
                <div>
                  Total Deployed:{' '}
                  <strong>{fmtCurrency(longAmount, currency, 2)}</strong>
                </div>
              </div>
            ) : (
              totalInvestment > 0 && (
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  Total: {fmtCurrency(totalInvestment, currency)}
                </span>
              )
            )}

            <div className="actions-cta">
              {!stocksFromUser && originalSnapshot && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleResetToOriginal}
                  disabled={loading}
                  title="Restore your original dollar amounts and re-run the analysis"
                >
                  ↩ Reset to Original
                </button>
              )}
              <button
                className="btn btn-primary"
                onClick={handleAnalyze}
                disabled={loading}
              >
                {loading && <span className="spinner" />}
                {loading ? 'Analyzing…' : 'Analyze Portfolio'}
              </button>
            </div>
          </div>

          {error && <div className="error-msg">{error}</div>}

          {/* ── Save / load section ──────────────────────────── */}
          <div className="save-load-row" style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <input
              type="text"
              className="save-name-input"
              placeholder="Portfolio name…"
              value={saveName}
              maxLength={40}
              onChange={e => setSaveName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
            />
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleSave}
              disabled={!saveName.trim()}
            >
              Save
            </button>
          </div>

          {savedNames.length > 0 && (
            <div className="saved-list">
              {savedNames.map(name => (
                <div key={name} className="saved-chip">
                  {name}
                  <button
                    className="saved-chip-load"
                    onClick={() => handleLoad(name)}
                  >
                    Load
                  </button>
                  <button
                    className="saved-chip-delete"
                    onClick={() => handleDelete(name)}
                    title="Delete"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {isShortSelling && (
          <div className="short-disclaimer" role="note">
            ⚠️ Short selling involves unlimited downside risk and requires
            active portfolio monitoring.
          </div>
        )}

        {/* ── Results ────────────────────────────────────────── */}
        {results && originalResults && (
          <div ref={resultsRef} className="results-section">
            {isMonteCarlo ? (
              mcLoading ? (
                <div className="card mc-loading-card">
                  <span
                    className="spinner"
                    style={{
                      border: '2px solid var(--border)',
                      borderTopColor: 'var(--primary)',
                    }}
                  />
                  <span className="mc-loading-text">Running 10,000 simulations…</span>
                </div>
              ) : mcResults ? (
                <MonteCarloResults
                  data={mcResults}
                  currency={currency}
                  returnMethod={effectiveMethod}
                  compareBenchmark={benchmark === 'custom' ? 'none' : benchmark}
                  onCompareBenchmarkChange={handleBenchmarkChange}
                />
              ) : null
            ) : (
              <>
                <PortfolioSummary
                  results={activeResults}
                  periodMode={periodMode}
                  returnMethod={effectiveMethod}
                  riskAversion={riskAversion}
                  advancedMode={advancedMode}
                />
                {results.benchmark && (
                  <BenchmarkCard results={activeResults} periodMode={periodMode} />
                )}
                <PerStockCards
                  results={activeResults}
                  periodMode={periodMode}
                  returnMethod={effectiveMethod}
                />
                <CorrelationHeatmap correlation={results.correlation} />
                {results.benchmark && results.portfolio_monthly_returns && (
                  <CumulativePerformanceChart
                    dates={results.dates}
                    portfolioReturns={results.portfolio_monthly_returns}
                    benchmark={results.benchmark}
                  />
                )}
                <EfficientFrontier
                  frontier={activeFrontier}
                  portfolio={activePortfolio || originalResults.portfolio}
                  originalPortfolio={originalPortfolio}
                  activeKey={activeKey}
                  onApplyWeights={handleApplyWeights}
                  applying={loading}
                  benchmark={originalResults.benchmark}
                  shortSelling={!!originalResults.short_selling}
                  comparisonFrontier={activeFrontierNoShort}
                  returnMethod={effectiveMethod}
                />
              </>
            )}
          </div>
        )}
        </>
        )}

        </>
        )}

      </main>
      </div>
    </div>
  )
}
