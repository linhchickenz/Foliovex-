import { useState } from 'react'

const ANALYSIS_MODES = [
  { id: 'no-short', label: 'No Short Selling', available: true },
  { id: 'with-short', label: 'With Short Selling', available: true },
  { id: 'monte-carlo', label: 'Monte Carlo', available: true },
]

const BENCHMARK_PRESETS = [
  { id: 'none', label: 'None', ticker: null },
  { id: 'sp500', label: 'S&P 500', ticker: '^SP500TR' },
  { id: 'tsx', label: 'S&P/TSX', ticker: '^SPTSXCATR' },
  { id: 'tsx60', label: 'TSX 60', ticker: '^TXTY' },
  { id: 'custom', label: 'Custom', ticker: null },
]

function ChevronLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6"/>
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  )
}

function ChartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/>
      <line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6"  y1="20" x2="6"  y2="14"/>
      <line x1="3"  y1="20" x2="21" y2="20"/>
    </svg>
  )
}

function ScaleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="3" x2="12" y2="20"/>
      <line x1="6" y1="20" x2="18" y2="20"/>
      <path d="M5 9 L2 15 a3 3 0 0 0 6 0 Z"/>
      <path d="M19 9 L16 15 a3 3 0 0 0 6 0 Z"/>
      <line x1="5" y1="9" x2="19" y2="9"/>
    </svg>
  )
}

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  )
}

function InfoIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="16" x2="12" y2="12"/>
      <line x1="12" y1="8" x2="12.01" y2="8"/>
    </svg>
  )
}

function fmtPct(decimal) {
  if (decimal === null || decimal === undefined || Number.isNaN(decimal)) return '—'
  return `${(decimal * 100).toFixed(2)}%`
}

export default function Sidebar({
  collapsed,
  onToggleCollapsed,
  analysisMode,
  onAnalysisModeChange,
  benchmark,
  onBenchmarkChange,
  customBenchmark,
  onCustomBenchmarkChange,
  currency,
  onCurrencyChange,
  periodMode,
  onPeriodModeChange,
  liveRiskFreeRate,
  liveRiskFreeRateLoading,
  riskFreeOverride,
  onRiskFreeOverrideChange,
  riskFreeOverrideValue,
  onRiskFreeOverrideValueChange,
  returnMethod,
  onReturnMethodChange,
  riskAversion = 4,
  onRiskAversionChange,
  capmAvailable = true,
  advancedMode = false,
  onAdvancedModeChange,
}) {
  // Section open/close (only relevant when expanded)
  const [openSections, setOpenSections] = useState({
    analysis: true,
    benchmark: true,
    settings: true,
  })

  const toggleSection = (key) =>
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }))

  return (
    <aside className={`sidebar${collapsed ? ' is-collapsed' : ''}`}>
      <div className="sidebar-head">
        <button
          type="button"
          className="sidebar-toggle"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
        </button>
      </div>

      <nav className="sidebar-nav">
        {/* ── Analysis Mode ──────────────────────────────── */}
        <SidebarSection
          icon={<ChartIcon />}
          title="Analysis Mode"
          collapsed={collapsed}
          open={openSections.analysis}
          onToggle={() => toggleSection('analysis')}
        >
          <div className="sidebar-options">
            {ANALYSIS_MODES.map(mode => (
              <label
                key={mode.id}
                className={`sidebar-radio${analysisMode === mode.id ? ' is-active' : ''}`}
              >
                <input
                  type="radio"
                  name="analysis-mode"
                  value={mode.id}
                  checked={analysisMode === mode.id}
                  onChange={() => onAnalysisModeChange(mode.id)}
                />
                <span className="sidebar-radio-dot" aria-hidden="true" />
                <span className="sidebar-radio-label">
                  {mode.label}
                  {!mode.available && (
                    <span className="sidebar-pill">Soon</span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </SidebarSection>

        {/* ── Benchmark Comparison ───────────────────────── */}
        <SidebarSection
          icon={<ScaleIcon />}
          title="Benchmark"
          collapsed={collapsed}
          open={openSections.benchmark}
          onToggle={() => toggleSection('benchmark')}
        >
          <div className="sidebar-field">
            <label className="sidebar-field-label" htmlFor="benchmark-select">
              Compare against
            </label>
            <select
              id="benchmark-select"
              className="sidebar-select"
              value={benchmark}
              onChange={e => onBenchmarkChange(e.target.value)}
            >
              {BENCHMARK_PRESETS.map(b => (
                <option key={b.id} value={b.id}>
                  {b.label}
                  {b.ticker ? ` (${b.ticker})` : ''}
                </option>
              ))}
            </select>
            {benchmark === 'custom' && (
              <input
                type="text"
                className="sidebar-input"
                placeholder="Ticker (e.g. ACWI)"
                value={customBenchmark}
                maxLength={12}
                onChange={e => onCustomBenchmarkChange(e.target.value.toUpperCase())}
                style={{ marginTop: 8 }}
              />
            )}
          </div>
        </SidebarSection>

        {/* ── Settings ───────────────────────────────────── */}
        <SidebarSection
          icon={<GearIcon />}
          title="Settings"
          collapsed={collapsed}
          open={openSections.settings}
          onToggle={() => toggleSection('settings')}
        >
          <div className="sidebar-field">
            <div className="sidebar-field-row">
              <span className="sidebar-field-label">Return Method</span>
              <span
                className="sidebar-info"
                tabIndex={0}
                aria-label="CAPM uses beta-based expected returns. Historical uses past average returns."
              >
                <InfoIcon />
                <span className="sidebar-tooltip" role="tooltip">
                  <strong>CAPM</strong> uses beta-based expected returns derived
                  from the market index.<br />
                  <strong>Historical</strong> uses the sample mean of past
                  returns.
                </span>
              </span>
            </div>
            <div className="sidebar-segmented">
              <button
                type="button"
                className={`sidebar-seg-btn${returnMethod === 'capm' ? ' is-active' : ''}`}
                onClick={() => onReturnMethodChange('capm')}
                disabled={!capmAvailable}
                title={capmAvailable ? 'Capital Asset Pricing Model' : 'CAPM unavailable for this run'}
              >
                CAPM
              </button>
              <button
                type="button"
                className={`sidebar-seg-btn${returnMethod === 'historical' ? ' is-active' : ''}`}
                onClick={() => onReturnMethodChange('historical')}
              >
                Historical
              </button>
            </div>
          </div>

          <div className="sidebar-field">
            <span className="sidebar-field-label">Currency</span>
            <div className="sidebar-segmented">
              <button
                type="button"
                className={`sidebar-seg-btn${currency === 'USD' ? ' is-active' : ''}`}
                onClick={() => onCurrencyChange('USD')}
              >
                USD
              </button>
              <button
                type="button"
                className={`sidebar-seg-btn${currency === 'CAD' ? ' is-active' : ''}`}
                onClick={() => onCurrencyChange('CAD')}
              >
                CAD
              </button>
            </div>
          </div>

          <div className="sidebar-field">
            <span className="sidebar-field-label">Period</span>
            <div className="sidebar-segmented">
              <button
                type="button"
                className={`sidebar-seg-btn${periodMode === 'annual' ? ' is-active' : ''}`}
                onClick={() => onPeriodModeChange('annual')}
              >
                Annual
              </button>
              <button
                type="button"
                className={`sidebar-seg-btn${periodMode === 'monthly' ? ' is-active' : ''}`}
                onClick={() => onPeriodModeChange('monthly')}
              >
                Monthly
              </button>
            </div>
          </div>

          <div className="sidebar-field">
            <div className="sidebar-field-row">
              <span className="sidebar-field-label">Risk Aversion (A)</span>
              <span className="sidebar-ra-badge">{riskAversion}</span>
            </div>
            <input
              type="range"
              className="sidebar-slider"
              min="1"
              max="10"
              step="0.5"
              value={riskAversion}
              onChange={e => onRiskAversionChange && onRiskAversionChange(parseFloat(e.target.value))}
            />
            <div className="sidebar-slider-range">
              <span>1 · aggressive</span>
              <span>conservative · 10</span>
            </div>
          </div>

          <div className="sidebar-field">
            <div className="sidebar-field-row">
              <span className="sidebar-field-label">Risk-free rate</span>
              <label className="sidebar-mini-switch" title="Manual override">
                <input
                  type="checkbox"
                  checked={riskFreeOverride}
                  onChange={e => onRiskFreeOverrideChange(e.target.checked)}
                />
                <span className="sidebar-mini-switch-track">
                  <span className="sidebar-mini-switch-thumb" />
                </span>
              </label>
            </div>
            {riskFreeOverride ? (
              <div className="sidebar-rate-input">
                <input
                  type="number"
                  className="sidebar-input"
                  step="0.01"
                  min="0"
                  max="100"
                  placeholder="4.50"
                  value={riskFreeOverrideValue}
                  onChange={e => onRiskFreeOverrideValueChange(e.target.value)}
                />
                <span className="sidebar-rate-suffix">%</span>
              </div>
            ) : (
              <div className="sidebar-rate-display">
                {liveRiskFreeRateLoading ? (
                  <span className="sidebar-rate-muted">Fetching…</span>
                ) : (
                  <>
                    <span className="sidebar-rate-value">{fmtPct(liveRiskFreeRate)}</span>
                    <span className="sidebar-rate-tag">live</span>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="sidebar-field">
            <div className="sidebar-field-row">
              <span className="sidebar-field-label">Advanced Mode</span>
              <label className="sidebar-mini-switch" title="Show theoretical leverage results">
                <input
                  type="checkbox"
                  checked={advancedMode}
                  onChange={e => onAdvancedModeChange && onAdvancedModeChange(e.target.checked)}
                />
                <span className="sidebar-mini-switch-track">
                  <span className="sidebar-mini-switch-thumb" />
                </span>
              </label>
            </div>
            <p className="sidebar-field-note">Shows theoretical results including leverage assumptions.</p>
          </div>
        </SidebarSection>
      </nav>
    </aside>
  )
}

function SidebarSection({ icon, title, collapsed, open, onToggle, children }) {
  if (collapsed) {
    return (
      <div className="sidebar-section is-collapsed" title={title}>
        <div className="sidebar-section-icon" aria-label={title}>{icon}</div>
      </div>
    )
  }
  return (
    <div className={`sidebar-section${open ? '' : ' is-closed'}`}>
      <button
        type="button"
        className="sidebar-section-head"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="sidebar-section-icon">{icon}</span>
        <span className="sidebar-section-title">{title}</span>
        <span className="sidebar-section-chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && <div className="sidebar-section-body">{children}</div>}
    </div>
  )
}
