"""
Per-stock and portfolio metrics. All calculations driven by monthly returns.
"""
import numpy as np
import pandas as pd

ANN_FACTOR = 12  # monthly → annual

# Data-quality thresholds. Returns above these get a non-fatal flag in the
# per-stock payload so the frontend can warn the user (often caused by
# unadjusted splits, IPO-era price spikes, or genuinely volatile names).
SUSPICIOUS_ANNUAL_RETURN = 1.0   # |ann_r| ≥ 100%
SUSPICIOUS_MONTHLY_RETURN = 0.75  # any single-month move ≥ 75%


def calc_returns(prices: pd.DataFrame) -> pd.DataFrame:
    """Simple monthly returns. Drops the first NaN row."""
    return prices.pct_change().dropna(how="all")


def _annualize_return(monthly_return: float) -> float:
    # Geometric compounding: (1 + r_monthly)^12 - 1
    return (1.0 + monthly_return) ** ANN_FACTOR - 1.0


def _annualize_vol(monthly_vol: float) -> float:
    return monthly_vol * np.sqrt(ANN_FACTOR)


def _data_quality_flags(monthly_returns: pd.Series, ann_r: float) -> list:
    flags = []
    max_abs_m = float(monthly_returns.abs().max())
    if max_abs_m >= SUSPICIOUS_MONTHLY_RETURN:
        flags.append(
            f"single-month move of {max_abs_m * 100:.1f}% detected "
            f"— possible unadjusted split or data anomaly"
        )
    if abs(ann_r) >= SUSPICIOUS_ANNUAL_RETURN:
        flags.append(
            f"annualized return of {ann_r * 100:.1f}% is unusually high "
            f"— verify the price history before relying on this estimate"
        )
    return flags


def calc_per_stock_metrics(returns: pd.DataFrame, rf_annual: float) -> dict:
    """One entry per ticker. Each ticker is computed on its OWN observation window."""
    out = {}
    for ticker in returns.columns:
        r = returns[ticker].dropna()
        if len(r) < 2:
            continue
        mean_m = float(r.mean())
        std_m = float(r.std(ddof=1))
        ann_r = _annualize_return(mean_m)
        ann_v = _annualize_vol(std_m)
        sharpe = (ann_r - rf_annual) / ann_v if ann_v > 0 else 0.0
        out[ticker] = {
            "expected_monthly_return": mean_m,
            "annualized_return": ann_r,
            "monthly_volatility": std_m,
            "annualized_volatility": ann_v,
            "sharpe_ratio": sharpe,
            "n_months": int(len(r)),
            "data_quality_flags": _data_quality_flags(r, ann_r),
        }
    return out


def aligned_returns(returns: pd.DataFrame) -> pd.DataFrame:
    """Drop any month where any ticker is missing.
    Used so the covariance matrix is positive semidefinite."""
    return returns.dropna(how="any")


def calc_portfolio_metrics(weights: np.ndarray,
                           mean_monthly: np.ndarray,
                           cov_monthly: np.ndarray,
                           rf_annual: float) -> dict:
    weights = np.asarray(weights, dtype=float)
    p_ret_m = float(weights @ mean_monthly)
    p_var_m = float(weights @ cov_monthly @ weights)
    p_vol_m = float(np.sqrt(max(p_var_m, 0.0)))

    ann_r = _annualize_return(p_ret_m)
    ann_v = _annualize_vol(p_vol_m)
    sharpe = (ann_r - rf_annual) / ann_v if ann_v > 0 else 0.0

    return {
        "expected_monthly_return": p_ret_m,
        "monthly_volatility": p_vol_m,
        "annualized_return": ann_r,
        "annualized_volatility": ann_v,
        "sharpe_ratio": sharpe,
    }


def calc_capm(common_returns: pd.DataFrame,
              market_monthly_returns: pd.Series,
              rf_annual: float) -> dict:
    """CAPM per-stock metrics on the portfolio's common observation window.

    For each ticker we regress its monthly return against the market index
    monthly return to estimate beta (= Cov(stock, market) / Var(market)),
    then compute CAPM expected return and alpha. The CAPM monthly mean
    vector is what /api/analyze uses to build the CAPM portfolio + frontier.

    Returns None if there isn't enough overlap with the market series.
    """
    if market_monthly_returns is None:
        return None

    aligned = common_returns.join(
        market_monthly_returns.rename("__mkt__"), how="inner"
    ).dropna()
    if len(aligned) < 6:
        return None

    mkt = aligned["__mkt__"]
    mkt_mean_m = float(mkt.mean())
    mkt_var_m = float(mkt.var(ddof=1))
    if mkt_var_m <= 0:
        return None

    market_return_annual = _annualize_return(mkt_mean_m)
    mkt_centered = mkt - mkt.mean()

    per_stock = {}
    mean_monthly_capm = []
    for ticker in common_returns.columns:
        r = aligned[ticker]
        cov_sm = float(((r - r.mean()) * mkt_centered).sum() / (len(r) - 1))
        beta = cov_sm / mkt_var_m
        capm_ann = rf_annual + beta * (market_return_annual - rf_annual)
        hist_ann = _annualize_return(float(r.mean()))
        alpha = hist_ann - capm_ann
        # Back out the monthly mean used in (cov, mean) frontier optimization.
        capm_monthly = (1.0 + capm_ann) ** (1.0 / ANN_FACTOR) - 1.0
        # Specific (unsystematic) risk: residual variance after removing market factor.
        total_var_m = float(r.var(ddof=1))
        specific_var_m = max(total_var_m - beta ** 2 * mkt_var_m, 0.0)
        specific_risk_ann = float(np.sqrt(specific_var_m * ANN_FACTOR))
        per_stock[ticker] = {
            "beta": float(beta),
            "capm_return": float(capm_ann),
            "alpha": float(alpha),
            "market_return_used": float(market_return_annual),
            "specific_variance": specific_var_m,   # monthly, used for portfolio aggregation
            "specific_risk": specific_risk_ann,     # annualized %
        }
        mean_monthly_capm.append(capm_monthly)

    return {
        "per_stock": per_stock,
        "mean_monthly_capm": np.array(mean_monthly_capm, dtype=float),
        "market_return_annual": float(market_return_annual),
        "mkt_var_m": float(mkt_var_m),
        "n_months_used": int(len(aligned)),
    }


def calc_correlation(returns: pd.DataFrame) -> dict:
    aligned = aligned_returns(returns)
    if aligned.empty:
        # fall back to pairwise if there is no row where every ticker has data
        aligned = returns
    corr = aligned.corr()
    matrix = corr.fillna(0.0).values
    # nan-safe rounding for transport
    matrix = np.where(np.isfinite(matrix), matrix, 0.0)
    return {
        "tickers": list(corr.columns),
        "matrix": [[float(x) for x in row] for row in matrix],
    }
