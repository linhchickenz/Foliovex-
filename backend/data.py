"""
Data fetching: yfinance prices, currency conversion, live risk-free rates.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
import warnings

import numpy as np
import pandas as pd
import requests
import yfinance as yf

warnings.filterwarnings("ignore", category=FutureWarning)

PERIOD = "5y"           # up to 60 months
INTERVAL = "1mo"

# Fallback rates if API fetch fails. Decimal form (4.5% = 0.045).
FALLBACK_RF_USD = 0.045
FALLBACK_RF_CAD = 0.045


# ── Price + currency ─────────────────────────────────────────────

def _normalize_monthly_index(series: pd.Series) -> pd.Series:
    """Force any monthly time series onto a stable month-start index."""
    s = series.copy()
    if s.index.tz is not None:
        s.index = s.index.tz_localize(None)
    s.index = s.index.to_period("M").to_timestamp()
    s = s[~s.index.duplicated(keep="last")]
    return s.sort_index()


def _native_currency(ticker_obj) -> str:
    """Best-effort native-currency lookup. Defaults to USD on any failure."""
    try:
        fi = ticker_obj.fast_info
        cur = getattr(fi, "currency", None)
        if cur:
            return str(cur).upper()
        if hasattr(fi, "get"):
            cur = fi.get("currency")
            if cur:
                return str(cur).upper()
    except Exception:
        pass
    try:
        cur = ticker_obj.info.get("currency")
        if cur:
            return str(cur).upper()
    except Exception:
        pass
    return "USD"


def _fetch_one(ticker: str):
    """Fetch one ticker → (ticker, monthly Close Series, native currency) or None on failure."""
    try:
        t = yf.Ticker(ticker)
        hist = t.history(period=PERIOD, interval=INTERVAL, auto_adjust=True)
        if hist is None or hist.empty or "Close" not in hist.columns:
            return ticker, None, None
        close = _normalize_monthly_index(hist["Close"].dropna())
        if len(close) < 3:
            return ticker, None, None
        return ticker, close, _native_currency(t)
    except Exception:
        return ticker, None, None


def _fetch_fx_series(pair: str):
    """Fetch a yfinance FX pair like 'CADUSD=X' as a monthly Close series."""
    try:
        hist = yf.Ticker(pair).history(period=PERIOD, interval=INTERVAL, auto_adjust=False)
        if hist is None or hist.empty:
            return None
        return _normalize_monthly_index(hist["Close"].dropna())
    except Exception:
        return None


def _convert_series(close: pd.Series, native: str, target: str,
                    fx_cache: dict) -> pd.Series:
    """Convert a price series from `native` to `target` currency using cached FX series."""
    if native == target:
        return close

    pair = f"{native}{target}=X"
    if pair not in fx_cache:
        fx = _fetch_fx_series(pair)
        if fx is None:
            # Try the inverse pair and reciprocate
            inv = _fetch_fx_series(f"{target}{native}=X")
            fx = (1.0 / inv) if inv is not None else None
        fx_cache[pair] = fx

    fx = fx_cache[pair]
    if fx is None:
        # Couldn't get FX → return unconverted but flag via NaN to drop downstream
        return close * np.nan

    aligned = fx.reindex(close.index, method="ffill").bfill()
    return close * aligned


def fetch_price_data(tickers, target_currency: str):
    """
    Fetch monthly adjusted closing prices for `tickers`, converted to `target_currency`.

    Returns:
      prices_df  — DataFrame indexed by month-start, columns = valid tickers (in input order)
      valid     — list of tickers that returned usable data
      failed    — list of tickers that failed (no data, FX unavailable, etc.)
      native    — dict ticker → native currency
    """
    target_currency = target_currency.upper()
    if target_currency not in ("USD", "CAD"):
        raise ValueError(f"Unsupported target currency: {target_currency}")

    # Parallel-fetch every ticker
    fetched = {}
    with ThreadPoolExecutor(max_workers=min(10, max(1, len(tickers)))) as pool:
        futures = {pool.submit(_fetch_one, t): t for t in tickers}
        for fut in as_completed(futures):
            t, close, native = fut.result()
            if close is not None:
                fetched[t] = (close, native)

    # Currency-convert in main thread (FX series cached so we fetch each pair once)
    fx_cache = {}
    series_by_ticker = {}
    natives = {}
    for t in tickers:  # preserve user-supplied order
        if t not in fetched:
            continue
        close, native = fetched[t]
        natives[t] = native
        converted = _convert_series(close, native, target_currency, fx_cache)
        converted = converted.dropna()
        if len(converted) >= 3:
            series_by_ticker[t] = converted

    valid = list(series_by_ticker.keys())
    failed = [t for t in tickers if t not in valid]

    if not valid:
        raise ValueError("No usable price data could be fetched for any of the given tickers.")

    prices = pd.DataFrame(series_by_ticker).sort_index()
    return prices, valid, failed, natives


# ── Risk-free rate ───────────────────────────────────────────────

def _fetch_us_tbill_rate() -> float:
    """3-month Treasury Bill rate from the US Treasury fiscal data API.
    Returns annualized decimal (e.g. 0.0512 for 5.12%)."""
    url = (
        "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/"
        "accounting/od/avg_interest_rates"
        "?filter=security_desc:eq:Treasury%20Bills"
        "&sort=-record_date&page[size]=1"
    )
    resp = requests.get(url, timeout=12)
    resp.raise_for_status()
    payload = resp.json()
    rate_pct = float(payload["data"][0]["avg_interest_rate_amt"])
    return rate_pct / 100.0


def _fetch_canada_tbill_rate() -> float:
    """3-month T-Bill yield from the Bank of Canada Valet API (series V80691345)."""
    url = "https://www.bankofcanada.ca/valet/observations/V80691345/json?recent=10"
    resp = requests.get(url, timeout=12)
    resp.raise_for_status()
    obs = resp.json().get("observations", [])
    for row in reversed(obs):  # most recent first after reverse
        v = row.get("V80691345", {}).get("v")
        if v not in (None, "", "NaN"):
            return float(v) / 100.0
    raise ValueError("No recent observation in Bank of Canada response")


# Preferred total-return tickers → fallback chain (string = single fallback, list = ordered chain).
_BENCHMARK_FALLBACKS = {
    "^SP500TR":    "^GSPC",
    "^SPTSXCATR":  "^GSPTSE",
    "^TXTY":       ["^SPTSE60", "XIU.TO"],
}


def _benchmark_metrics(ticker: str, target_currency: str,
                        common_index, rf_annual: float):
    """Core calculation for one ticker. Returns dict or None on failure."""
    _, close, native = _fetch_one(ticker)
    if close is None:
        return None

    fx_cache = {}
    converted = _convert_series(close, native, target_currency.upper(), fx_cache)
    converted = converted.dropna()
    if len(converted) < 3:
        return None

    rets = converted.pct_change().dropna()
    aligned = rets.reindex(common_index)
    available = aligned.dropna()
    if len(available) < 3:
        return None

    mean_m = float(available.mean())
    std_m = float(available.std(ddof=1))
    ann_r = float((1.0 + mean_m) ** 12 - 1.0)
    ann_v = float(std_m * np.sqrt(12))
    sharpe = float((ann_r - rf_annual) / ann_v) if ann_v > 0 else 0.0

    monthly_rets = [
        float(x) if (x is not None and not np.isnan(float(x))) else 0.0
        for x in aligned.values
    ]

    return {
        "ticker": ticker,
        "expected_monthly_return": mean_m,
        "monthly_volatility": std_m,
        "annualized_return": ann_r,
        "annualized_volatility": ann_v,
        "sharpe_ratio": sharpe,
        "n_months": int(len(available)),
        "monthly_returns": monthly_rets,
    }


def fetch_benchmark_data(ticker: str, target_currency: str,
                         common_index, rf_annual: float):
    """
    Fetch benchmark ticker metrics aligned to the portfolio's common window.
    Tries the primary ticker first, then walks the fallback chain in _BENCHMARK_FALLBACKS.
    Preserves the originally-requested ticker in the result so the frontend name lookup works.
    Returns dict or None on complete failure.
    """
    result = _benchmark_metrics(ticker, target_currency, common_index, rf_annual)
    if result is not None:
        return result

    chain = _BENCHMARK_FALLBACKS.get(ticker)
    if chain is None:
        return None

    if isinstance(chain, str):
        chain = [chain]

    for fallback in chain:
        print(f"[benchmark] {ticker} returned no data; trying fallback {fallback}")
        result = _benchmark_metrics(fallback, target_currency, common_index, rf_annual)
        if result is not None:
            result["ticker"] = ticker
            return result

    return None


def fetch_market_monthly_returns(ticker: str, target_currency: str):
    """Monthly returns for a market index in `target_currency`, or None on failure.
    Used as the regressor for CAPM beta."""
    _, close, native = _fetch_one(ticker)
    if close is None:
        return None
    fx_cache = {}
    converted = _convert_series(close, native, target_currency.upper(), fx_cache)
    converted = converted.dropna()
    if len(converted) < 3:
        return None
    return converted.pct_change().dropna()


def fetch_risk_free_rate(currency: str) -> tuple[float, str]:
    """Returns (annualized_rate_decimal, source_label). Falls back on API failure."""
    currency = currency.upper()
    try:
        if currency == "USD":
            return _fetch_us_tbill_rate(), "US Treasury (avg T-Bill rate)"
        if currency == "CAD":
            return _fetch_canada_tbill_rate(), "Bank of Canada (3-month T-Bill yield)"
    except Exception as e:
        # Fall through to the default
        print(f"[risk-free] {currency} fetch failed ({e}); using fallback")

    fallback = FALLBACK_RF_USD if currency == "USD" else FALLBACK_RF_CAD
    return fallback, f"fallback ({currency})"
