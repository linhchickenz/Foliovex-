/**
 * Cumulative performance line chart — hand-rolled SVG.
 * Both portfolio and benchmark start at $100.
 */

const W = 800
const H = 360
const PAD = { top: 24, right: 28, bottom: 56, left: 70 }

const BM_NAMES = { '^SP500TR': 'S&P 500', '^SPTSXCATR': 'S&P/TSX' }

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

function buildCumulative(monthlyReturns) {
  const cum = [100]
  for (const r of monthlyReturns) cum.push(cum[cum.length - 1] * (1 + r))
  return cum
}

export default function CumulativePerformanceChart({ dates, portfolioReturns, benchmark }) {
  if (!dates || !portfolioReturns || !benchmark || portfolioReturns.length === 0) return null

  const portCum  = buildCumulative(portfolioReturns)
  const benchCum = buildCumulative(benchmark.monthly_returns)
  const n = portfolioReturns.length

  const allVals = [...portCum, ...benchCum]
  const rawMin = Math.min(...allVals)
  const rawMax = Math.max(...allVals)
  const yPad = (rawMax - rawMin) * 0.08 || 5
  const yLo = Math.max(0, rawMin - yPad)
  const yHi = rawMax + yPad

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom

  const sx = (i) => PAD.left + (i / Math.max(n, 1)) * plotW
  const sy = (v) => PAD.top + plotH - ((v - yLo) / (yHi - yLo)) * plotH

  const portPath  = portCum.map((v, i)  => `${i === 0 ? 'M' : 'L'} ${sx(i).toFixed(1)} ${sy(v).toFixed(1)}`).join(' ')
  const benchPath = benchCum.map((v, i) => `${i === 0 ? 'M' : 'L'} ${sx(i).toFixed(1)} ${sy(v).toFixed(1)}`).join(' ')

  const yTicks = niceTicks(yLo, yHi, 5)

  // Label each January in the dates array
  const xTicks = []
  for (let i = 0; i < dates.length; i++) {
    if (dates[i].slice(5, 7) === '01') {
      xTicks.push({ xPos: i + 1, label: dates[i].slice(0, 4) })
    }
  }

  const bmName    = BM_NAMES[benchmark.ticker] || benchmark.ticker
  const portFinal = portCum[portCum.length - 1]
  const benchFinal = benchCum[benchCum.length - 1]

  return (
    <div className="card">
      <div className="card-header">
        <h2>Cumulative Performance</h2>
        <span className="card-meta">$100 invested · {n} months</span>
      </div>

      <div className="frontier-wrap">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="frontier-chart"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Cumulative performance line chart"
        >
          {/* Y gridlines */}
          {yTicks.map(y => (
            <line key={`gy-${y}`}
              x1={PAD.left} x2={W - PAD.right}
              y1={sy(y)}    y2={sy(y)}
              className="grid-line"
            />
          ))}
          {/* X gridlines at year ticks */}
          {xTicks.map(({ xPos }) => (
            <line key={`gx-${xPos}`}
              x1={sx(xPos)} x2={sx(xPos)}
              y1={PAD.top}  y2={H - PAD.bottom}
              className="grid-line"
            />
          ))}

          {/* Axes */}
          <line x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom} className="axis-line" />
          <line x1={PAD.left} y1={PAD.top}         x2={PAD.left}      y2={H - PAD.bottom} className="axis-line" />

          {/* Y tick labels */}
          {yTicks.map(y => (
            <text key={`yt-${y}`} x={PAD.left - 10} y={sy(y) + 4} className="axis-label-y">
              ${y.toFixed(0)}
            </text>
          ))}

          {/* X tick labels */}
          {xTicks.map(({ xPos, label }) => (
            <text key={`xt-${xPos}`} x={sx(xPos)} y={H - PAD.bottom + 18} className="axis-label">
              {label}
            </text>
          ))}

          {/* Axis titles */}
          <text x={PAD.left + plotW / 2} y={H - 14} className="axis-title">Date</text>
          <text transform={`translate(18 ${PAD.top + plotH / 2}) rotate(-90)`} className="axis-title">
            Value ($)
          </text>

          {/* Benchmark line (behind portfolio) */}
          <path d={benchPath} fill="none" stroke="#94a3b8" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />

          {/* Portfolio line */}
          <path d={portPath} fill="none" stroke="#8b5cf6" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>

        {/* Legend */}
        <div className="cumulative-legend">
          <div className="cumulative-legend-item">
            <div className="cumulative-legend-swatch" style={{ background: '#8b5cf6' }} />
            <span className="cumulative-legend-name">Your Portfolio</span>
            <span className="cumulative-legend-val">${portFinal.toFixed(0)}</span>
          </div>
          <div className="cumulative-legend-item">
            <div className="cumulative-legend-swatch" style={{ background: '#94a3b8' }} />
            <span className="cumulative-legend-name">{bmName}</span>
            <span className="cumulative-legend-val">${benchFinal.toFixed(0)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
