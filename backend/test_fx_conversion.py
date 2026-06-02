#!/usr/bin/env python3
"""
test_fx_conversion.py — Side-by-side USD vs CAD verification for AAPL + MSFT.

Run from the backend/ directory:
    python test_fx_conversion.py
"""
import sys
import math
import numpy as np
import pandas as pd

sys.path.insert(0, ".")

from data import fetch_price_data, fetch_risk_free_rate
from metrics import (
    calc_returns,
    aligned_returns,
    calc_per_stock_metrics,
    calc_portfolio_metrics,
)

TICKERS  = ["AAPL", "MSFT"]
AMOUNTS  = [500.0, 500.0]   # 50/50, $1 000 total
WEIGHTS  = [0.5, 0.5]

# ── Helpers ───────────────────────────────────────────────────────────────────

def col(s, w):
    """Left-pad a string to width w."""
    return str(s).rjust(w)

def pct(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return "  N/A  "
    return f"{v*100:+.2f}%"

def diff_pct(a, b):
    """Difference b-a in percentage-point terms."""
    if a is None or b is None:
        return "  N/A  "
    return f"{(b - a)*100:+.2f} pp"

def divider(char="─", w=76):
    print(char * w)

def row(label, usd_val, cad_val, w_label=38, w_col=14):
    delta = diff_pct(usd_val, cad_val)
    print(
        f"  {label:<{w_label}}"
        f"{col(pct(usd_val), w_col)}"
        f"{col(pct(cad_val), w_col)}"
        f"{col(delta, w_col)}"
    )

# ── Fetch raw data ─────────────────────────────────────────────────────────────

print("\nFetching USD price data …", flush=True)
prices_usd, valid_usd, failed_usd, natives_usd = fetch_price_data(TICKERS, "USD")

print("Fetching CAD price data (triggers USDCAD=X fetch) …", flush=True)
prices_cad, valid_cad, failed_cad, natives_cad = fetch_price_data(TICKERS, "CAD")

print("Fetching risk-free rates …", flush=True)
rf_usd, rf_usd_src = fetch_risk_free_rate("USD")
rf_cad, rf_cad_src = fetch_risk_free_rate("CAD")

# ── Restrict to the exact same set of months ──────────────────────────────────
#   aligned_returns() drops any row with a NaN in *any* column, giving us the
#   clean common window both modes will use for covariance/portfolio math.

ret_usd_raw = calc_returns(prices_usd)
ret_cad_raw = calc_returns(prices_cad)

common_usd = aligned_returns(ret_usd_raw)
common_cad = aligned_returns(ret_cad_raw)

# ── Per-stock metrics ─────────────────────────────────────────────────────────

ps_usd = calc_per_stock_metrics(ret_usd_raw, rf_usd)
ps_cad = calc_per_stock_metrics(ret_cad_raw, rf_cad)

# ── Portfolio metrics ─────────────────────────────────────────────────────────

mean_usd = common_usd.mean().values
cov_usd  = common_usd.cov().values
port_usd = calc_portfolio_metrics(WEIGHTS, mean_usd, cov_usd, rf_usd)

mean_cad = common_cad.mean().values
cov_cad  = common_cad.cov().values
port_cad = calc_portfolio_metrics(WEIGHTS, mean_cad, cov_cad, rf_cad)

# ── FX spot check: first 8 months of raw prices side-by-side ─────────────────
#   If conversion is working, CAD prices should differ by the FX rate that month.
#   Compute implied rate = cad_price / usd_price for each month.

print("\n")
divider("═")
print("  FX CONVERSION SPOT CHECK — AAPL monthly prices (first 8 months)")
divider("═")
print(f"  {'Month':<12}  {'AAPL USD':>12}  {'AAPL CAD':>12}  {'Implied USDCAD':>15}  {'yf USDCAD (≈)':>14}")
divider()

# Pull USDCAD directly from yfinance so we can verify the implied rate
import yfinance as yf
fx_raw = yf.Ticker("USDCAD=X").history(period="5y", interval="1mo", auto_adjust=False)
from data import _normalize_monthly_index
fx_series = _normalize_monthly_index(fx_raw["Close"].dropna())

# Align everything on the common USD price index
aapl_usd = prices_usd["AAPL"]
aapl_cad = prices_cad["AAPL"]
common_idx = aapl_usd.index.intersection(aapl_cad.index)
aapl_usd = aapl_usd.reindex(common_idx)
aapl_cad = aapl_cad.reindex(common_idx)
fx_aligned = fx_series.reindex(common_idx, method="ffill").bfill()

for month in common_idx[:8]:
    u = aapl_usd[month]
    c = aapl_cad[month]
    implied = c / u if (u and not np.isnan(u) and u != 0) else float("nan")
    actual_fx = fx_aligned[month]
    match = "✓" if abs(implied - actual_fx) < 0.01 else "✗ MISMATCH"
    print(f"  {str(month.date()):<12}  {u:>12.4f}  {c:>12.4f}  {implied:>15.4f}  {actual_fx:>14.4f}  {match}")

divider()
print("  If Implied USDCAD ≈ yf USDCAD each month → month-by-month conversion confirmed.")

# ── Monthly return comparison: USD vs CAD ─────────────────────────────────────

print("\n")
divider("═")
print("  MONTHLY RETURN SERIES — AAPL (first 10 months)")
divider("═")
print(f"  {'Month':<12}  {'AAPL ret USD':>14}  {'AAPL ret CAD':>14}  {'Difference':>12}")
divider()

r_aapl_usd = ret_usd_raw["AAPL"].dropna()
r_aapl_cad = ret_cad_raw["AAPL"].dropna()
common_ret_idx = r_aapl_usd.index.intersection(r_aapl_cad.index)

for month in common_ret_idx[:10]:
    ru = r_aapl_usd[month]
    rc = r_aapl_cad[month]
    diff = rc - ru
    print(f"  {str(month.date()):<12}  {ru*100:>+13.4f}%  {rc*100:>+13.4f}%  {diff*100:>+11.4f}%")

divider()
print("  If the USD and CAD return values differ → FX moves are captured month-by-month.")

# ── Main comparison table ─────────────────────────────────────────────────────

print("\n")
divider("═")
print("  FULL METRICS COMPARISON — USD vs CAD")
divider("═")
print(f"  {'Metric':<38}{'USD':>14}{'CAD':>14}{'CAD − USD':>14}")
divider()

print("  DATASET")
print(f"  {'Common months (portfolio window)':<38}"
      f"{col(len(common_usd), 14)}{col(len(common_cad), 14)}")
print(f"  {'Risk-free rate':<38}"
      f"{col(pct(rf_usd), 14)}{col(pct(rf_cad), 14)}")
divider("·")

print("  AAPL (per-stock, own observation window)")
row("  Expected annual return",
    ps_usd["AAPL"]["annualized_return"],
    ps_cad["AAPL"]["annualized_return"])
row("  Annual volatility",
    ps_usd["AAPL"]["annualized_volatility"],
    ps_cad["AAPL"]["annualized_volatility"])
row("  Sharpe ratio",
    ps_usd["AAPL"]["sharpe_ratio"],
    ps_cad["AAPL"]["sharpe_ratio"])
print(f"  {'  Months of data':<38}"
      f"{col(ps_usd['AAPL']['n_months'], 14)}"
      f"{col(ps_cad['AAPL']['n_months'], 14)}")
divider("·")

print("  MSFT (per-stock, own observation window)")
row("  Expected annual return",
    ps_usd["MSFT"]["annualized_return"],
    ps_cad["MSFT"]["annualized_return"])
row("  Annual volatility",
    ps_usd["MSFT"]["annualized_volatility"],
    ps_cad["MSFT"]["annualized_volatility"])
row("  Sharpe ratio",
    ps_usd["MSFT"]["sharpe_ratio"],
    ps_cad["MSFT"]["sharpe_ratio"])
print(f"  {'  Months of data':<38}"
      f"{col(ps_usd['MSFT']['n_months'], 14)}"
      f"{col(ps_cad['MSFT']['n_months'], 14)}")
divider("·")

print("  50/50 PORTFOLIO (aligned window, w^T Σ w formula)")
row("  Expected monthly return",
    port_usd["expected_monthly_return"],
    port_cad["expected_monthly_return"])
row("  Expected annual return",
    port_usd["annualized_return"],
    port_cad["annualized_return"])
row("  Monthly volatility",
    port_usd["monthly_volatility"],
    port_cad["monthly_volatility"])
row("  Annual volatility",
    port_usd["annualized_volatility"],
    port_cad["annualized_volatility"])
row("  Sharpe ratio",
    port_usd["sharpe_ratio"],
    port_cad["sharpe_ratio"])
divider("═")

# ── Verdict ───────────────────────────────────────────────────────────────────

ret_diff_pp   = (port_cad["annualized_return"] - port_usd["annualized_return"]) * 100
vol_diff_pp   = (port_cad["annualized_volatility"] - port_usd["annualized_volatility"]) * 100
aapl_ret_same = abs(ps_usd["AAPL"]["annualized_return"] -
                    ps_cad["AAPL"]["annualized_return"]) < 1e-8

print("\n  VERDICT")
divider()

if aapl_ret_same:
    print("  ✗  AAPL USD return == CAD return — conversion appears NOT working.")
else:
    print("  ✓  USD and CAD returns differ — FX conversion is active.")

if abs(ret_diff_pp) < 0.001:
    print("  ✗  Portfolio return difference is < 0.001 pp — conversion appears NOT working.")
elif abs(ret_diff_pp) > 20:
    print(f"  ?  Portfolio return diff is {ret_diff_pp:+.2f} pp — unexpectedly large, check data.")
else:
    print(f"  ✓  Portfolio annual return differs by {ret_diff_pp:+.2f} pp "
          f"— consistent with CAD/USD drift over the period.")

if abs(vol_diff_pp) < 0.001:
    print("  ✗  Portfolio volatility difference is < 0.001 pp — conversion appears NOT working.")
else:
    print(f"  ✓  Portfolio annual volatility differs by {vol_diff_pp:+.2f} pp "
          f"— FX volatility is being captured.")

print()
