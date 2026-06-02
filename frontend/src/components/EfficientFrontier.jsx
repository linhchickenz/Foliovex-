/**
 * Efficient frontier scatter chart, hand-rolled SVG.
 *
 * X-axis = annualized volatility, Y-axis = annualized return.
 * Plots the frontier curve plus 5 named portfolio markers (each a distinct shape).
 */
import { useState } from 'react'
import { fmtPct, fmtPctSigned, fmtSharpe } from '../utils/format'
import SharpeBadge from './SharpeBadge'

const W = 800
const H = 460
const PAD = { top: 44, right: 28, bottom: 56, left: 70 }

// ── Tick generation ──────────────────────────────────────────
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

// ── Marker shapes ─────────────────────────────────────────────
// `color` is only consumed by shapes that override the wrapper <g>'s
// fill/stroke (e.g. diamond-outline draws an unfilled diamond stroked in
// the marker's own colour, not the parent's white outline).
function markerPath(shape, x, y, s, color) {
  switch (shape) {
    case 'circle':
      return <circle cx={x} cy={y} r={s} />
    case 'square':
      return <rect x={x - s} y={y - s} width={s * 2} height={s * 2} />
    case 'diamond':
      return (
        <rect
          x={x - s}
          y={y - s}
          width={s * 2}
          height={s * 2}
          transform={`rotate(45 ${x} ${y})`}
        />
      )
    case 'diamond-outline':
      return (
        <rect
          x={x - s}
          y={y - s}
          width={s * 2}
          height={s * 2}
          transform={`rotate(45 ${x} ${y})`}
          fill="none"
          stroke={color}
          strokeWidth={2.5}
          strokeLinejoin="round"
        />
      )
    case 'triangle': {
      const points = `${x},${y - s * 1.18} ${x - s * 1.05},${y + s * 0.7} ${x + s * 1.05},${y + s * 0.7}`
      return <polygon points={points} />
    }
    case 'hexagon': {
      const pts = []
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3 - Math.PI / 6
        pts.push(`${x + s * Math.cos(angle)},${y + s * Math.sin(angle)}`)
      }
      return <polygon points={pts.join(' ')} />
    }
    case 'star': {
      const pts = []
      for (let i = 0; i < 10; i++) {
        const angle = (i * Math.PI) / 5 - Math.PI / 2
        const r = i % 2 === 0 ? s * 1.2 : s * 0.55
        pts.push(`${x + r * Math.cos(angle)},${y + r * Math.sin(angle)}`)
      }
      return <polygon points={pts.join(' ')} />
    }
    case 'cross': {
      // Plus sign — orthogonal arms, visually distinct from every other shape.
      const t = s * 0.38
      const arm = s * 1.15
      const d =
        `M ${x - arm} ${y - t} L ${x - t} ${y - t} L ${x - t} ${y - arm}` +
        ` L ${x + t} ${y - arm} L ${x + t} ${y - t} L ${x + arm} ${y - t}` +
        ` L ${x + arm} ${y + t} L ${x + t} ${y + t} L ${x + t} ${y + arm}` +
        ` L ${x - t} ${y + arm} L ${x - t} ${y + t} L ${x - arm} ${y + t} Z`
      return <path d={d} strokeLinejoin="round" />
    }
    default:
      return <circle cx={x} cy={y} r={s} />
  }
}

function MarkerIcon({ shape, color, size = 14 }) {
  const c = size / 2
  const s = size * 0.42
  return (
    <svg
      width={size}
      height={size}
      style={{ flexShrink: 0 }}
      viewBox={`0 0 ${size} ${size}`}
    >
      <g fill={color} stroke="white" strokeWidth="1.5">
        {markerPath(shape, c, c, s, color)}
      </g>
    </svg>
  )
}

// ── Main chart ────────────────────────────────────────────────
const BM_NAMES = { '^SP500TR': 'S&P 500', '^SPTSXCATR': 'S&P/TSX', '^TXTY': 'TSX 60', '^SPTSE60': 'TSX 60', 'XIU.TO': 'TSX 60' }

export default function EfficientFrontier({
  frontier,
  portfolio,
  originalPortfolio = null,
  activeKey,
  onApplyWeights,
  applying = false,
  benchmark = null,
  shortSelling = false,
  comparisonFrontier = null,
  returnMethod = 'capm',
}) {
  const [showComparison, setShowComparison] = useState(false)
  const [showCml, setShowCml] = useState(false)

  if (!frontier || !frontier.curve || frontier.curve.length === 0) {
    return null
  }

  const cml = frontier.cml || null
  const cmlAvailable = !!cml && cml.slope > 0
  const showCmlLine = cmlAvailable && showCml

  const curvePts = frontier.curve.map(p => ({
    x: p.annualized_volatility,
    y: p.annualized_return,
  }))

  const canCompare =
    comparisonFrontier != null &&
    Array.isArray(comparisonFrontier.curve) &&
    comparisonFrontier.curve.length > 0
  const compCurvePts = canCompare
    ? comparisonFrontier.curve.map(p => ({
        x: p.annualized_volatility,
        y: p.annualized_return,
      }))
    : []
  const showComp = canCompare && showComparison

  const named = [
    { key: 'original',   name: 'Original Portfolio', point: originalPortfolio || portfolio, color: '#8b5cf6', shape: 'diamond' },
    { key: 'min_var',    name: 'Min Variance',       point: frontier.min_variance, color: '#06b6d4', shape: 'circle'  },
    { key: 'max_sharpe', name: 'Max Sharpe',         point: frontier.max_sharpe,   color: '#f59e0b', shape: 'star'    },
    { key: 'same_ret',   name: 'Same Return',        point: frontier.same_return,  color: '#10b981', shape: 'triangle'},
    { key: 'same_risk',  name: 'Same Risk',          point: frontier.same_risk,    color: '#ec4899', shape: 'square'  },
  ].filter(m => m.point)

  if (benchmark) {
    named.push({
      key: 'benchmark',
      name: BM_NAMES[benchmark.ticker] || benchmark.ticker,
      point: benchmark,
      color: '#64748b',
      shape: 'hexagon',
    })
  }

  if (showCmlLine && cml.same_return) {
    named.push({
      key: 'cml_same_return',
      name: 'CAL Same Return',
      point: cml.same_return,
      color: '#3b82f6',
      shape: 'diamond-outline',
      isCml: true,
    })
  }
  if (showCmlLine && cml.same_risk) {
    named.push({
      key: 'cml_same_risk',
      name: 'CAL Same Risk',
      point: cml.same_risk,
      color: '#ef4444',
      shape: 'cross',
      isCml: true,
    })
  }

  // ── Scales ───────────────────────────────────────────────
  // Axis bounds are driven by ALL plotted key points: Original, Min
  // Variance, Max Sharpe, Same Return, Same Risk, Benchmark, plus CAL
  // points when CAL is visible. The frontier curve itself NEVER
  // influences the bounds — it can extend off-screen, that's intentional.
  // Comparison-frontier curve points are also excluded.
  const keyXs = named.map(m => m.point.annualized_volatility)
  const keyYs = named.map(m => m.point.annualized_return)

  const xMinPt = Math.min(...keyXs)
  const xMaxPt = Math.max(...keyXs)
  const yMinPt = Math.min(...keyYs)
  const yMaxPt = Math.max(...keyYs)

  // Fixed absolute padding around the key-point envelope.
  //   x: ±3%  · y: -2% / +3%
  // xLo is floored at 0 (volatility ≥ 0); when CAL is OFF it can sit above
  // 0 so the chart zooms into the cluster of key points.
  //
  // When CAL is ON, BOTH axes are extended to include the CAL's anchor
  // point (vol=0, ret=rf):
  //   xLo → 0          so the x=0 starting point is visible
  //   yLo → rf − 0.5%  so the rf return is visible
  // This way the CAL line is drawn from its true mathematical origin
  // (0, rf) through the tangency portfolio and beyond.
  const xLo = showCmlLine ? 0 : Math.max(0, xMinPt - 0.03)
  const xHi = xMaxPt + 0.03
  const yLo = showCmlLine
    ? Math.max(0, Math.min(yMinPt - 0.02, cml.intercept - 0.005))
    : Math.max(0, yMinPt - 0.02)
  const yHi = yMaxPt + 0.03

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom

  const sx = (x) => PAD.left + ((x - xLo) / (xHi - xLo)) * plotW
  const sy = (y) => PAD.top + plotH - ((y - yLo) / (yHi - yLo)) * plotH

  const xTicks = niceTicks(xLo, xHi, 6)
  const yTicks = niceTicks(yLo, yHi, 6)

  const path = curvePts
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.x).toFixed(2)} ${sy(p.y).toFixed(2)}`)
    .join(' ')
  const compPath = showComp
    ? compCurvePts
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.x).toFixed(2)} ${sy(p.y).toFixed(2)}`)
        .join(' ')
    : ''

  const mainCurveClass = shortSelling ? 'frontier-line frontier-line-short' : 'frontier-line'
  const cardMeta = shortSelling
    ? `short selling allowed · ${curvePts.length}-point curve`
    : `no short-selling · ${curvePts.length}-point curve`

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="card">
      <div className="card-header">
        <h2>Efficient Frontier ({returnMethod === 'capm' ? 'CAPM' : 'Historical'})</h2>
        <span className="card-meta">{cardMeta}</span>
      </div>

      <div className="frontier-wrap">
        <div className="frontier-toggles">
          {canCompare && (
            <button
              type="button"
              className={`frontier-compare-toggle${showComparison ? ' is-active' : ''}`}
              onClick={() => setShowComparison(v => !v)}
              aria-pressed={showComparison}
            >
              {showComparison ? '✓ ' : ''}Compare with No Short Selling
            </button>
          )}
          {cmlAvailable && (
            <button
              type="button"
              className={`frontier-cml-toggle${showCml ? ' is-active' : ''}`}
              onClick={() => setShowCml(v => !v)}
              aria-pressed={showCml}
              title="Show the Capital Allocation Line — the set of optimal risky/risk-free mixes"
            >
              Show CAL: <strong>{showCml ? 'ON' : 'OFF'}</strong>
            </button>
          )}
        </div>

        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="frontier-chart"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Efficient frontier scatter chart"
        >
          {/* Gridlines */}
          {yTicks.map(y => (
            <line
              key={`gy-${y}`}
              x1={PAD.left}
              x2={W - PAD.right}
              y1={sy(y)}
              y2={sy(y)}
              className="grid-line"
            />
          ))}
          {xTicks.map(x => (
            <line
              key={`gx-${x}`}
              x1={sx(x)}
              x2={sx(x)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              className="grid-line"
            />
          ))}

          {/* Axes */}
          <line
            x1={PAD.left}
            y1={H - PAD.bottom}
            x2={W - PAD.right}
            y2={H - PAD.bottom}
            className="axis-line"
          />
          <line
            x1={PAD.left}
            y1={PAD.top}
            x2={PAD.left}
            y2={H - PAD.bottom}
            className="axis-line"
          />

          {/* Tick labels */}
          {xTicks.map(x => (
            <text
              key={`xt-${x}`}
              x={sx(x)}
              y={H - PAD.bottom + 18}
              className="axis-label"
            >
              {fmtPct(x, 1)}
            </text>
          ))}
          {yTicks.map(y => (
            <text
              key={`yt-${y}`}
              x={PAD.left - 10}
              y={sy(y) + 4}
              className="axis-label-y"
            >
              {fmtPct(y, 1)}
            </text>
          ))}

          {/* Axis titles */}
          <text
            x={PAD.left + plotW / 2}
            y={H - 14}
            className="axis-title"
          >
            Annualized Volatility (risk)
          </text>
          <text
            transform={`translate(20 ${PAD.top + plotH / 2}) rotate(-90)`}
            className="axis-title"
          >
            Annualized Return
          </text>

          {/* Comparison frontier (drawn first so the active one sits on top) */}
          {showComp && <path d={compPath} className="frontier-line-noshort" />}

          {/* Capital Market Line — drawn from its true mathematical
              anchor (vol=0, ret=rf) through the tangency portfolio.
              When CAL is on, xLo is snapped to 0 and yLo extends below
              rf, so this anchor is always visible. The bottom-clipping
              branch is kept only as a defensive guard for edge cases
              with non-standard rf rates. */}
          {showCmlLine && (() => {
            const { slope, intercept } = cml
            // Start at the chart's left edge — which is (0, rf) when CAL is on
            let xS = xLo
            let yS = intercept + slope * xS
            // If the line is below the chart floor at xLo, enter from the bottom
            if (yS < yLo && slope > 0) {
              yS = yLo
              xS = (yLo - intercept) / slope
            }
            // End at the right edge
            let xE = xHi
            let yE = intercept + slope * xE
            // If the line is above the chart ceiling at xHi, exit through the top
            if (yE > yHi && slope > 0) {
              yE = yHi
              xE = (yHi - intercept) / slope
            }
            // Skip if the line never enters the chart at all
            if (xS > xHi || xE < xLo) return null
            return (
              <line
                x1={sx(xS)}
                y1={sy(yS)}
                x2={sx(xE)}
                y2={sy(yE)}
                className="cml-line"
              />
            )
          })()}

          {/* Frontier curve */}
          <path d={path} className={mainCurveClass} />

          {/* CML markers that fall outside the natural plot bounds are
              suppressed on the chart — their values still appear in the
              legend, but the chart stays focused on the frontier curve. */}
          {(() => {
            const inBounds = (p) =>
              p.annualized_volatility >= xLo &&
              p.annualized_volatility <= xHi &&
              p.annualized_return >= yLo &&
              p.annualized_return <= yHi
            const visible = named.filter(m => !m.isCml || inBounds(m.point))
            return (
              <>
                {/* Inactive markers first, active marker last so it draws on top */}
                {visible.filter(m => m.key !== activeKey).map(m => {
                  const x = sx(m.point.annualized_volatility)
                  const y = sy(m.point.annualized_return)
                  return (
                    <g key={m.key} fill={m.color} stroke="white" strokeWidth="2">
                      {markerPath(m.shape, x, y, 9, m.color)}
                      <title>
                        {m.name} · ret {fmtPct(m.point.annualized_return)} · vol {fmtPct(m.point.annualized_volatility)} · Sharpe {fmtSharpe(m.point.sharpe_ratio)}
                      </title>
                    </g>
                  )
                })}
                {visible.filter(m => m.key === activeKey).map(m => {
                  const x = sx(m.point.annualized_volatility)
                  const y = sy(m.point.annualized_return)
                  return (
                    <g key={m.key} className="frontier-marker-active">
                      <circle cx={x} cy={y} r={22} fill={m.color} opacity="0.18" />
                      <circle cx={x} cy={y} r={17} fill="none" stroke={m.color} strokeWidth="2" opacity="0.75" />
                      <g fill={m.color} stroke="white" strokeWidth="2.5">
                        {markerPath(m.shape, x, y, 12, m.color)}
                        <title>
                          {m.name} (active) · ret {fmtPct(m.point.annualized_return)} · vol {fmtPct(m.point.annualized_volatility)} · Sharpe {fmtSharpe(m.point.sharpe_ratio)}
                        </title>
                      </g>
                    </g>
                  )
                })}
              </>
            )
          })()}
        </svg>

        {shortSelling && (
          <div className="frontier-curve-legend">
            <div className="frontier-curve-legend-item">
              <span className="frontier-curve-legend-swatch is-short" aria-hidden="true" />
              Short Selling Frontier
            </div>
            {showComp && (
              <div className="frontier-curve-legend-item">
                <span className="frontier-curve-legend-swatch is-noshort" aria-hidden="true" />
                No Short Selling Frontier
              </div>
            )}
          </div>
        )}

        {/* Legend */}
        <div className="frontier-legend">
          {named.map(m => {
            const isActive = m.key === activeKey
            const canApply =
              typeof onApplyWeights === 'function' &&
              Array.isArray(m.point.weights)
            return (
              <div
                key={m.key}
                className={`legend-item${isActive ? ' active' : ''}${m.isCml ? ' is-cml' : ''}`}
              >
                <MarkerIcon shape={m.shape} color={m.color} />
                <div className="legend-text">
                  <div className="legend-name">
                    {m.name}
                    {isActive && <span className="legend-active-check" aria-label="active"> ✓</span>}
                  </div>
                  <div className="legend-detail">
                    Return {fmtPctSigned(m.point.annualized_return)} ·
                    {' '}Vol {fmtPct(m.point.annualized_volatility)} ·
                    {' '}Sharpe {fmtSharpe(m.point.sharpe_ratio)}{' '}
                    <SharpeBadge value={m.point.sharpe_ratio} />
                  </div>
                  {m.isCml && Number.isFinite(m.point.tangency_fraction) && (
                    <div className="legend-cml-mix">
                      {fmtPct(m.point.tangency_fraction, 1)} tangency
                      {' · '}
                      {fmtPct(m.point.t_bill_weight, 1)} T-bills
                    </div>
                  )}
                  {canApply && (
                    <button
                      type="button"
                      className="apply-weights-btn"
                      onClick={() => onApplyWeights(m.point.weights, m.key, m.point)}
                      disabled={applying || isActive}
                      title={
                        m.key === 'original'
                          ? 'Restore the dollar amounts you originally entered'
                          : m.isCml
                            ? `Set holdings to ${fmtPct(m.point.tangency_fraction, 1)} tangency weights with the rest in T-bills`
                            : `Set holdings to ${m.name} weights`
                      }
                    >
                      {isActive ? 'Active' : 'Apply weights'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
          {showCmlLine && (
            <div className="frontier-cml-note">
              <span className="cml-note-swatch" aria-hidden="true" />
              CAL assumes you can invest in T-bills at the risk-free rate
              {Number.isFinite(cml.intercept) && (
                <span className="cml-note-rate"> ({fmtPct(cml.intercept, 1)})</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
