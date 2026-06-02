import { useState } from 'react'
import { fmtPct, fmtSharpe, fmtNum } from '../utils/format'
import { API_BASE_URL } from '../utils/api'

// 3 distinct colors that read well on light + dark surfaces.
const COLORS = ['#6366f1', '#10b981', '#f59e0b']
const A_DEFAULT = 4

// Pick CAPM portfolio if available, else historical.
function effectivePortfolio(data) {
  return data?.portfolio_capm || data?.portfolio || null
}
function effectiveFrontier(data) {
  return data?.frontier_capm || data?.frontier || null
}

// Compute portfolio beta as the weighted sum of per-stock betas.
function computeBeta(data, weights) {
  if (!data || !Array.isArray(weights) || !Array.isArray(data.tickers) || !data.per_stock) {
    return null
  }
  let sum = 0
  for (let i = 0; i < data.tickers.length; i++) {
    const m = data.per_stock[data.tickers[i]]
    if (!m || !Number.isFinite(m.beta)) return null
    sum += weights[i] * m.beta
  }
  return sum
}

function extractMetrics(data, A = A_DEFAULT) {
  if (!data) return null
  const p = effectivePortfolio(data)
  if (!p) return null
  const rf = Number.isFinite(data.risk_free_rate) ? data.risk_free_rate : 0
  const E = p.annualized_return
  const sigma = p.annualized_volatility
  const sharpe = p.sharpe_ratio
  const utility = (Number.isFinite(E) && Number.isFinite(sigma))
    ? E - 0.5 * A * sigma * sigma
    : null
  const yStar = (Number.isFinite(E) && Number.isFinite(sigma) && sigma > 0)
    ? (E - rf) / (A * sigma * sigma)
    : null
  const beta = computeBeta(data, p.weights)
  return { E, sigma, sharpe, utility, yStar, beta }
}

// "best" = green, "worst" = red, middle = yellow. Ties share the best class.
// `higherBetter = null` means neutral — no color.
function rankClass(value, allValues, higherBetter) {
  if (higherBetter == null || value == null || !Number.isFinite(value)) return ''
  const valid = allValues.filter(v => Number.isFinite(v))
  if (valid.length < 2) return ''
  const max = Math.max(...valid)
  const min = Math.min(...valid)
  if (max === min) return ''  // all tied — no distinction worth flagging
  const best = higherBetter ? max : min
  const worst = higherBetter ? min : max
  if (Math.abs(value - best) < 1e-12) return 'rank-best'
  if (Math.abs(value - worst) < 1e-12) return 'rank-worst'
  return 'rank-mid'
}

function fmtUtility(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  const sign = v >= 0 ? '+' : ''
  return `${sign}${(v * 100).toFixed(2)}%`
}

function fmtAlloc(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${(v * 100).toFixed(0)}%`
}

export default function Compare({ saved }) {
  const savedNames = Object.keys(saved)
  const [slots, setSlots] = useState(['', '', ''])
  const [analyses, setAnalyses] = useState({})
  const [comparing, setComparing] = useState(false)
  const [hasResults, setHasResults] = useState(false)

  const distinctSelected = [...new Set(slots.filter(n => n && saved[n]))]
  const canCompare = distinctSelected.length >= 2 && !comparing

  const setSlot = (i, value) => {
    const next = [...slots]
    next[i] = value
    setSlots(next)
    setHasResults(false)
  }

  const runCompare = async () => {
    setComparing(true)
    setHasResults(false)
    const results = {}
    await Promise.all(distinctSelected.map(async name => {
      const entry = saved[name]
      if (!entry) {
        results[name] = { error: 'Portfolio not found' }
        return
      }
      try {
        const res = await fetch(`${API_BASE_URL}/api/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stocks: entry.stocks
              .filter(s => s.ticker.trim() !== '' && parseFloat(s.amount) > 0)
              .map(s => ({
                ticker: s.ticker.trim().toUpperCase(),
                amount: parseFloat(s.amount),
              })),
            currency: entry.currency,
            short_selling: false,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || `Server error ${res.status}`)
        }
        results[name] = { data: await res.json() }
      } catch (e) {
        results[name] = { error: e.message || 'Analysis failed' }
      }
    }))
    setAnalyses(results)
    setComparing(false)
    setHasResults(true)
  }

  // ── Render ──────────────────────────────────────────────────

  if (savedNames.length === 0) {
    return (
      <div className="compare-empty card">
        <h2>Compare Portfolios</h2>
        <p>
          You don't have any saved portfolios yet. Go to the <strong>Portfolio</strong>{' '}
          tab, build a portfolio, and save it — then come back here to compare it
          against others.
        </p>
      </div>
    )
  }

  const portfolios = distinctSelected.map((name, idx) => ({
    name,
    color: COLORS[idx % COLORS.length],
    state: analyses[name],
  }))

  const succeeded = portfolios.filter(p => p.state?.data)
  const failed = portfolios.filter(p => p.state?.error)
  const allMetrics = succeeded.map(p => extractMetrics(p.state.data))

  return (
    <div className="compare">
      <div className="card">
        <div className="card-header">
          <h2>Compare Portfolios</h2>
        </div>

        <div className="compare-slots">
          {[0, 1, 2].map(i => (
            <div key={i} className="compare-slot">
              <label className="compare-slot-label">Portfolio {i + 1}</label>
              <select
                className="compare-slot-select"
                value={slots[i]}
                onChange={e => setSlot(i, e.target.value)}
              >
                <option value="">— Select —</option>
                {savedNames.map(name => (
                  <option
                    key={name}
                    value={name}
                    disabled={slots.includes(name) && slots[i] !== name}
                  >
                    {name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <div className="compare-actions">
          {distinctSelected.length < 2 ? (
            <p className="compare-hint">
              Select at least 2 saved portfolios to compare.
            </p>
          ) : <span />}
          <button
            className="btn btn-primary"
            onClick={runCompare}
            disabled={!canCompare}
          >
            {comparing && <span className="spinner" />}
            {comparing ? 'Analyzing…' : 'Compare'}
          </button>
        </div>
      </div>

      {hasResults && failed.length > 0 && (
        <div className="card compare-errors">
          {failed.map(p => (
            <div key={p.name} className="error-msg">
              <strong>{p.name}:</strong> {p.state.error}
            </div>
          ))}
        </div>
      )}

      {hasResults && succeeded.length >= 2 && (
        <>
          <ComparisonTable portfolios={succeeded} metrics={allMetrics} />
          <ComparisonFrontier portfolios={succeeded} />
        </>
      )}
    </div>
  )
}

// ── Table ──────────────────────────────────────────────────────

function ComparisonTable({ portfolios, metrics }) {
  // Each row: label, formatter, key into metrics, "higher is better" flag (or null = neutral).
  const ROWS = [
    { label: 'Expected Annual Return', key: 'E',       fmt: fmtPct,     higherBetter: true  },
    { label: 'Annual Volatility',      key: 'sigma',   fmt: fmtPct,     higherBetter: false },
    { label: 'Sharpe Ratio',           key: 'sharpe',  fmt: fmtSharpe,  higherBetter: true  },
    { label: 'Utility Score (U)',      key: 'utility', fmt: fmtUtility, higherBetter: true  },
    { label: 'Beta',                   key: 'beta',    fmt: v => v == null ? '—' : fmtNum(v, 2), higherBetter: null },
    { label: 'Optimal Allocation (y*)',key: 'yStar',   fmt: fmtAlloc,   higherBetter: true  },
  ]

  return (
    <div className="card">
      <div className="card-header">
        <h2>Comparison Table</h2>
        <span className="card-meta">U and y* use A = {A_DEFAULT}</span>
      </div>
      <div className="compare-table-wrap">
        <table className="compare-table">
          <thead>
            <tr>
              <th></th>
              {portfolios.map(p => (
                <th key={p.name} className="compare-th">
                  <span className="compare-th-swatch" style={{ background: p.color }} />
                  {p.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map(row => {
              const values = metrics.map(m => m?.[row.key])
              return (
                <tr key={row.key}>
                  <th className="compare-row-label">{row.label}</th>
                  {portfolios.map((p, i) => {
                    const v = values[i]
                    const cls = rankClass(v, values, row.higherBetter)
                    return (
                      <td key={p.name} className={`compare-cell ${cls}`}>
                        {row.fmt(v)}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="compare-table-legend">
        <span className="compare-legend-item"><span className="compare-swatch rank-best" /> Best</span>
        <span className="compare-legend-item"><span className="compare-swatch rank-mid" /> Average</span>
        <span className="compare-legend-item"><span className="compare-swatch rank-worst" /> Worst</span>
        <span className="compare-legend-item compare-legend-note">Beta is neutral — no ranking.</span>
      </div>
    </div>
  )
}

// ── Multi-portfolio Efficient Frontier chart ───────────────────

const W = 800
const H = 460
const PAD = { top: 24, right: 28, bottom: 56, left: 70 }

function niceStep(rough) {
  if (rough <= 0) return 1
  const exp = Math.floor(Math.log10(rough))
  const f = rough / Math.pow(10, exp)
  let nf
  if (f < 1.5) nf = 1
  else if (f < 3) nf = 2
  else if (f < 7) nf = 5
  else nf = 10
  return nf * Math.pow(10, exp)
}

function niceTicks(min, max, nApprox = 5) {
  const range = max - min
  if (range <= 0) return [min]
  const step = niceStep(range / nApprox)
  const start = Math.ceil(min / step) * step
  const ticks = []
  for (let v = start; v <= max + step / 2; v += step) {
    ticks.push(parseFloat(v.toFixed(10)))
  }
  return ticks
}

function ComparisonFrontier({ portfolios }) {
  // Build series: { name, color, curve (sorted by x), point (original portfolio) }
  const series = portfolios.map(p => {
    const f = effectiveFrontier(p.state.data)
    const port = effectivePortfolio(p.state.data)
    if (!f || !Array.isArray(f.curve) || f.curve.length === 0) return null
    const curve = f.curve
      .map(pt => ({ x: pt.annualized_volatility, y: pt.annualized_return }))
      .filter(pt => Number.isFinite(pt.x) && Number.isFinite(pt.y))
      .sort((a, b) => a.x - b.x)
    const point = port && Number.isFinite(port.annualized_volatility)
      && Number.isFinite(port.annualized_return)
      ? { x: port.annualized_volatility, y: port.annualized_return,
          sharpe: port.sharpe_ratio }
      : null
    return { name: p.name, color: p.color, curve, point }
  }).filter(Boolean)

  if (series.length === 0) return null

  const xs = series.flatMap(s => [...s.curve.map(p => p.x), s.point?.x].filter(Number.isFinite))
  const ys = series.flatMap(s => [...s.curve.map(p => p.y), s.point?.y].filter(Number.isFinite))
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const yMin = Math.min(...ys)
  const yMax = Math.max(...ys)
  const xPad = (xMax - xMin) * 0.1 || 0.005
  const yPad = (yMax - yMin) * 0.15 || 0.01
  const xLo = Math.max(0, xMin - xPad)
  const xHi = xMax + xPad
  const yLo = yMin - yPad
  const yHi = yMax + yPad

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const sx = (x) => PAD.left + ((x - xLo) / (xHi - xLo)) * plotW
  const sy = (y) => PAD.top + plotH - ((y - yLo) / (yHi - yLo)) * plotH
  const xTicks = niceTicks(xLo, xHi, 6)
  const yTicks = niceTicks(yLo, yHi, 6)

  return (
    <div className="card">
      <div className="card-header">
        <h2>Efficient Frontiers</h2>
        <span className="card-meta">no short-selling · diamonds mark each portfolio</span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="frontier-chart"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Efficient frontier comparison chart"
      >
        {yTicks.map(y => (
          <line key={`gy-${y}`} x1={PAD.left} x2={W - PAD.right}
            y1={sy(y)} y2={sy(y)} className="grid-line" />
        ))}
        {xTicks.map(x => (
          <line key={`gx-${x}`} x1={sx(x)} x2={sx(x)}
            y1={PAD.top} y2={H - PAD.bottom} className="grid-line" />
        ))}
        <line x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right}
          y2={H - PAD.bottom} className="axis-line" />
        <line x1={PAD.left} y1={PAD.top} x2={PAD.left}
          y2={H - PAD.bottom} className="axis-line" />

        {xTicks.map(x => (
          <text key={`xt-${x}`} x={sx(x)} y={H - PAD.bottom + 18} className="axis-label">
            {fmtPct(x, 1)}
          </text>
        ))}
        {yTicks.map(y => (
          <text key={`yt-${y}`} x={PAD.left - 10} y={sy(y) + 4} className="axis-label-y">
            {fmtPct(y, 1)}
          </text>
        ))}
        <text x={PAD.left + plotW / 2} y={H - 14} className="axis-title">
          Annualized Volatility (risk)
        </text>
        <text transform={`translate(20 ${PAD.top + plotH / 2}) rotate(-90)`} className="axis-title">
          Annualized Return
        </text>

        {/* Frontier curves */}
        {series.map(s => {
          const d = s.curve
            .map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.x).toFixed(2)} ${sy(p.y).toFixed(2)}`)
            .join(' ')
          return (
            <path
              key={`curve-${s.name}`}
              d={d}
              fill="none"
              stroke={s.color}
              strokeWidth="2.5"
              strokeLinejoin="round"
              opacity="0.85"
            />
          )
        })}

        {/* Portfolio diamond markers */}
        {series.map(s => {
          if (!s.point) return null
          const x = sx(s.point.x)
          const y = sy(s.point.y)
          const r = 9
          return (
            <g key={`pt-${s.name}`} fill={s.color} stroke="white" strokeWidth="2">
              <rect x={x - r} y={y - r} width={r * 2} height={r * 2}
                transform={`rotate(45 ${x} ${y})`} />
              <title>
                {s.name} · ret {fmtPct(s.point.y)} · vol {fmtPct(s.point.x)} · Sharpe {fmtSharpe(s.point.sharpe)}
              </title>
            </g>
          )
        })}
      </svg>

      <div className="compare-frontier-legend">
        {series.map(s => (
          <div key={s.name} className="compare-legend-row">
            <span className="compare-legend-line" style={{ background: s.color }} />
            <svg width="14" height="14" viewBox="0 0 14 14" style={{ flexShrink: 0 }}>
              <rect x="2.5" y="2.5" width="9" height="9"
                transform="rotate(45 7 7)" fill={s.color} stroke="white" strokeWidth="1.5" />
            </svg>
            <span className="compare-legend-name">{s.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
