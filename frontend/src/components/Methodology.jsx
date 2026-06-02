// Quick helpers for inline math: italic variables, subs/sups, common symbols.
const V = ({ children }) => <em className="math-var">{children}</em>
const Frac = ({ num, den }) => (
  <span className="math-frac">
    <span className="math-frac-num">{num}</span>
    <span className="math-frac-bar" />
    <span className="math-frac-den">{den}</span>
  </span>
)

function Section({ n, title, formula, children }) {
  return (
    <section className="method-card">
      <header className="method-card-head">
        <span className="method-num">{n}</span>
        <h3 className="method-title">{title}</h3>
      </header>
      <div className="method-formula">{formula}</div>
      <div className="method-desc">{children}</div>
    </section>
  )
}

export default function Methodology() {
  return (
    <div className="methodology">
      <div className="methodology-intro card">
        <h2>Methodology</h2>
        <p>
          Most concepts presented here are based on FIN5525 – Théorie de
          Portefeuille, a portfolio theory class taken at UQAM's École des
          Sciences de la Gestion (ESG).
        </p>
      </div>

      <Section
        n={1}
        title="Efficient Frontier (Markowitz)"
        formula={
          <>
            <div className="math-line">
              <span className="math-op">min</span>
              <sub className="math-op-sub"><V>w</V></sub>
              &nbsp;<V>w</V><sup>⊤</sup>Σ<V>w</V>
              &nbsp;&nbsp;<span className="math-sep">subject to</span>&nbsp;
              <V>w</V><sup>⊤</sup>μ = <V>R</V><sup>*</sup>,&nbsp;
              <V>w</V><sup>⊤</sup><strong>1</strong> = 1,&nbsp;
              <V>w</V> ≥ 0
            </div>
            <div className="math-line math-line-sub">
              Minimum-variance portfolio:&nbsp;
              <span className="math-op">argmin</span>
              <sub className="math-op-sub"><V>w</V></sub>
              &nbsp;<V>w</V><sup>⊤</sup>Σ<V>w</V>
            </div>
          </>
        }
      >
        <p>
          Mean-variance optimization finds the portfolio with the lowest variance
          for each target expected return, where <V>w</V> are the asset weights,
          μ is the vector of expected returns, and Σ is the covariance matrix.
          The full set of solutions traces out the efficient frontier; this app
          constrains <V>w</V> ≥ 0 (no short selling) by default. The leftmost
          point on the frontier is the minimum-variance portfolio.
        </p>
      </Section>

      <Section
        n={2}
        title="Capital Allocation Line (CAL)"
        formula={
          <>
            <div className="math-line">
              <V>E</V>(<V>R</V><sub>c</sub>) = <V>R</V><sub>f</sub> +&nbsp;
              <Frac
                num={<><V>E</V>(<V>R</V><sub>p</sub>) − <V>R</V><sub>f</sub></>}
                den={<>σ<sub>p</sub></>}
              />
              &nbsp;· σ<sub>c</sub>
            </div>
            <div className="math-line math-line-sub">
              Slope =&nbsp;
              <Frac
                num={<><V>E</V>(<V>R</V><sub>p</sub>) − <V>R</V><sub>f</sub></>}
                den={<>σ<sub>p</sub></>}
              />
              &nbsp;= Sharpe ratio
            </div>
          </>
        }
      >
        <p>
          The CAL plots every combination of the risk-free asset and a chosen
          risky portfolio <V>p</V>, with <V>c</V> denoting the combined position.
          Its slope is the Sharpe ratio of <V>p</V>, so the steepest CAL —
          the one tangent to the efficient frontier — identifies the
          tangency portfolio, the risky mix with the highest possible Sharpe.
        </p>
      </Section>

      <Section
        n={3}
        title="Capital Asset Pricing Model (CAPM)"
        formula={
          <div className="math-line">
            <V>E</V>(<V>R</V><sub>i</sub>) = <V>R</V><sub>f</sub> +&nbsp;
            <V>β</V><sub>i</sub> (<V>R</V><sub>m</sub> − <V>R</V><sub>f</sub>)
          </div>
        }
      >
        <p>
          CAPM says an asset's expected return equals the risk-free rate plus a
          risk premium that scales with its beta to the market. Only systematic
          (non-diversifiable) risk is rewarded; idiosyncratic risk earns no
          premium because investors can diversify it away. The term
          (<V>R</V><sub>m</sub> − <V>R</V><sub>f</sub>) is the market risk
          premium.
        </p>
        <p className="method-note">
          <strong>Note on <V>R</V><sub>f</sub>:</strong> The risk-free rate is
          fetched live — from the Bank of Canada API when the currency is set
          to CAD, and from the US Treasury API when set to USD. A manual
          override is available in the sidebar settings.
        </p>
      </Section>

      <Section
        n={4}
        title="Beta"
        formula={
          <>
            <div className="math-line">
              <V>β</V><sub>i</sub> =&nbsp;
              <Frac
                num={<>Cov(<V>R</V><sub>i</sub>, <V>R</V><sub>m</sub>)</>}
                den={<>Var(<V>R</V><sub>m</sub>)</>}
              />
            </div>
            <div className="math-line math-line-sub">
              From the regression&nbsp;
              <V>R</V><sub>i</sub> = <V>α</V><sub>i</sub> +&nbsp;
              <V>β</V><sub>i</sub> <V>R</V><sub>m</sub> + <V>ε</V><sub>i</sub>
            </div>
          </>
        }
      >
        <p>
          Beta measures how much an asset moves with the market. β = 1 tracks
          the index, β &gt; 1 is more volatile than the market, β &lt; 1 is
          less. It is estimated as the slope of a linear regression of the
          asset's returns on the chosen market index over the observation window.
        </p>
      </Section>

      <Section
        n={5}
        title="Jensen's Alpha"
        formula={
          <div className="math-line">
            <V>α</V><sub>i</sub> = <V>R</V><sub>i</sub> −&nbsp;
            [ <V>R</V><sub>f</sub> +&nbsp;
            <V>β</V><sub>i</sub> (<V>R</V><sub>m</sub> − <V>R</V><sub>f</sub>) ]
          </div>
        }
      >
        <p>
          Alpha is the portion of an asset's return left unexplained by CAPM
          after adjusting for the systematic risk it bore. Positive alpha
          indicates risk-adjusted outperformance; negative alpha indicates the
          return did not compensate for the beta exposure taken.
        </p>
      </Section>

      <Section
        n={6}
        title="Sharpe Ratio"
        formula={
          <div className="math-line">
            Sharpe =&nbsp;
            <Frac
              num={<><V>R</V><sub>p</sub> − <V>R</V><sub>f</sub></>}
              den={<>σ<sub>p</sub></>}
            />
          </div>
        }
      >
        <p>
          The Sharpe ratio measures excess return per unit of total volatility,
          giving a clean risk-adjusted comparison across portfolios. Higher is
          better — a Sharpe of 1 means the portfolio earns one unit of excess
          return for each unit of risk taken.
        </p>
      </Section>

      <Section
        n={7}
        title="Treynor Ratio"
        formula={
          <div className="math-line">
            Treynor =&nbsp;
            <Frac
              num={<><V>R</V><sub>p</sub> − <V>R</V><sub>f</sub></>}
              den={<><V>β</V><sub>p</sub></>}
            />
          </div>
        }
      >
        <p>
          Treynor scales excess return by systematic risk (beta) instead of
          total volatility. Because it ignores idiosyncratic risk, it is most
          meaningful for well-diversified portfolios where specific risk has
          already been largely diversified away.
        </p>
      </Section>

      <Section
        n={8}
        title="Mean-Variance Utility"
        formula={
          <div className="math-line">
            <V>U</V> = <V>E</V>(<V>r</V>) − ½ <V>A</V> σ<sup>2</sup>
          </div>
        }
      >
        <p>
          A standard quadratic utility used in portfolio choice, where <V>A</V> is
          the investor's coefficient of risk aversion. The ½ <V>A</V> σ<sup>2</sup>{' '}
          term penalizes variance, so larger <V>A</V> produces more
          conservative portfolios. Maximising <V>U</V> picks the point on the
          CAL that best matches the investor's risk tolerance.
        </p>
      </Section>

      <Section
        n={9}
        title="Optimal Risky Allocation (y*)"
        formula={
          <div className="math-line">
            <V>y</V><sup>*</sup> =&nbsp;
            <Frac
              num={<><V>E</V>(<V>R</V><sub>p</sub>) − <V>R</V><sub>f</sub></>}
              den={<><V>A</V> σ<sub>p</sub><sup>2</sup></>}
            />
          </div>
        }
      >
        <p>
          Derived from maximising mean-variance utility, <V>y</V><sup>*</sup> is
          the fraction of wealth to place in the risky portfolio along the CAL;
          the remainder (1 − <V>y</V><sup>*</sup>) sits in the risk-free asset.
          A value above 1 implies borrowing at the risk-free rate (leverage),
          while a value below 1 implies holding T-bills alongside the risky
          portfolio.
        </p>
      </Section>

      <Section
        n={10}
        title="Systematic vs Specific Risk"
        formula={
          <>
            <div className="math-line">
              σ<sub>total</sub><sup>2</sup> =&nbsp;
              σ<sub>systematic</sub><sup>2</sup> +&nbsp;
              σ<sub>specific</sub><sup>2</sup>
            </div>
            <div className="math-line math-line-sub">
              σ<sub>systematic</sub><sup>2</sup> =&nbsp;
              <V>β</V><sub>p</sub><sup>2</sup> σ<sub>m</sub><sup>2</sup>,
              &nbsp;&nbsp;
              σ<sub>specific</sub><sup>2</sup> =&nbsp;
              σ<sub>total</sub><sup>2</sup> − σ<sub>systematic</sub><sup>2</sup>
            </div>
          </>
        }
      >
        <p>
          Total portfolio variance decomposes into a systematic component
          driven by market moves and a specific component unique to the assets
          held. Diversification across uncorrelated holdings shrinks specific
          risk toward zero, but systematic risk persists no matter how many
          stocks are added.
        </p>
      </Section>

      <Section
        n={11}
        title="Monte Carlo Simulation"
        formula={
          <>
            <div className="math-line">
              <V>r</V><sub>t</sub> ~ 𝒩(μ, Σ),&nbsp;
              <V>V</V><sub>T</sub> = <V>V</V><sub>0</sub> ·&nbsp;
              <span className="math-prod">∏</span><sub className="math-prod-sub">t=1</sub><sup className="math-prod-sup">T</sup>
              &nbsp;(1 + <V>w</V><sup>⊤</sup><V>r</V><sub>t</sub>)
            </div>
            <div className="math-line math-line-sub">
              Confidence interval: [percentile<sub>α/2</sub>(<V>V</V><sub>T</sub>),&nbsp;
              percentile<sub>1−α/2</sub>(<V>V</V><sub>T</sub>)]
            </div>
          </>
        }
      >
        <p>
          Monte Carlo draws thousands of synthetic monthly return paths from a
          multivariate normal distribution fit to the historical mean vector μ
          and covariance matrix Σ. Each path compounds into a terminal wealth
          <V>V</V><sub>T</sub>; summarising the distribution across paths gives
          confidence intervals (typically 5% / 50% / 95%) for terminal value,
          drawdowns, and probability of meeting a target.
        </p>
      </Section>

      <Section
        n={12}
        title="Value at Risk (VaR)"
        formula={
          <>
            <div className="math-line">
              <span className="math-label">Parametric:</span>&nbsp;
              VaR<sub>α</sub> = −( μ<sub>p</sub> +&nbsp;
              <V>z</V><sub>α</sub> σ<sub>p</sub> ) · <V>V</V><sub>0</sub>
            </div>
            <div className="math-line math-line-sub">
              <span className="math-label">Monte Carlo:</span>&nbsp;
              VaR<sub>α</sub> = −percentile<sub>α</sub>(<V>r</V><sub>sim</sub>) · <V>V</V><sub>0</sub>
            </div>
          </>
        }
      >
        <p>
          VaR is the worst expected loss over a chosen horizon at a confidence
          level (1 − α) — for example, the 5% VaR is the loss that will be
          exceeded only 5% of the time. The parametric method assumes returns
          are normally distributed and uses a Z-score; the Monte Carlo method
          reads the percentile directly from simulated outcomes, so it captures
          non-normal effects when the underlying distribution is not Gaussian.
        </p>
      </Section>

      <div className="methodology-footer">
        <p>
          All formulas above are estimated from the monthly return window
          configured for the analysis. Annualized quantities use the standard
          conventions (1 + <V>r</V>)<sup>12</sup> − 1 for returns and
          σ·√12 for volatility.
        </p>
      </div>

      <div className="methodology-disclaimer">
        <span className="methodology-disclaimer-icon">⚠️</span>
        <div>
          <strong>Disclaimer:</strong> This app is a student academic project
          built for educational purposes only, and should not be used as a
          legitimate or professional stock portfolio analysis tool. All stock
          price data is sourced from Yahoo Finance via the{' '}
          <code>yfinance</code> Python library, which can occasionally contain
          errors or anomalies — incorrect prices, missing observations, or
          abnormal returns that may distort the computed metrics. All results
          are theoretical and based on historical data. Investment decisions
          should always be made with the help of a qualified financial advisor.
        </div>
      </div>
    </div>
  )
}
