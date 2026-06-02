import { fmtCurrency, fmtDollarReturn, fmtPct, fmtPctSigned, fmtSharpe, sharpeRating } from '../utils/format'
import SharpeBadge from './SharpeBadge'

export default function PortfolioSummary({ results, periodMode, returnMethod = 'capm', riskAversion = 4, advancedMode = false }) {
  const p = results.portfolio
  const c = results.currency
  const isMonthly = periodMode === 'monthly'
  const isCapm = returnMethod === 'capm'

  const retValue  = isMonthly ? p.expected_monthly_return : p.annualized_return
  const retLabel = isMonthly
    ? 'Expected Monthly Return'
    : `Expected Annual Return${isCapm ? ' (CAPM)' : ' (Historical)'}`
  const retDollar = fmtDollarReturn(results.total_investment, retValue, c)

  const volValue  = isMonthly ? p.monthly_volatility : p.annualized_volatility
  const volLabel  = isMonthly ? 'Monthly Volatility' : 'Annual Volatility'

  const hasRiskDecomp = isCapm && !isMonthly && Number.isFinite(p.portfolio_beta)

  // U = E(r) - ½ × A × σ²  (Markowitz mean-variance utility)
  const utilityScore = retValue - 0.5 * riskAversion * volValue * volValue
  const aLabel = Number.isInteger(riskAversion) ? String(riskAversion) : String(riskAversion)

  // y* = [E(Rp) - Rf] / (A × σp²) — Markowitz optimal risky-asset allocation.
  // Always uses annualized figures regardless of periodMode for consistency.
  const annReturn = p.annualized_return
  const annVol    = p.annualized_volatility
  const rfAnnual  = results.risk_free_rate
  const yStar = (Number.isFinite(annReturn) && Number.isFinite(annVol) && annVol > 0)
    ? (annReturn - rfAnnual) / (riskAversion * annVol * annVol)
    : null

  return (
    <div className="card">
      <div className="card-header">
        <h2>Portfolio Summary</h2>
        <span className="card-meta">
          {results.n_months} months · {isCapm ? 'CAPM' : 'Historical'} · risk-free {fmtPct(results.risk_free_rate)} ({results.risk_free_rate_source})
        </span>
      </div>

      <div className="stat-grid">
        <Stat
          label="Total Investment"
          value={fmtCurrency(results.total_investment, c)}
          accent="purple"
        />
        <Stat
          label={retLabel}
          value={fmtPctSigned(retValue)}
          subValue={retDollar}
          accent={retValue >= 0 ? 'green' : 'red'}
        />
        <Stat
          label={volLabel}
          value={fmtPct(volValue)}
          accent="blue"
        />
        <Stat
          label="Sharpe Ratio"
          value={fmtSharpe(p.sharpe_ratio)}
          badge={<SharpeBadge value={p.sharpe_ratio} />}
          accent="gold"
          valueClass={sharpeRating(p.sharpe_ratio)?.tier ? `sharpe-number-${sharpeRating(p.sharpe_ratio).tier}` : null}
        />
        <Stat
          label={`Utility Score (A=${aLabel})`}
          value={utilityScore.toFixed(4)}
          accent="teal"
        />
      </div>

      {hasRiskDecomp && (
        <div className="risk-decomp">
          <div className="risk-decomp-title">Risk Decomposition</div>
          <div className="risk-decomp-grid">
            <RiskStat
              label="Portfolio Beta"
              value={p.portfolio_beta.toFixed(2)}
              note="sensitivity to market movements"
            />
            <RiskStat
              label="Systematic Risk"
              value={fmtPct(p.systematic_risk)}
              note="market risk · cannot be diversified away"
            />
            <RiskStat
              label="Specific Risk"
              value={fmtPct(p.specific_risk)}
              note="company risk · reduced by diversifying"
            />
            <RiskStat
              label="Total Volatility"
              value={fmtPct(p.annualized_volatility)}
              note="annualized standard deviation"
            />
          </div>
        </div>
      )}

      {Number.isFinite(yStar) && (
        <div className="optimal-alloc">
          <div className="optimal-alloc-head">
            <span className="optimal-alloc-title">Optimal Allocation</span>
            <span className="optimal-alloc-ystar">y* = {(yStar * 100).toFixed(1)}%</span>
          </div>
          <div className="optimal-alloc-msg">
            <OptimalAllocMsg yStar={yStar} riskAversion={riskAversion} advancedMode={advancedMode} />
          </div>
        </div>
      )}

      {results.warnings && results.warnings.length > 0 && (
        <div className="warning-msg">
          {results.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, accent, subValue, badge, valueClass }) {
  return (
    <div className={`stat stat-${accent}`}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value${valueClass ? ' ' + valueClass : ''}`}>{value}</div>
      {badge}
      {subValue != null && <div className="stat-dollar">{subValue}</div>}
    </div>
  )
}

function RiskStat({ label, value, note }) {
  return (
    <div className="risk-decomp-item">
      <div className="risk-decomp-label">{label}</div>
      <div className="risk-decomp-value">{value}</div>
      {note && <div className="risk-decomp-note">{note}</div>}
    </div>
  )
}

function OptimalAllocMsg({ yStar, riskAversion, advancedMode }) {
  if (!advancedMode) {
    const cappedY = Math.max(0, Math.min(yStar, 1))
    if (cappedY <= 0) {
      return <span>Invest 0% — keep 100% in T-bills / cash.</span>
    }
    if (cappedY >= 1) {
      return <span>Invest 100% in your portfolio.</span>
    }
    return (
      <span>
        Invest <strong>{(cappedY * 100).toFixed(1)}%</strong> in your portfolio, keep{' '}
        <strong>{((1 - cappedY) * 100).toFixed(1)}%</strong> in cash / T-bills.
      </span>
    )
  }

  if (yStar < 0) {
    return (
      <span className="alloc-warn">
        ⚠ Portfolio expected return is below the risk-free rate at A={riskAversion} — not worth investing in at this risk aversion level.
      </span>
    )
  }
  if (yStar <= 1) {
    return (
      <span>
        Invest <strong>{(yStar * 100).toFixed(1)}%</strong> in your portfolio, keep{' '}
        <strong>{((1 - yStar) * 100).toFixed(1)}%</strong> in cash / T-bills.
      </span>
    )
  }
  return (
    <span>
      <span className="alloc-leverage">
        Invest <strong>{(yStar * 100).toFixed(1)}%</strong> in your portfolio
      </span>
      {' '}— requires borrowing{' '}
      <strong>{((yStar - 1) * 100).toFixed(1)}%</strong> at R<sub>f</sub>{' '}
      <span className="alloc-theoretical">(theoretical)</span>.
    </span>
  )
}
