import { fmtPct, fmtPctSigned, fmtSharpe } from '../utils/format'
import SharpeBadge from './SharpeBadge'

const BM_NAMES = { '^SP500TR': 'S&P 500', '^SPTSXCATR': 'S&P/TSX', '^TXTY': 'TSX 60', '^SPTSE60': 'TSX 60', 'XIU.TO': 'TSX 60' }

export default function BenchmarkCard({ results, periodMode }) {
  const bm = results.benchmark
  if (!bm) return null

  const p = results.portfolio
  const isMonthly = periodMode === 'monthly'

  const portRet = isMonthly ? p.expected_monthly_return : p.annualized_return
  const portVol = isMonthly ? p.monthly_volatility      : p.annualized_volatility
  const bmRet   = isMonthly ? bm.expected_monthly_return : bm.annualized_return
  const bmVol   = isMonthly ? bm.monthly_volatility      : bm.annualized_volatility

  const retWin    = portRet > bmRet
  const volWin    = portVol < bmVol   // lower volatility is better
  const sharpeWin = p.sharpe_ratio > bm.sharpe_ratio

  const bmName   = BM_NAMES[bm.ticker] || bm.ticker
  const retLabel = isMonthly ? 'Monthly Return'    : 'Annual Return'
  const volLabel = isMonthly ? 'Monthly Volatility' : 'Annual Volatility'

  return (
    <div className="card">
      <div className="card-header">
        <h2>Benchmark Comparison</h2>
        <span className="card-meta">{bmName} · {bm.n_months} months overlap</span>
      </div>

      <div className="bm-table">
        <div className="bm-header-row">
          <div className="bm-metric-col" />
          <div className="bm-head-col">Your Portfolio</div>
          <div className="bm-head-col">{bmName}</div>
        </div>

        <Row
          label={retLabel}
          portVal={fmtPctSigned(portRet)}
          bmVal={fmtPctSigned(bmRet)}
          portWins={retWin}
        />
        <Row
          label={volLabel}
          note="lower is better"
          portVal={fmtPct(portVol)}
          bmVal={fmtPct(bmVol)}
          portWins={volWin}
        />
        <Row
          label="Sharpe Ratio"
          portVal={<>{fmtSharpe(p.sharpe_ratio)} <SharpeBadge value={p.sharpe_ratio} /></>}
          bmVal={<>{fmtSharpe(bm.sharpe_ratio)} <SharpeBadge value={bm.sharpe_ratio} /></>}
          portWins={sharpeWin}
        />
      </div>
    </div>
  )
}

function Row({ label, note, portVal, bmVal, portWins }) {
  return (
    <div className="bm-row">
      <div className="bm-metric-col">
        {label}
        {note && <span className="bm-note">{note}</span>}
      </div>
      <div className={`bm-val-col ${portWins ? 'bm-val-win' : 'bm-val-lose'}`}>{portVal}</div>
      <div className={`bm-val-col ${portWins ? 'bm-val-lose' : 'bm-val-win'}`}>{bmVal}</div>
    </div>
  )
}
