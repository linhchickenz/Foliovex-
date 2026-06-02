/**
 * Monte Carlo simulation results: fan chart, summary stats, and VaR
 * (with a toggle between parametric Z-score and empirical Monte Carlo VaR).
 *
 * Optional comparison benchmark: when set, a second simulation is overlaid on
 * the fan chart and a side-by-side summary + "probability your portfolio
 * beats the benchmark" stat appear in the Simulation Summary card.
 */
import { useState } from 'react'
import { fmtCurrency } from '../utils/format'

const W = 800
const H = 380
const PAD = { top: 24, right: 28, bottom: 60, left: 80 }

const HORIZON_OPTS = [
  { key: '6m',  label: '6M',   summary: '6 Month',  months: 6   },
  { key: '1y',  label: '1Y',   summary: '1 Year',   months: 12  },
  { key: '3y',  label: '3Y',   summary: '3 Year',   months: 36  },
  { key: '5y',  label: '5Y',   summary: '5 Year',   months: 60  },
  { key: '10y', label: '10Y',  summary: '10 Year',  months: 120 },
]

// Compare-with options. `none` disables the overlay. Tickers are owned by
// App.jsx (it resolves the id to a ticker and posts to /api/monte-carlo).
const COMPARE_OPTS = [
  { id: 'none',  label: 'None' },
  { id: 'sp500', label: 'S&P 500' },
  { id: 'tsx',   label: 'S&P/TSX' },
  { id: 'tsx60', label: 'TSX 60' },
]

// ── Helpers ──────────────────────────────────────────────────────

function niceStep(rough) {
  if (rough <= 0) return 1
  const exp = Math.floor(Math.log10(rough))
  const f = rough / Math.pow(10, exp)
  const nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10
  return nf * Math.pow(10, exp)
}

function niceTicks(min, max, nApprox = 5) {
  const range = max - min
  if (range <= 0) return [min]
  const step = niceStep(range / nApprox)
  const start = Math.ceil(min / step) * step
  const ticks = []
  for (let v = start; v <= max + step / 2; v += step) ticks.push(parseFloat(v.toFixed(10)))
  return ticks
}

function fmtAxisY(v, currency) {
  const prefix = currency === 'CAD' ? 'CA$' : 'US$'
  const av = Math.abs(v)
  if (av >= 1_000_000) return `${prefix}${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (av >= 1_000) return `${prefix}${(v / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return `${prefix}${v.toFixed(0)}`
}

function fmtMonth(m) {
  if (m === 0) return 'Now'
  if (m % 12 === 0) return `${m / 12}Y`
  return `${m}M`
}

function gainStr(value, initial) {
  const pct = (value / initial - 1) * 100
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}

// ── Fan chart SVG ────────────────────────────────────────────────

function FanChart({ hz, bmHz, currency, totalInvestment, bandMode }) {
  const { percentile_paths: paths, n_months } = hz
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom

  const outerLo = bandMode === '99' ? paths.p1 : paths.p5
  const outerHi = bandMode === '99' ? paths.p99 : paths.p95

  // Benchmark uses the same band-mode percentiles for visual consistency.
  const bmPaths = bmHz?.percentile_paths
  const bmOuterLo = bmPaths ? (bandMode === '99' ? bmPaths.p1 : bmPaths.p5) : null
  const bmOuterHi = bmPaths ? (bandMode === '99' ? bmPaths.p99 : bmPaths.p95) : null

  const allVals = [
    ...outerLo, ...outerHi,
    ...(bmOuterLo || []),
    ...(bmOuterHi || []),
  ]
  const yRawMin = Math.min(...allVals)
  const yRawMax = Math.max(...allVals)
  const yPad = (yRawMax - yRawMin) * 0.1 || totalInvestment * 0.05
  const yLo = Math.max(0, yRawMin - yPad)
  const yHi = yRawMax + yPad

  const sx = (t) => PAD.left + (t / n_months) * plotW
  const sy = (v) => PAD.top + plotH - ((v - yLo) / (yHi - yLo)) * plotH

  function polyline(arr) {
    return arr.map((v, i) => `${i === 0 ? 'M' : 'L'} ${sx(i).toFixed(1)} ${sy(v).toFixed(1)}`).join(' ')
  }

  function band(lower, upper) {
    const n = lower.length
    let d = lower.map((v, i) => `${i === 0 ? 'M' : 'L'} ${sx(i).toFixed(1)} ${sy(v).toFixed(1)}`).join(' ')
    for (let i = n - 1; i >= 0; i--) d += ` L ${sx(i).toFixed(1)} ${sy(upper[i]).toFixed(1)}`
    return `${d} Z`
  }

  const xTickStep = n_months <= 6 ? 1 : n_months <= 12 ? 3 : n_months <= 36 ? 6 : n_months <= 60 ? 12 : 24
  const xTicks = []
  for (let m = 0; m <= n_months; m += xTickStep) xTicks.push(m)
  const yTicks = niceTicks(yLo, yHi, 5)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mc-fan-chart"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Monte Carlo simulation fan chart"
    >
      {yTicks.map(v => (
        <line key={`gy-${v}`} x1={PAD.left} x2={W - PAD.right} y1={sy(v)} y2={sy(v)} className="grid-line" />
      ))}
      {xTicks.map(m => (
        <line key={`gx-${m}`} x1={sx(m)} x2={sx(m)} y1={PAD.top} y2={H - PAD.bottom} className="grid-line" />
      ))}

      <line x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom} className="axis-line" />
      <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={H - PAD.bottom} className="axis-line" />

      {xTicks.map(m => (
        <text key={`xt-${m}`} x={sx(m)} y={H - PAD.bottom + 18} className="axis-label">{fmtMonth(m)}</text>
      ))}
      {yTicks.map(v => (
        <text key={`yt-${v}`} x={PAD.left - 8} y={sy(v) + 4} className="axis-label-y">{fmtAxisY(v, currency)}</text>
      ))}

      <text x={PAD.left + plotW / 2} y={H - 14} className="axis-title">Time</text>
      <text transform={`translate(18 ${PAD.top + plotH / 2}) rotate(-90)`} className="axis-title">
        Portfolio Value ({currency})
      </text>

      {/* Break-even reference line */}
      <line
        x1={PAD.left} x2={W - PAD.right}
        y1={sy(totalInvestment)} y2={sy(totalInvestment)}
        stroke="var(--text-muted)" strokeWidth="1" strokeDasharray="5 4" opacity="0.55"
      />
      <text x={W - PAD.right - 4} y={sy(totalInvestment) - 5} textAnchor="end" fontSize="10" fill="var(--text-muted)" opacity="0.7">
        start
      </text>

      {/* Benchmark drawn UNDER the portfolio so the portfolio remains the focus. */}
      {bmOuterLo && bmOuterHi && (
        <>
          <path d={band(bmOuterLo, bmOuterHi)} className="mc-bm-band" />
          <path d={polyline(bmPaths.p50)} className="mc-bm-median-line" />
        </>
      )}

      <path d={band(outerLo, outerHi)} className="mc-band-outer" />
      <path d={band(paths.p25, paths.p75)} className="mc-band-inner" />
      <path d={polyline(paths.p50)} className="mc-median-line" />
    </svg>
  )
}

// ── VaR table (shared layout for both methods) ───────────────────

function VarTable({ varConf, currency }) {
  const rows = [
    { label: '95% Confidence', z: '1.645', d: varConf.conf_95 },
    { label: '99% Confidence', z: '2.326', d: varConf.conf_99 },
  ]
  return (
    <div className="mc-var-table">
      <div className="mc-var-header">
        <span />
        <span>1-Day VaR</span>
        <span>1-Month VaR</span>
      </div>
      {rows.map(({ label, z, d }) => (
        <div key={label} className="mc-var-row">
          <div className="mc-var-conf">
            <span>{label}</span>
            {z && <span className="mc-var-z">z = {z}</span>}
          </div>
          <div className="mc-var-cell">
            <span className="mc-var-dollar">−{fmtCurrency(d.daily_dollar, currency)}</span>
            <span className="mc-var-pct">{(d.daily_pct * 100).toFixed(2)}% of portfolio</span>
          </div>
          <div className="mc-var-cell">
            <span className="mc-var-dollar">−{fmtCurrency(d.monthly_dollar, currency)}</span>
            <span className="mc-var-pct">{(d.monthly_pct * 100).toFixed(2)}% of portfolio</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Side-by-side summary row used when a benchmark is active ─────

function CompareRow({ label, portValue, portSub, bmValue, bmSub, portTone, bmTone }) {
  return (
    <div className="mc-compare-row">
      <div className="mc-compare-label">{label}</div>
      <div className="mc-compare-side">
        <div className="mc-compare-side-label">Your Portfolio</div>
        <div className={`mc-compare-side-value${portTone ? ` mc-stat-${portTone}` : ''}`}>
          {portValue}
        </div>
        {portSub != null && <div className="mc-compare-side-sub">{portSub}</div>}
      </div>
      <div className="mc-compare-side">
        <div className="mc-compare-side-label mc-compare-side-bm-label">Benchmark</div>
        <div className={`mc-compare-side-value${bmTone ? ` mc-stat-${bmTone}` : ''}`}>
          {bmValue}
        </div>
        {bmSub != null && <div className="mc-compare-side-sub">{bmSub}</div>}
      </div>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────

export default function MonteCarloResults({
  data,
  currency,
  returnMethod = 'capm',
  compareBenchmark = 'none',
  onCompareBenchmarkChange = null,
}) {
  const [horizon, setHorizon] = useState('1y')
  const [bandMode, setBandMode] = useState('95')
  const [varMethod, setVarMethod] = useState('parametric')

  if (!data?.horizons) return null
  const hz = data.horizons[horizon]
  if (!hz) return null

  const { final_stats: stats } = hz
  const { var: varBoth, total_investment: totalInvestment, benchmark: bm } = data
  const bmHz = bm?.horizons?.[horizon] || null
  const bmStats = bmHz?.final_stats || null
  const probBeats = bmHz?.prob_portfolio_beats
  const hzOpt = HORIZON_OPTS.find(h => h.key === horizon)
  const hzSummary = hzOpt?.summary ?? ''

  const activeVar = varMethod === 'parametric' ? varBoth.parametric : varBoth.monte_carlo

  // When a benchmark is selected we render a side-by-side summary; otherwise
  // the original single-column stat grid.
  const bestKey = bandMode === '99' ? 'p99' : 'p95'
  const worstKey = bandMode === '99' ? 'p1' : 'p5'
  const bestLabel = bandMode === '99' ? 'Best Case (99th pct)' : 'Best Case (95th pct)'
  const worstLabel = bandMode === '99' ? 'Worst Case (1st pct)' : 'Worst Case (5th pct)'

  const compareActive = compareBenchmark && compareBenchmark !== 'none'
  const hasBenchmarkData = !!bmStats

  return (
    <>
      {/* ── Fan chart card ────────────────────────────────────── */}
      <div className="card">
        <div className="card-header">
          <h2>Monte Carlo Simulation ({returnMethod === 'capm' ? 'CAPM' : 'Historical'})</h2>
          <span className="card-meta">
            10,000 simulated paths
            {hasBenchmarkData && bm?.name ? ` · vs ${bm.name}` : ''}
          </span>
        </div>

        <div className="mc-horizon-row">
          <span className="mc-horizon-label">Time Horizon</span>
          <div className="period-toggle">
            {HORIZON_OPTS.map(h => (
              <button
                key={h.key}
                type="button"
                className={`seg-btn${horizon === h.key ? ' active' : ''}`}
                onClick={() => setHorizon(h.key)}
              >
                {h.label}
              </button>
            ))}
          </div>
          <span className="mc-horizon-label mc-band-label">Confidence Band</span>
          <div className="period-toggle">
            <button
              type="button"
              className={`seg-btn${bandMode === '95' ? ' active' : ''}`}
              onClick={() => setBandMode('95')}
            >
              95% CI
            </button>
            <button
              type="button"
              className={`seg-btn${bandMode === '99' ? ' active' : ''}`}
              onClick={() => setBandMode('99')}
            >
              99% CI
            </button>
          </div>
        </div>

        <div className="mc-compare-row-wrap">
          <span className="mc-horizon-label">Compare With</span>
          <select
            className="mc-compare-select"
            value={compareBenchmark}
            onChange={e => onCompareBenchmarkChange && onCompareBenchmarkChange(e.target.value)}
          >
            {COMPARE_OPTS.map(o => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          {compareActive && !hasBenchmarkData && (
            <span className="mc-compare-warn">No data available — try a different benchmark.</span>
          )}
        </div>

        <FanChart
          hz={hz}
          bmHz={hasBenchmarkData ? bmHz : null}
          currency={currency}
          totalInvestment={totalInvestment}
          bandMode={bandMode}
        />

        <div className="mc-legend">
          <div className="mc-legend-item">
            <span className="mc-legend-swatch mc-legend-outer" aria-hidden="true" />
            <span>
              {bandMode === '99'
                ? '99% confidence (1st – 99th percentile)'
                : '95% confidence (5th – 95th percentile)'}
            </span>
          </div>
          <div className="mc-legend-item">
            <span className="mc-legend-swatch mc-legend-inner" aria-hidden="true" />
            <span>25th – 75th percentile</span>
          </div>
          <div className="mc-legend-item">
            <span className="mc-legend-line" aria-hidden="true" />
            <span>Median (50th)</span>
          </div>
          {hasBenchmarkData && (
            <>
              <div className="mc-legend-item">
                <span className="mc-legend-swatch mc-legend-bm-band" aria-hidden="true" />
                <span>{bm.name} band</span>
              </div>
              <div className="mc-legend-item">
                <span className="mc-legend-line mc-legend-bm-line" aria-hidden="true" />
                <span>{bm.name} median</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Summary stats card ────────────────────────────────── */}
      <div className="card">
        <div className="card-header">
          <h2>Simulation Summary</h2>
          <span className="card-meta">
            {hzSummary} horizon
            {hasBenchmarkData && bm?.name ? ` · vs ${bm.name}` : ''}
          </span>
        </div>

        <p className="mc-sim-note">Based on 10,000 Monte Carlo simulated paths</p>

        {hasBenchmarkData ? (
          <div className="mc-compare-grid">
            <CompareRow
              label="Median Ending Value"
              portValue={fmtCurrency(stats.p50, currency)}
              portSub={gainStr(stats.p50, totalInvestment)}
              bmValue={fmtCurrency(bmStats.p50, currency)}
              bmSub={gainStr(bmStats.p50, totalInvestment)}
            />
            <CompareRow
              label={bestLabel}
              portValue={fmtCurrency(stats[bestKey], currency)}
              portSub={gainStr(stats[bestKey], totalInvestment)}
              bmValue={fmtCurrency(bmStats[bestKey], currency)}
              bmSub={gainStr(bmStats[bestKey], totalInvestment)}
            />
            <CompareRow
              label={worstLabel}
              portValue={fmtCurrency(stats[worstKey], currency)}
              portSub={gainStr(stats[worstKey], totalInvestment)}
              bmValue={fmtCurrency(bmStats[worstKey], currency)}
              bmSub={gainStr(bmStats[worstKey], totalInvestment)}
            />
            <div className="mc-prob-beats">
              <div className="mc-prob-beats-label">
                Probability your portfolio beats {bm.name} after {hzSummary.toLowerCase()}
              </div>
              <div
                className={`mc-prob-beats-value ${probBeats >= 0.5 ? 'mc-stat-positive' : 'mc-stat-negative'}`}
              >
                {(probBeats * 100).toFixed(1)}%
              </div>
              <div className="mc-prob-beats-sub">
                of 10,000 paired simulated paths
              </div>
            </div>
          </div>
        ) : (
          <div className="mc-stat-grid">
            <div className="mc-stat">
              <div className="mc-stat-label">Starting Investment</div>
              <div className="mc-stat-value">{fmtCurrency(totalInvestment, currency)}</div>
            </div>
            <div className="mc-stat">
              <div className="mc-stat-label">Median Ending Value</div>
              <div className="mc-stat-value">{fmtCurrency(stats.p50, currency)}</div>
              <div className="mc-stat-sub">{gainStr(stats.p50, totalInvestment)}</div>
            </div>
            <div className="mc-stat mc-stat-best">
              <div className="mc-stat-label">{bestLabel}</div>
              <div className="mc-stat-value">{fmtCurrency(stats[bestKey], currency)}</div>
              <div className="mc-stat-sub">{gainStr(stats[bestKey], totalInvestment)}</div>
            </div>
            <div className="mc-stat mc-stat-worst">
              <div className="mc-stat-label">{worstLabel}</div>
              <div className="mc-stat-value">{fmtCurrency(stats[worstKey], currency)}</div>
              <div className="mc-stat-sub">{gainStr(stats[worstKey], totalInvestment)}</div>
            </div>
            <div className="mc-stat">
              <div className="mc-stat-label">Probability of Profit</div>
              <div className={`mc-stat-value ${stats.prob_profit >= 0.5 ? 'mc-stat-positive' : 'mc-stat-negative'}`}>
                {(stats.prob_profit * 100).toFixed(1)}%
              </div>
              <div className="mc-stat-sub">of sims above starting value</div>
            </div>
          </div>
        )}
      </div>

      {/* ── VaR card ──────────────────────────────────────────── */}
      <div className="card">
        <div className="card-header">
          <h2>Value at Risk (VaR)</h2>
          <div className="period-toggle">
            <button
              type="button"
              className={`seg-btn${varMethod === 'parametric' ? ' active' : ''}`}
              onClick={() => setVarMethod('parametric')}
            >
              Parametric (Z-score)
            </button>
            <button
              type="button"
              className={`seg-btn${varMethod === 'monte_carlo' ? ' active' : ''}`}
              onClick={() => setVarMethod('monte_carlo')}
            >
              Monte Carlo
            </button>
          </div>
        </div>

        {varMethod === 'parametric' ? (
          <p className="mc-var-note">
            VaR estimates the maximum expected loss over a given period at a chosen confidence level.
            Parametric VaR assumes <strong>normally distributed returns</strong> and uses
            Z-scores (1.645 for 95%, 2.326 for 99%).
          </p>
        ) : (
          <p className="mc-var-note mc-var-note-mc">
            Monte Carlo VaR uses the <strong>empirical distribution of 10,000 simulated returns</strong>{' '}
            — no normality assumption. Daily VaR comes from a fresh set of daily-scaled simulations;
            monthly VaR uses the first step of the fan-chart paths. Results may differ from
            parametric VaR when returns are skewed or have fat tails.
          </p>
        )}

        <VarTable varConf={activeVar} currency={currency} />
      </div>
    </>
  )
}
