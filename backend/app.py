"""
Portfolio Optimizer — Flask backend.
"""
import time
import traceback

import numpy as np
import pandas as pd
from flask import Flask, jsonify, request
from flask_cors import CORS

from data import (
    fetch_price_data,
    fetch_risk_free_rate,
    fetch_benchmark_data,
    fetch_market_monthly_returns,
    FALLBACK_RF_USD,
)
from metrics import (
    aligned_returns,
    calc_capm,
    calc_correlation,
    calc_per_stock_metrics,
    calc_portfolio_metrics,
    calc_returns,
)
from frontier import compute_frontier

# Market index used as the CAPM regressor for each currency.
CAPM_MARKET_BY_CURRENCY = {"USD": "^GSPC", "CAD": "^GSPTSE"}

# Compare-benchmark fallback chain for the Monte Carlo endpoint. The primary
# ticker is tried first; if it returns no data we walk the chain. yfinance
# does not host the TSX 60 spot index reliably, so we fall back to the
# iShares S&P/TSX 60 ETF (XIU.TO) which tracks the same index with full history.
MC_BENCHMARK_FALLBACKS = {
    "^TXTY":    ["^SPTSE60", "XIU.TO"],
    "^SPTSE60": ["XIU.TO"],
}

# Human-readable names used in the Monte Carlo response.
MC_BENCHMARK_NAMES = {
    "^GSPC":    "S&P 500",
    "^GSPTSE":  "S&P/TSX Composite",
    "^TXTY":    "TSX 60",
    "^SPTSE60": "TSX 60",
    "XIU.TO":   "TSX 60",
}

app = Flask(__name__)
CORS(app)


@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "message": "Portfolio Optimizer API is running"})


@app.route("/api/risk-free")
def risk_free():
    """Live risk-free rate for the requested currency. Used by sidebar UI."""
    currency = (request.args.get("currency") or "USD").upper()
    if currency not in ("USD", "CAD"):
        return jsonify({"error": "Currency must be USD or CAD."}), 400
    rate, source = fetch_risk_free_rate(currency)
    return jsonify({"rate": rate, "source": source, "currency": currency})


@app.route("/api/benchmark", methods=["POST"])
def benchmark_endpoint():
    """
    Fetch benchmark metrics aligned to a previously-computed portfolio window.
    Used for live benchmark switching on the frontier tabs without re-running
    the full analysis.

    Body: { benchmark_ticker, currency, dates: [YYYY-MM-DD, ...], rf_annual }
    Returns: { benchmark: <dict or null> }
    """
    body = request.get_json(force=True) or {}
    benchmark_ticker = (body.get("benchmark_ticker") or "").strip().upper() or None
    currency = (body.get("currency") or "USD").upper()
    dates_raw = body.get("dates", [])
    try:
        rf_annual = float(body.get("rf_annual", FALLBACK_RF_USD))
    except (TypeError, ValueError):
        rf_annual = FALLBACK_RF_USD

    if not benchmark_ticker or not dates_raw:
        return jsonify({"benchmark": None})

    try:
        common_index = pd.DatetimeIndex([pd.Timestamp(d) for d in dates_raw])
        result = fetch_benchmark_data(benchmark_ticker, currency, common_index, rf_annual)
        return jsonify({"benchmark": result})
    except Exception:
        traceback.print_exc()
        return jsonify({"benchmark": None})


@app.route("/api/analyze", methods=["POST"])
def analyze():
    """
    Body: { stocks: [{ticker, amount}], currency: 'USD'|'CAD',
            risk_free_rate_override?: number (annual decimal, e.g. 0.045) }
    """
    body = request.get_json(force=True) or {}
    stocks_in = body.get("stocks", [])
    currency = (body.get("currency") or "USD").upper()
    rf_override = body.get("risk_free_rate_override")
    benchmark_ticker = (body.get("benchmark_ticker") or "").strip().upper() or None
    short_selling = bool(body.get("short_selling", False))

    # ── Validate input ────────────────────────────────────────
    if not isinstance(stocks_in, list) or len(stocks_in) < 2:
        return jsonify({"error": "At least 2 stocks are required."}), 400
    if len(stocks_in) > 20:
        return jsonify({"error": "Maximum 20 stocks allowed."}), 400
    if currency not in ("USD", "CAD"):
        return jsonify({"error": "Currency must be USD or CAD."}), 400

    requested = []
    for s in stocks_in:
        ticker = (s.get("ticker") or "").strip().upper()
        try:
            amount = float(s.get("amount", 0))
        except (TypeError, ValueError):
            amount = 0.0
        if ticker and amount > 0:
            requested.append({"ticker": ticker, "amount": amount})

    if len(requested) < 2:
        return jsonify({"error": "At least 2 valid (ticker + positive amount) entries required."}), 400

    tickers_in = [r["ticker"] for r in requested]
    amount_by_ticker = {r["ticker"]: r["amount"] for r in requested}

    t_start = time.time()

    try:
        # ── Fetch prices + currency-convert ────────────────────
        prices, valid, failed, natives = fetch_price_data(tickers_in, currency)

        if len(valid) < 2:
            return jsonify({
                "error": f"Need at least 2 tickers with usable data. "
                         f"Valid: {valid}. Failed: {failed}.",
            }), 400

        # ── Risk-free rate ─────────────────────────────────────
        if rf_override is not None and rf_override != "":
            try:
                rf_annual = float(rf_override)
                rf_source = "user override"
            except (TypeError, ValueError):
                rf_annual, rf_source = fetch_risk_free_rate(currency)
        else:
            rf_annual, rf_source = fetch_risk_free_rate(currency)

        # ── Returns + per-stock metrics ────────────────────────
        returns = calc_returns(prices)
        per_stock = calc_per_stock_metrics(returns, rf_annual)

        # Use a common observation window for portfolio + frontier math
        common = aligned_returns(returns)
        if len(common) < 6:
            return jsonify({
                "error": f"Not enough overlapping monthly observations across tickers "
                         f"(only {len(common)} months). Try removing newer/IPO tickers.",
            }), 400

        cov = common.cov().values
        mean_monthly = common.mean().values

        tickers = list(common.columns)

        # ── Original portfolio weights (re-normalized over valid tickers) ──
        amounts = np.array([amount_by_ticker[t] for t in tickers], dtype=float)
        total_invested = float(np.array([amount_by_ticker[t] for t in valid]).sum())
        weights = amounts / amounts.sum()

        portfolio = calc_portfolio_metrics(weights, mean_monthly, cov, rf_annual)
        portfolio["weights"] = [float(x) for x in weights]

        # ── CAPM (per-stock beta, alpha, expected return) ──────
        # Regress each stock against its currency's market index. If the index
        # can't be fetched we silently fall back — frontend stays on Historical.
        market_ticker = CAPM_MARKET_BY_CURRENCY.get(currency)
        market_rets = (
            fetch_market_monthly_returns(market_ticker, currency)
            if market_ticker else None
        )
        capm = calc_capm(common, market_rets, rf_annual)

        portfolio_capm = None
        mean_monthly_capm = None
        capm_info = {"available": False, "benchmark": market_ticker}
        if capm is not None:
            mean_monthly_capm = capm["mean_monthly_capm"]
            portfolio_capm = calc_portfolio_metrics(
                weights, mean_monthly_capm, cov, rf_annual
            )
            portfolio_capm["weights"] = [float(x) for x in weights]
            # Portfolio-level risk decomposition (single-factor model).
            # β_p = weighted average of individual betas.
            betas = np.array([capm["per_stock"][t]["beta"] for t in tickers])
            port_beta = float(weights @ betas)
            # Systematic variance = β_p² × σ²_market (monthly).
            systematic_var_m = port_beta ** 2 * capm["mkt_var_m"]
            # Total portfolio variance from the empirical covariance matrix (monthly).
            # Using the residual ensures Systematic² + Specific² = Total² exactly,
            # because the full cov matrix captures cross-stock residual correlations
            # that Σ wᵢ² × σ²_ε,i would miss.
            total_var_m = float(weights @ cov @ weights)
            specific_var_m = max(total_var_m - systematic_var_m, 0.0)
            port_syst_risk = float(np.sqrt(systematic_var_m * 12))
            port_spec_risk = float(np.sqrt(specific_var_m * 12))
            portfolio_capm["portfolio_beta"] = port_beta
            portfolio_capm["systematic_risk"] = port_syst_risk
            portfolio_capm["specific_risk"] = port_spec_risk
            # Stamp the benchmark on each per-stock CAPM record for the UI.
            for t, m in capm["per_stock"].items():
                m["benchmark_used"] = market_ticker
            capm_info = {
                "available": True,
                "benchmark": market_ticker,
                "market_return_annual": capm["market_return_annual"],
                "mkt_var_m": capm["mkt_var_m"],
                "n_months_used": capm["n_months_used"],
            }

        # ── Correlation + efficient frontier ───────────────────
        correlation = calc_correlation(returns)
        frontier = compute_frontier(
            mean_monthly, cov, rf_annual, weights, short_selling=short_selling
        )
        # In short-selling mode also compute the long-only frontier so the
        # frontend can overlay a "compare with no short selling" curve.
        frontier_no_short = (
            compute_frontier(mean_monthly, cov, rf_annual, weights, short_selling=False)
            if short_selling else None
        )

        frontier_capm = None
        frontier_no_short_capm = None
        if mean_monthly_capm is not None:
            frontier_capm = compute_frontier(
                mean_monthly_capm, cov, rf_annual, weights, short_selling=short_selling
            )
            if short_selling:
                frontier_no_short_capm = compute_frontier(
                    mean_monthly_capm, cov, rf_annual, weights, short_selling=False
                )

        # ── Portfolio monthly returns for cumulative chart ──────
        portfolio_monthly_rets = (common @ weights).tolist()
        dates = [d.strftime('%Y-%m-%d') for d in common.index]

        # ── Benchmark ───────────────────────────────────────────
        benchmark_result = None
        if benchmark_ticker:
            benchmark_result = fetch_benchmark_data(
                benchmark_ticker, currency, common.index, rf_annual
            )

        # ── Merge CAPM fields into per-stock payload ───────────
        if capm is not None:
            for t, capm_m in capm["per_stock"].items():
                if t in per_stock:
                    per_stock[t].update(capm_m)

        # ── Warnings (non-fatal) ───────────────────────────────
        warnings_list = []
        if failed:
            warnings_list.append(f"Could not fetch data for: {', '.join(failed)}")
        dropped_due_to_window = [t for t in valid if t not in tickers]
        if dropped_due_to_window:
            warnings_list.append(
                f"Dropped (insufficient overlap): {', '.join(dropped_due_to_window)}"
            )
        for t, m in per_stock.items():
            for flag in m.get("data_quality_flags", []):
                warnings_list.append(f"{t}: {flag}")
        if capm is None and market_ticker:
            warnings_list.append(
                f"CAPM unavailable: could not fetch {market_ticker} returns for "
                f"this window — falling back to Historical mode is recommended."
            )

        elapsed = round(time.time() - t_start, 2)

        return jsonify({
            "currency": currency,
            "risk_free_rate": rf_annual,
            "risk_free_rate_source": rf_source,
            "tickers": tickers,
            "native_currencies": {t: natives.get(t, "USD") for t in tickers},
            "amounts": [float(amount_by_ticker[t]) for t in tickers],
            "total_investment": total_invested,
            "n_months": int(len(common)),
            "n_months_per_stock": {t: per_stock[t]["n_months"] for t in tickers if t in per_stock},
            "per_stock": per_stock,
            "portfolio": portfolio,
            "portfolio_capm": portfolio_capm,
            "correlation": correlation,
            "frontier": frontier,
            "frontier_no_short": frontier_no_short,
            "frontier_capm": frontier_capm,
            "frontier_no_short_capm": frontier_no_short_capm,
            "capm_info": capm_info,
            "short_selling": short_selling,
            "short_selling_disclaimer": (
                "Short selling involves unlimited downside risk and requires "
                "active portfolio monitoring."
                if short_selling else None
            ),
            "mean_monthly": [float(x) for x in mean_monthly],
            "mean_monthly_capm": (
                [float(x) for x in mean_monthly_capm]
                if mean_monthly_capm is not None else None
            ),
            "cov_monthly": [[float(x) for x in row] for row in cov],
            "portfolio_monthly_returns": portfolio_monthly_rets,
            "dates": dates,
            "benchmark": benchmark_result,
            "warnings": warnings_list,
            "elapsed_seconds": elapsed,
        })

    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": f"Server error: {e}"}), 500


@app.route("/api/monte-carlo", methods=["POST"])
def monte_carlo():
    """
    Runs 10,000 Monte Carlo portfolio simulations across multiple horizons,
    and optionally simulates a comparison benchmark on the same horizons.

    Body: {
      mean_monthly, cov_monthly, weights, total_investment, rf_annual,
      benchmark_ticker?  — ticker to simulate alongside the portfolio
      currency?          — used for FX conversion of the benchmark
    }
    """
    body = request.get_json(force=True) or {}
    try:
        mean_monthly = np.array(body["mean_monthly"], dtype=float)
        cov_monthly = np.array(body["cov_monthly"], dtype=float)
        weights = np.array(body["weights"], dtype=float)
        total_investment = float(body["total_investment"])
        rf_annual = float(body.get("rf_annual", 0.0))
    except (KeyError, TypeError, ValueError) as e:
        return jsonify({"error": f"Invalid input: {e}"}), 400

    compare_ticker = (body.get("benchmark_ticker") or "").strip().upper() or None
    compare_currency = (body.get("currency") or "USD").upper()

    n_sims = 10_000
    max_months = 120  # 10Y
    horizons = {"6m": 6, "1y": 12, "3y": 36, "5y": 60, "10y": 120}

    rng = np.random.default_rng(42)
    # (n_sims, max_months, n_assets) — one month of returns per step
    sim_returns = rng.multivariate_normal(mean_monthly, cov_monthly,
                                          size=(n_sims, max_months))
    # Portfolio return per step: (n_sims, max_months)
    port_returns = sim_returns @ weights
    # Cumulative growth factors starting at 1.0: (n_sims, max_months + 1)
    cumulative = np.cumprod(1.0 + port_returns, axis=1)
    ones = np.ones((n_sims, 1))
    cum_with_start = np.hstack([ones, cumulative])
    portfolio_values = cum_with_start * total_investment  # dollar values

    pct_levels = [1, 5, 25, 50, 75, 95, 99]
    result_horizons = {}
    for key, n_months in horizons.items():
        vals = portfolio_values[:, : n_months + 1]       # (n_sims, n_months+1)
        paths = np.percentile(vals, pct_levels, axis=0)  # (7, n_months+1)
        final_vals = vals[:, -1]

        result_horizons[key] = {
            "n_months": n_months,
            "percentile_paths": {
                "p1":  paths[0].tolist(),
                "p5":  paths[1].tolist(),
                "p25": paths[2].tolist(),
                "p50": paths[3].tolist(),
                "p75": paths[4].tolist(),
                "p95": paths[5].tolist(),
                "p99": paths[6].tolist(),
            },
            "final_stats": {
                "p1":          float(np.percentile(final_vals, 1)),
                "p5":          float(np.percentile(final_vals, 5)),
                "p25":         float(np.percentile(final_vals, 25)),
                "p50":         float(np.percentile(final_vals, 50)),
                "p75":         float(np.percentile(final_vals, 75)),
                "p95":         float(np.percentile(final_vals, 95)),
                "p99":         float(np.percentile(final_vals, 99)),
                "mean":        float(np.mean(final_vals)),
                "prob_profit": float(np.mean(final_vals > total_investment)),
            },
        }

    # ── Parametric VaR — normal, one-tailed (Z = 1.645 / 2.326) ──
    port_var_m = float(weights @ cov_monthly @ weights)
    port_vol_m = float(np.sqrt(max(port_var_m, 0.0)))
    port_vol_d = port_vol_m / np.sqrt(21.0)   # ~21 trading days per month

    def parametric_entry(z):
        return {
            "daily_pct":      port_vol_d * z,
            "daily_dollar":   total_investment * port_vol_d * z,
            "monthly_pct":    port_vol_m * z,
            "monthly_dollar": total_investment * port_vol_m * z,
        }

    # ── Monte Carlo VaR — empirical percentiles, no normality assumed ──
    # Monthly VaR: use the first simulated month across all 10,000 paths.
    monthly_port_returns = port_returns[:, 0]
    # Daily VaR: simulate daily portfolio returns directly.
    mean_d = mean_monthly / 21.0
    cov_d = cov_monthly / 21.0
    daily_port_returns = rng.multivariate_normal(mean_d, cov_d, size=n_sims) @ weights

    def mc_var_entry(tail_pct):
        d_loss = -float(np.percentile(daily_port_returns, tail_pct))
        m_loss = -float(np.percentile(monthly_port_returns, tail_pct))
        # Guard against positive "losses" (extremely positive tail)
        d_loss = max(d_loss, 0.0)
        m_loss = max(m_loss, 0.0)
        return {
            "daily_pct":      d_loss,
            "daily_dollar":   total_investment * d_loss,
            "monthly_pct":    m_loss,
            "monthly_dollar": total_investment * m_loss,
        }

    # ── Comparison benchmark (optional) ────────────────────────
    # Independent univariate sim using the benchmark's own historical mean +
    # variance. Reuses the running rng so the draws are independent of the
    # portfolio sim (rng state has already advanced past the portfolio draw).
    benchmark_payload = None
    if compare_ticker:
        bm_rets = fetch_market_monthly_returns(compare_ticker, compare_currency)
        resolved_ticker = compare_ticker
        if bm_rets is None:
            for fallback in MC_BENCHMARK_FALLBACKS.get(compare_ticker, []):
                bm_rets = fetch_market_monthly_returns(fallback, compare_currency)
                if bm_rets is not None:
                    resolved_ticker = fallback
                    break

        if bm_rets is not None and len(bm_rets) >= 6:
            bm_mean_m = float(bm_rets.mean())
            bm_std_m = float(bm_rets.std(ddof=1))
            bm_sim_returns = rng.normal(bm_mean_m, bm_std_m, size=(n_sims, max_months))
            bm_cumulative = np.cumprod(1.0 + bm_sim_returns, axis=1)
            bm_values_all = np.hstack([ones, bm_cumulative]) * total_investment

            bm_horizons = {}
            for key, n_months in horizons.items():
                bm_vals = bm_values_all[:, : n_months + 1]
                bm_paths = np.percentile(bm_vals, pct_levels, axis=0)
                bm_final = bm_vals[:, -1]
                port_final = portfolio_values[:, n_months]
                prob_beats = float(np.mean(port_final > bm_final))
                bm_horizons[key] = {
                    "n_months": n_months,
                    "percentile_paths": {
                        "p1":  bm_paths[0].tolist(),
                        "p5":  bm_paths[1].tolist(),
                        "p25": bm_paths[2].tolist(),
                        "p50": bm_paths[3].tolist(),
                        "p75": bm_paths[4].tolist(),
                        "p95": bm_paths[5].tolist(),
                        "p99": bm_paths[6].tolist(),
                    },
                    "final_stats": {
                        "p1":   float(np.percentile(bm_final, 1)),
                        "p5":   float(np.percentile(bm_final, 5)),
                        "p25":  float(np.percentile(bm_final, 25)),
                        "p50":  float(np.percentile(bm_final, 50)),
                        "p75":  float(np.percentile(bm_final, 75)),
                        "p95":  float(np.percentile(bm_final, 95)),
                        "p99":  float(np.percentile(bm_final, 99)),
                        "mean": float(np.mean(bm_final)),
                        "prob_profit": float(np.mean(bm_final > total_investment)),
                    },
                    "prob_portfolio_beats": prob_beats,
                }

            benchmark_payload = {
                "ticker": compare_ticker,
                "resolved_ticker": resolved_ticker,
                "name": MC_BENCHMARK_NAMES.get(resolved_ticker, resolved_ticker),
                "n_months_used": int(len(bm_rets)),
                "horizons": bm_horizons,
            }

    return jsonify({
        "horizons": result_horizons,
        "benchmark": benchmark_payload,
        "var": {
            "parametric":  {"conf_95": parametric_entry(1.645), "conf_99": parametric_entry(2.326)},
            "monte_carlo": {"conf_95": mc_var_entry(5),         "conf_99": mc_var_entry(1)},
        },
        "total_investment": total_investment,
        "n_simulations":    n_sims,
    })


if __name__ == "__main__":
    # Port 8000 avoids macOS AirPlay/Control Center, which holds :5000.
    app.run(debug=True, host="127.0.0.1", port=8000)
