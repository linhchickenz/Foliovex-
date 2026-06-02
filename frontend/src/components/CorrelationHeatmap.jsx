/**
 * N×N correlation heatmap with a red→white→green diverging scale.
 * Cell intensity comes from |c|: c=±1 saturated, c=0 white.
 */

function corrColor(c) {
  if (c == null || isNaN(c)) return 'hsl(0, 0%, 95%)'
  const hue = c >= 0 ? 142 : 0          // green vs red
  const lightness = 100 - Math.abs(c) * 50  // 100 at c=0, 50 at |c|=1
  return `hsl(${hue}, 65%, ${lightness}%)`
}

function corrTextColor(c) {
  if (c == null || isNaN(c)) return '#475569'
  const lightness = 100 - Math.abs(c) * 50
  return lightness > 70 ? '#0f172a' : '#ffffff'
}

export default function CorrelationHeatmap({ correlation }) {
  if (!correlation || !correlation.tickers || correlation.tickers.length === 0) {
    return null
  }

  const { tickers, matrix } = correlation
  const n = tickers.length

  return (
    <div className="card">
      <div className="card-header">
        <h2>Correlation Matrix</h2>
        <span className="card-meta">based on aligned monthly returns</span>
      </div>

      <div className="heatmap-wrap">
        <div
          className="heatmap-grid"
          style={{ gridTemplateColumns: `80px repeat(${n}, minmax(64px, 1fr))` }}
        >
          {/* corner */}
          <div className="heatmap-cell heatmap-corner" />
          {/* top row of ticker labels */}
          {tickers.map(t => (
            <div key={`top-${t}`} className="heatmap-cell heatmap-label heatmap-label-top">
              {t}
            </div>
          ))}

          {/* rows */}
          {tickers.map((row, i) => (
            <Row
              key={`row-${row}`}
              row={row}
              i={i}
              matrix={matrix}
              tickers={tickers}
            />
          ))}
        </div>
      </div>

      <div className="heatmap-scale">
        <span className="heatmap-scale-label">−1.0</span>
        <div className="heatmap-scale-bar" />
        <span className="heatmap-scale-label">0.0</span>
        <div className="heatmap-scale-bar heatmap-scale-bar-right" />
        <span className="heatmap-scale-label">+1.0</span>
      </div>
    </div>
  )
}

function Row({ row, i, matrix, tickers }) {
  return (
    <>
      <div className="heatmap-cell heatmap-label heatmap-label-side">{row}</div>
      {tickers.map((col, j) => {
        const v = matrix[i] && matrix[i][j]
        return (
          <div
            key={`${row}-${col}`}
            className="heatmap-cell heatmap-value"
            style={{
              background: corrColor(v),
              color: corrTextColor(v),
            }}
          >
            {(v ?? 0).toFixed(2)}
          </div>
        )
      })}
    </>
  )
}
