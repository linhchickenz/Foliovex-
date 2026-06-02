import { fmtCurrency, fmtDollarReturn, fmtPct, fmtPctSigned, fmtSharpe, sharpeRating } from '../utils/format'
import SharpeBadge from './SharpeBadge'

const AVATAR_PALETTE = [
  '#4F46E5', '#10b981', '#f59e0b', '#ef4444', '#3b82f6',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#06b6d4',
  '#84cc16', '#6366f1', '#a855f7', '#22c55e', '#fb923c',
]

function tickerColor(ticker) {
  let hash = 0
  for (const c of ticker) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length]
}

function TickerAvatar({ ticker }) {
  // Split on both '.' and '-' so "FCR-UN.TO" → "FCR", "BRK.B" → "BRK", "AAPL" → "AAPL"
  const base = ticker.split(/[.\-]/)[0].slice(0, 4)
  // Scale font down for longer abbreviations so text never clips the circle
  const fontSize =
    base.length <= 2 ? '0.72rem' :
    base.length === 3 ? '0.60rem' :
    '0.50rem'  // 4 chars
  return (
    <span
      className="ticker-avatar"
      style={{ background: tickerColor(ticker), fontSize }}
      title={ticker}
    >
      {base}
    </span>
  )
}

export default function PerStockCards({ results, periodMode, returnMethod = 'capm' }) {
  const tickers  = results.tickers
  const per      = results.per_stock
  const weights  = results.portfolio.weights
  const amounts  = results.amounts
  const currency = results.currency
  const isMonthly = periodMode === 'monthly'
  const isCapm = returnMethod === 'capm'
  const rf = results.risk_free_rate || 0

  return (
    <div className="card">
      <div className="card-header">
        <h2>Individual Stock Performance</h2>
        <span className="card-meta">
          {tickers.length} holdings · {isCapm ? 'CAPM' : 'Historical'}
        </span>
      </div>

      <div className="stock-grid">
        {tickers.map((t, i) => {
          const m = per[t]
          if (!m) return null

          // CAPM mode: swap the annual return for the CAPM expected return,
          // and recompute Sharpe with that return. Monthly view always uses
          // historical (CAPM is annual-only).
          const useCapmForReturn = isCapm && Number.isFinite(m.capm_return) && !isMonthly
          const annualReturn = useCapmForReturn ? m.capm_return : m.annualized_return
          const retValue = isMonthly ? m.expected_monthly_return : annualReturn
          const retLabel = isMonthly
            ? 'Monthly Return'
            : `Annual Return${isCapm ? ' (CAPM)' : ''}`
          const retDollar = fmtDollarReturn(amounts[i], retValue, currency)
          const volValue  = isMonthly ? m.monthly_volatility : m.annualized_volatility
          const volLabel  = isMonthly ? 'Monthly Volatility' : 'Annual Volatility'

          // Sharpe: recompute in CAPM mode using the CAPM return; in Historical
          // mode keep the backend value (per-stock window may differ from common).
          const sharpe = useCapmForReturn && m.annualized_volatility > 0
            ? (m.capm_return - rf) / m.annualized_volatility
            : m.sharpe_ratio
          const showBeta = isCapm && Number.isFinite(m.beta)
          const showSpecificRisk = isCapm && Number.isFinite(m.specific_risk)
          const showAlpha = isCapm && Number.isFinite(m.alpha)

          return (
            <div key={t} className="stock-card">
              <div className="stock-card-header">
                <div className="stock-card-ticker-wrap">
                  <TickerAvatar ticker={t} />
                  {/* stock-card-info is a separate wrapper so the overflow
                      truncation on stock-card-ticker never swallows the
                      currency badge — they live on different lines */}
                  <div className="stock-card-info">
                    <div className="stock-card-ticker" title={t}>{t}</div>
                    <div className="stock-card-amount">
                      <span>{fmtCurrency(amounts[i], currency, 2)}</span>
                      <span className="stock-card-currency-badge">{currency}</span>
                    </div>
                  </div>
                </div>
                <span className="stock-card-weight">
                  {(weights[i] * 100).toFixed(1)}%
                </span>
              </div>

              <div className="stock-card-metrics">
                <Metric
                  label={retLabel}
                  value={fmtPctSigned(retValue)}
                  subValue={retDollar}
                  tone={amounts[i] < 0
                    ? (retValue >= 0 ? 'negative' : 'positive')
                    : (retValue >= 0 ? 'positive' : 'negative')}
                  subTone={amounts[i] < 0 ? 'negative' : null}
                />
                <Metric
                  label={volLabel}
                  value={fmtPct(volValue)}
                />
                <Metric
                  label="Sharpe Ratio"
                  value={fmtSharpe(sharpe)}
                  badge={<SharpeBadge value={sharpe} />}
                  sharpeTier={sharpeRating(sharpe)?.tier}
                />
                {showBeta && (
                  <Metric
                    label="Beta"
                    value={m.beta.toFixed(2)}
                  />
                )}
                {showSpecificRisk && (
                  <Metric
                    label="Specific Risk"
                    value={fmtPct(m.specific_risk)}
                  />
                )}
                {showAlpha && (
                  <Metric
                    label="Jensen's Alpha"
                    value={fmtPctSigned(m.alpha)}
                    tone={m.alpha >= 0 ? 'positive' : 'negative'}
                  />
                )}
                <Metric
                  label="Months of data"
                  value={m.n_months}
                  muted
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Metric({ label, value, tone, muted, subValue, subTone, badge, sharpeTier }) {
  const cls =
    'metric-value' +
    (sharpeTier ? ' sharpe-number-' + sharpeTier : tone ? ' metric-value-' + tone : '') +
    (muted ? ' metric-value-muted'   : '')

  const subCls = 'metric-dollar' + (subTone ? ' metric-value-' + subTone : '')

  const hasGroup = subValue != null || badge != null
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      {hasGroup ? (
        <span className="metric-value-group">
          <span className={cls}>{value}</span>
          {badge}
          {subValue != null && <span className={subCls}>{subValue}</span>}
        </span>
      ) : (
        <span className={cls}>{value}</span>
      )}
    </div>
  )
}
