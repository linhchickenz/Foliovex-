#!/usr/bin/env python3
"""
test_math.py — Verifies portfolio math against manually computed expected values.

Uses synthetic stocks with hardcoded monthly returns so results are fully
deterministic and predictable. Run from the backend/ directory:
    python test_math.py
"""
import math
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, ".")

from metrics import (
    aligned_returns as aligned_returns_fn,
    calc_per_stock_metrics,
    calc_portfolio_metrics,
    calc_returns,
)
from frontier import compute_frontier

# ── Configuration ─────────────────────────────────────────────────────────────
RF_ANNUAL = 0.04   # 4% annual risk-free rate
ANN       = 12     # monthly → annual scaling factor

# ── Synthetic monthly return data ─────────────────────────────────────────────
#
#   Three stocks with deliberately different risk/return/correlation profiles
#   so the efficient frontier has visible room to improve over any equal-ish
#   weighting — which makes the frontier property checks meaningful.
#
#   ALPHA: higher-return, higher-vol growth stock
#   BETA:  lower-vol, steadier compounder
#   GAMMA: high-variance with periods of strong positive return — low corr to ALPHA
#
MONTHLY_RETURNS = {
    "ALPHA": np.array([ 0.05, -0.02,  0.08,  0.03, -0.04,  0.06,
                         0.02,  0.09, -0.01,  0.04,  0.07, -0.03]),
    "BETA":  np.array([ 0.03,  0.01,  0.04, -0.01,  0.02,  0.05,
                        -0.02,  0.03,  0.06,  0.01,  0.02,  0.04]),
    "GAMMA": np.array([-0.01,  0.06, -0.03,  0.07,  0.01, -0.02,
                         0.04, -0.05,  0.08,  0.02, -0.01,  0.05]),
}
TICKERS  = list(MONTHLY_RETURNS.keys())
N_MONTHS = len(next(iter(MONTHLY_RETURNS.values())))  # 12

# Dollar amounts held — deliberately unequal so the weight vector is
# non-trivial and portfolio-variance cross-terms are non-zero.
AMOUNTS = {"ALPHA": 10_000.0, "BETA": 15_000.0, "GAMMA": 5_000.0}

# ── Test harness ──────────────────────────────────────────────────────────────
_pass = 0
_fail = 0


def check(label: str, actual: float, expected: float, tol: float = 1e-10):
    """Assert |actual - expected| <= tol and print a labelled result line."""
    global _pass, _fail
    err = abs(float(actual) - float(expected))
    if err <= tol:
        print(f"  [PASS] {label}")
        print(f"         actual={actual:.10f}  expected={expected:.10f}")
        _pass += 1
    else:
        print(f"  [FAIL] {label}")
        print(f"         actual={actual:.10f}  expected={expected:.10f}  diff={err:.3e}")
        _fail += 1


def check_true(label: str, condition: bool, detail: str = ""):
    global _pass, _fail
    if condition:
        print(f"  [PASS] {label}")
        if detail:
            print(f"         {detail}")
        _pass += 1
    else:
        print(f"  [FAIL] {label}")
        if detail:
            print(f"         {detail}")
        _fail += 1


def banner(title: str):
    print(f"\n{'─'*64}")
    print(f"  {title}")
    print(f"{'─'*64}")


# ── Build price series from return data ───────────────────────────────────────
def build_price_df() -> pd.DataFrame:
    """
    Reconstruct N+1 monthly closing prices from N known monthly returns.
    p_0 = 100  (arbitrary);  p_t = p_{t-1} * (1 + r_t)
    pct_change() on this series recovers the original return values exactly.
    """
    data = {}
    for ticker, r in MONTHLY_RETURNS.items():
        # Prepend a factor of 1 (the base period), then take the cumulative product.
        factors = np.concatenate([[1.0], 1.0 + r])
        data[ticker] = 100.0 * np.cumprod(factors)
    return pd.DataFrame(data)  # shape (N+1, 3), RangeIndex


prices_df = build_price_df()

# ─────────────────────────────────────────────────────────────────────────────
# Section 1 — Returns calculation  (pct_change recovery)
# ─────────────────────────────────────────────────────────────────────────────
banner("1. Returns calculation — pct_change recovery")
print("""
  Formula: r_t = (P_t - P_{t-1}) / P_{t-1}

  Verify that calc_returns() recovers the exact monthly return values
  that were used to construct the synthetic price series.
""")

returns_df = calc_returns(prices_df)   # shape (N, 3), first NaN row already dropped

for ticker in TICKERS:
    expected = MONTHLY_RETURNS[ticker]
    actual   = returns_df[ticker].values
    max_diff = float(np.max(np.abs(actual - expected)))
    check_true(
        f"{ticker}: all {N_MONTHS} monthly returns recovered (max diff < 1e-12)",
        max_diff < 1e-12,
        f"max |actual - expected| = {max_diff:.2e}",
    )

# ─────────────────────────────────────────────────────────────────────────────
# Section 2 — Per-stock metrics
# ─────────────────────────────────────────────────────────────────────────────
banner("2. Per-stock metrics")
print("""
  Formulas (applied to each stock's own full observation window):
    mean_monthly       = arithmetic mean of monthly returns
    monthly_vol        = sample std of monthly returns  (ddof=1)
    annualized_return  = (1 + mean_monthly)^12 - 1
    annualized_vol     = monthly_vol * sqrt(12)
    sharpe_ratio       = (annualized_return - rf) / annualized_vol
""")

per_stock_result = calc_per_stock_metrics(returns_df, RF_ANNUAL)

for ticker in TICKERS:
    r = MONTHLY_RETURNS[ticker]

    # Manual expected values
    mean_m  = float(np.mean(r))
    std_m   = float(np.std(r, ddof=1))
    ann_r   = (1.0 + mean_m) ** ANN - 1.0
    ann_v   = std_m * math.sqrt(ANN)
    sharpe  = (ann_r - RF_ANNUAL) / ann_v if ann_v > 0 else 0.0

    m = per_stock_result[ticker]
    print(f"\n  [{ticker}]  mean_m={mean_m:.5f}  std_m={std_m:.5f}"
          f"  ann_r={ann_r*100:.2f}%  ann_v={ann_v*100:.2f}%  sharpe={sharpe:.4f}")

    check(f"{ticker} expected_monthly_return", m["expected_monthly_return"], mean_m)
    check(f"{ticker} monthly_volatility",      m["monthly_volatility"],       std_m)
    check(f"{ticker} annualized_return",       m["annualized_return"],        ann_r)
    check(f"{ticker} annualized_volatility",   m["annualized_volatility"],    ann_v)
    check(f"{ticker} sharpe_ratio",            m["sharpe_ratio"],             sharpe)

# ─────────────────────────────────────────────────────────────────────────────
# Section 3 — Portfolio metrics
# ─────────────────────────────────────────────────────────────────────────────
banner("3. Portfolio metrics")
print("""
  Formulas (computed over the aligned observation window):
    weights            = amounts / sum(amounts)
    portfolio_ret_m    = sum_i(w_i * mean_i)          [= w @ mean_monthly]
    portfolio_var_m    = sum_ij(w_i * w_j * cov_ij)   [= w^T @ Cov @ w]
    portfolio_vol_m    = sqrt(portfolio_var_m)
    annualized_return  = (1 + portfolio_ret_m)^12 - 1
    annualized_vol     = portfolio_vol_m * sqrt(12)
    sharpe_ratio       = (annualized_return - rf) / annualized_vol
""")

aligned_df   = aligned_returns_fn(returns_df)   # dropna(how='any') — no rows dropped here
mean_m_vec   = aligned_df.mean().values          # shape (3,)
cov_m_mat    = aligned_df.cov().values           # shape (3,3), pandas uses ddof=1

total_inv    = sum(AMOUNTS.values())
weights      = np.array([AMOUNTS[t] / total_inv for t in TICKERS])

print(f"  Weights: " + "  ".join(f"{t}={w:.4f}" for t, w in zip(TICKERS, weights)))

# ── Step-by-step manual computation ────────────────────────────────
# Portfolio monthly return: dot product
p_ret_m_loop = sum(weights[i] * mean_m_vec[i] for i in range(len(weights)))

# Portfolio monthly variance: double loop over the covariance matrix
p_var_m_loop = 0.0
for i in range(len(weights)):
    for j in range(len(weights)):
        p_var_m_loop += weights[i] * weights[j] * cov_m_mat[i, j]

p_vol_m = math.sqrt(max(p_var_m_loop, 0.0))
ann_r   = (1.0 + p_ret_m_loop) ** ANN - 1.0
ann_v   = p_vol_m * math.sqrt(ANN)
sharpe  = (ann_r - RF_ANNUAL) / ann_v if ann_v > 0 else 0.0

print(f"\n  Manual intermediate values:")
print(f"    portfolio monthly return     = {p_ret_m_loop:.8f}  ({p_ret_m_loop*100:.4f}%/mo)")
print(f"    portfolio monthly variance   = {p_var_m_loop:.10f}")
print(f"    portfolio monthly volatility = {p_vol_m:.8f}  ({p_vol_m*100:.4f}%/mo)")
print(f"    annualized return            = {ann_r:.8f}  ({ann_r*100:.4f}%)")
print(f"    annualized volatility        = {ann_v:.8f}  ({ann_v*100:.4f}%)")
print(f"    sharpe ratio                 = {sharpe:.6f}")

# ── Compare against matrix dot-product (should be identical) ────────
p_ret_m_mat = float(weights @ mean_m_vec)
p_var_m_mat = float(weights @ cov_m_mat @ weights)

print()
check("portfolio_ret_m: loop  ==  w @ mean  (formula equivalence)",
      p_ret_m_loop, p_ret_m_mat)
check("portfolio_var_m: loop  ==  w^T Cov w (formula equivalence)",
      p_var_m_loop, p_var_m_mat)

# ── Compare against backend function ────────────────────────────────
port_result = calc_portfolio_metrics(weights, mean_m_vec, cov_m_mat, RF_ANNUAL)

print()
check("backend expected_monthly_return", port_result["expected_monthly_return"], p_ret_m_loop)
check("backend monthly_volatility",      port_result["monthly_volatility"],       p_vol_m)
check("backend annualized_return",       port_result["annualized_return"],        ann_r)
check("backend annualized_volatility",   port_result["annualized_volatility"],    ann_v)
check("backend sharpe_ratio",            port_result["sharpe_ratio"],             sharpe)

# ─────────────────────────────────────────────────────────────────────────────
# Section 4 — Covariance matrix structure
# ─────────────────────────────────────────────────────────────────────────────
banner("4. Covariance matrix properties")
print("""
  A valid covariance matrix must satisfy:
    • diagonal entries = per-asset variance  (cov(X,X) = var(X))
    • matrix is symmetric                    (cov(X,Y) = cov(Y,X))
    • matrix is positive semi-definite       (all eigenvalues >= 0)
    • portfolio variance is non-negative
""")

# Manually compute per-asset variance using the sample variance formula
for i, ticker in enumerate(TICKERS):
    r          = MONTHLY_RETURNS[ticker]
    var_manual = float(np.sum((r - r.mean()) ** 2) / (len(r) - 1))
    check(f"cov[{ticker},{ticker}] == sample_var({ticker})", cov_m_mat[i, i], var_manual)

# Symmetry
max_asymm = float(np.max(np.abs(cov_m_mat - cov_m_mat.T)))
check_true("covariance matrix is symmetric",
           max_asymm < 1e-14, f"max |C - C^T| = {max_asymm:.2e}")

# PSD check via eigenvalues
min_eig = float(np.min(np.linalg.eigvalsh(cov_m_mat)))
check_true("covariance matrix is positive semi-definite (min eigenvalue >= 0)",
           min_eig >= -1e-12, f"min eigenvalue = {min_eig:.4e}")

check_true("portfolio variance >= 0",
           p_var_m_loop >= 0.0, f"portfolio variance = {p_var_m_loop:.10f}")

# Print the full covariance and correlation matrices for reference
print("\n  Covariance matrix (monthly):")
for i, ti in enumerate(TICKERS):
    row = "    " + "  ".join(f"{cov_m_mat[i,j]:9.6f}" for j in range(len(TICKERS)))
    print(f"  {ti}  {row}")

corr_mat = np.corrcoef(np.array([MONTHLY_RETURNS[t] for t in TICKERS]))
print("\n  Correlation matrix:")
for i, ti in enumerate(TICKERS):
    row = "    " + "  ".join(f"{corr_mat[i,j]:6.3f}" for j in range(len(TICKERS)))
    print(f"  {ti}  {row}")

# ─────────────────────────────────────────────────────────────────────────────
# Section 5 — Efficient frontier properties
# ─────────────────────────────────────────────────────────────────────────────
banner("5. Efficient frontier properties")
print("""
  Properties that must hold for a valid no-short-selling frontier:
    • Min-variance portfolio  : vol  <= original portfolio vol
    • Max-Sharpe portfolio    : sharpe >= original portfolio sharpe
    • Same-return portfolio   : annualized_return ≈ original return  (tol 2e-3)
    • Same-risk portfolio     : annualized_vol    ≈ original vol      (tol 2e-3)
    • All named portfolios    : weights sum to 1, all weights in [0, 1]
    • Frontier curve          : non-empty, returns non-decreasing
""")

frontier = compute_frontier(mean_m_vec, cov_m_mat, RF_ANNUAL, weights)

min_var   = frontier["min_variance"]
max_sh    = frontier["max_sharpe"]
same_ret  = frontier["same_return"]
same_risk = frontier["same_risk"]
curve     = frontier["curve"]

# Reference values for the original portfolio
orig_ann_ret = ann_r
orig_ann_vol = ann_v
orig_sharpe  = sharpe

print(f"  {'Portfolio':<22}  {'Ann Return':>10}  {'Ann Vol':>10}  {'Sharpe':>8}")
print(f"  {'─'*22}  {'─'*10}  {'─'*10}  {'─'*8}")
print(f"  {'Original':<22}  {orig_ann_ret*100:>9.3f}%  {orig_ann_vol*100:>9.3f}%  {orig_sharpe:>8.4f}")
print(f"  {'Min Variance':<22}  {min_var['annualized_return']*100:>9.3f}%  {min_var['annualized_volatility']*100:>9.3f}%  {min_var['sharpe_ratio']:>8.4f}")
print(f"  {'Max Sharpe':<22}  {max_sh['annualized_return']*100:>9.3f}%  {max_sh['annualized_volatility']*100:>9.3f}%  {max_sh['sharpe_ratio']:>8.4f}")
print(f"  {'Same Return':<22}  {same_ret['annualized_return']*100:>9.3f}%  {same_ret['annualized_volatility']*100:>9.3f}%  {same_ret['sharpe_ratio']:>8.4f}")
print(f"  {'Same Risk':<22}  {same_risk['annualized_return']*100:>9.3f}%  {same_risk['annualized_volatility']*100:>9.3f}%  {same_risk['sharpe_ratio']:>8.4f}")
print()

# ── Frontier property checks ─────────────────────────────────────────
check_true(
    "min-variance vol <= original vol",
    min_var["annualized_volatility"] <= orig_ann_vol + 1e-6,
    f"min_var={min_var['annualized_volatility']*100:.4f}%  orig={orig_ann_vol*100:.4f}%",
)

check_true(
    "max-Sharpe sharpe >= original Sharpe",
    max_sh["sharpe_ratio"] >= orig_sharpe - 1e-6,
    f"max_sharpe={max_sh['sharpe_ratio']:.4f}  orig={orig_sharpe:.4f}",
)

ret_diff = abs(same_ret["annualized_return"] - orig_ann_ret)
check_true(
    "same-return portfolio annualized return ≈ original  (tol 2e-3)",
    ret_diff <= 2e-3,
    f"diff={ret_diff:.2e}  orig={orig_ann_ret*100:.4f}%  got={same_ret['annualized_return']*100:.4f}%",
)

risk_diff = abs(same_risk["annualized_volatility"] - orig_ann_vol)
check_true(
    "same-risk portfolio annualized vol ≈ original  (tol 2e-3)",
    risk_diff <= 2e-3,
    f"diff={risk_diff:.2e}  orig={orig_ann_vol*100:.4f}%  got={same_risk['annualized_volatility']*100:.4f}%",
)

# ── Weight validity for each named portfolio ─────────────────────────
print()
named = [
    ("min_variance", min_var),
    ("max_sharpe",   max_sh),
    ("same_return",  same_ret),
    ("same_risk",    same_risk),
]
for name, pt in named:
    w = np.array(pt["weights"])
    w_sum = float(np.sum(w))
    w_min = float(np.min(w))
    check_true(
        f"{name}: weights sum to 1",
        abs(w_sum - 1.0) < 1e-5,
        f"sum={w_sum:.8f}  weights={[round(x,4) for x in w.tolist()]}",
    )
    check_true(
        f"{name}: all weights >= 0 (no short-selling)",
        w_min >= -1e-6,
        f"min_weight={w_min:.6f}",
    )

# ── Frontier curve structure ─────────────────────────────────────────
print()
check_true("frontier curve has >= 2 points", len(curve) >= 2,
           f"curve length = {len(curve)}")

curve_rets = [pt["annualized_return"] for pt in curve]
monotone = all(curve_rets[i] <= curve_rets[i + 1] + 1e-8
               for i in range(len(curve_rets) - 1))
check_true("frontier curve returns are non-decreasing",
           monotone,
           f"min={min(curve_rets)*100:.2f}%  max={max(curve_rets)*100:.2f}%  n={len(curve)}")

curve_vols = [pt["annualized_volatility"] for pt in curve]
check_true("min-variance point is the lowest-vol point on the curve",
           min_var["annualized_volatility"] <= min(curve_vols) + 1e-6,
           f"min_var vol={min_var['annualized_volatility']*100:.4f}%"
           f"  curve min vol={min(curve_vols)*100:.4f}%")

# ── Summary ───────────────────────────────────────────────────────────────────
total = _pass + _fail
print(f"\n{'═'*64}")
if _fail == 0:
    print(f"  ALL {total} CHECKS PASSED")
else:
    print(f"  {_pass}/{total} checks passed — {_fail} FAILED")
print(f"{'═'*64}\n")

sys.exit(0 if _fail == 0 else 1)
