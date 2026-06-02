"""
Efficient frontier optimizer.

By default weights are bounded to [0, 1] (no short selling). With
short_selling=True the per-weight bounds are removed entirely (negative
weights allowed) while the sum-to-1 constraint is kept.

Identifies four named portfolios on (or relative to) the frontier:
  • minimum variance portfolio
  • maximum Sharpe ratio portfolio
  • portfolio with the same expected return as the user's original
  • portfolio with the same risk as the user's original (highest return at that risk)
"""
import numpy as np
from scipy.optimize import minimize

ANN_FACTOR = 12


# ── Helpers ──────────────────────────────────────────────────────

def _annualize_ret(m: float) -> float:
    return (1.0 + m) ** ANN_FACTOR - 1.0


def _annualize_vol(m: float) -> float:
    return m * np.sqrt(ANN_FACTOR)


def _sharpe_of(w, mean_m, cov_m, rf_annual) -> float:
    w = np.asarray(w, dtype=float)
    var_m = float(w @ cov_m @ w)
    vol_m = float(np.sqrt(max(var_m, 0.0)))
    ann_v = _annualize_vol(vol_m)
    if ann_v <= 0:
        return -np.inf
    ann_r = _annualize_ret(float(w @ mean_m))
    return (ann_r - rf_annual) / ann_v


def _portfolio_point(w: np.ndarray, mean_m: np.ndarray, cov_m: np.ndarray,
                     rf_annual: float) -> dict:
    w = np.asarray(w, dtype=float)
    ret_m = float(w @ mean_m)
    var_m = float(w @ cov_m @ w)
    vol_m = float(np.sqrt(max(var_m, 0.0)))
    ann_r = _annualize_ret(ret_m)
    ann_v = _annualize_vol(vol_m)
    sharpe = (ann_r - rf_annual) / ann_v if ann_v > 0 else 0.0
    return {
        "weights": [float(x) for x in w],
        "expected_monthly_return": ret_m,
        "monthly_volatility": vol_m,
        "annualized_return": ann_r,
        "annualized_volatility": ann_v,
        "sharpe_ratio": sharpe,
    }


def _solve(objective, n: int, bounds, constraints, warm_starts=None):
    """Multi-start SLSQP. Accepts the lowest-objective candidate that satisfies
    the equality constraints, even if SLSQP reports success=False."""
    candidates = []
    if warm_starts:
        for w in warm_starts:
            candidates.append(np.asarray(w, dtype=float))
    candidates.append(np.ones(n) / n)
    rng = np.random.default_rng(42)
    for _ in range(4):
        candidates.append(rng.dirichlet(np.ones(n)))

    eq_cons = [c for c in constraints if c.get("type") == "eq"]

    best = None
    best_obj = None
    for x0 in candidates:
        try:
            res = minimize(
                objective, x0, method="SLSQP",
                bounds=bounds, constraints=constraints,
                options={"maxiter": 300, "ftol": 1e-10},
            )
        except Exception:
            continue
        if not np.all(np.isfinite(res.x)):
            continue
        # Verify equality constraints are roughly satisfied — SLSQP sometimes
        # returns success=True with significant constraint violations, and
        # sometimes returns success=False from a perfectly fine point.
        ok = True
        for c in eq_cons:
            if abs(float(c["fun"](res.x))) > 1e-4:
                ok = False
                break
        if not ok:
            continue
        obj = float(res.fun)
        if best is None or obj < best_obj:
            best = res
            best_obj = obj
    return best


# ── Main entry point ────────────────────────────────────────────

def compute_frontier(mean_monthly: np.ndarray,
                     cov_monthly: np.ndarray,
                     rf_annual: float,
                     original_weights: np.ndarray,
                     num_points: int = 60,
                     short_selling: bool = False) -> dict:
    mean_m = np.asarray(mean_monthly, dtype=float)
    cov_m = np.asarray(cov_monthly, dtype=float)
    w_orig = np.asarray(original_weights, dtype=float)
    n = len(mean_m)

    # Short selling removes the lower bound on each weight; sum-to-1 stays.
    if short_selling:
        bounds = [(None, None) for _ in range(n)]
    else:
        bounds = [(0.0, 1.0) for _ in range(n)]
    sum_to_one = {"type": "eq", "fun": lambda w: float(np.sum(w) - 1.0)}

    def variance(w):
        return float(w @ cov_m @ w)

    def neg_return(w):
        return float(-(w @ mean_m))

    # ── Min variance ─────────────────────────────────────────────
    min_var_res = _solve(variance, n, bounds, [sum_to_one])
    if min_var_res is None:
        raise RuntimeError("Min-variance optimization failed")
    min_var_w = min_var_res.x

    # ── Max-return endpoint = 100 % in the highest-mean asset ────
    best_ret_idx = int(np.argmax(mean_m))
    max_ret_w = np.zeros(n)
    max_ret_w[best_ret_idx] = 1.0

    min_ret = float(min_var_w @ mean_m)
    max_ret = float(np.max(mean_m))
    # With short selling the GMV return can land above the best single-asset
    # mean; extend the target range upward so the efficient branch still spans.
    if short_selling and max_ret <= min_ret + 1e-9:
        max_ret = min_ret + max(abs(min_ret) * 0.5, 0.01)

    # ── Frontier curve ───────────────────────────────────────────
    # Walk targets from min-variance return up to the top-asset return,
    # warm-starting each successive solve with the previous solution so
    # SLSQP doesn't drift into degenerate corners at high targets.
    curve_pairs = []  # [(weights, point_dict)]
    if max_ret - min_ret < 1e-12:
        # All assets share a return — frontier collapses to a single point.
        curve_pairs.append((min_var_w,
                            _portfolio_point(min_var_w, mean_m, cov_m, rf_annual)))
    else:
        targets = np.linspace(min_ret, max_ret, num_points)
        prev_w = min_var_w
        for target in targets:
            cons = [
                sum_to_one,
                {"type": "eq", "fun": lambda w, t=target: float(w @ mean_m - t)},
            ]
            res = _solve(variance, n, bounds, cons, warm_starts=[prev_w])
            if res is None:
                continue
            prev_w = res.x
            curve_pairs.append((res.x,
                                _portfolio_point(res.x, mean_m, cov_m, rf_annual)))

        # Make sure both endpoints are present — corner solutions can be
        # missed when SLSQP refuses the boundary target.
        first_ret = curve_pairs[0][1]["expected_monthly_return"] if curve_pairs else None
        last_ret = curve_pairs[-1][1]["expected_monthly_return"] if curve_pairs else None
        if first_ret is None or first_ret > min_ret + 1e-7:
            curve_pairs.insert(0,
                (min_var_w, _portfolio_point(min_var_w, mean_m, cov_m, rf_annual)))
        if last_ret is None or last_ret < max_ret - 1e-7:
            curve_pairs.append(
                (max_ret_w, _portfolio_point(max_ret_w, mean_m, cov_m, rf_annual)))

    curve = [pt for (_w, pt) in curve_pairs]

    # ── Max Sharpe ───────────────────────────────────────────────
    # The tangent portfolio lies on the efficient frontier, so the highest-
    # Sharpe point on our discretised curve (plus single-asset corners) is a
    # near-optimal seed. Refine with SLSQP starting from that seed.
    sharpe_seeds = [w for (w, _pt) in curve_pairs]
    for i in range(n):
        e = np.zeros(n)
        e[i] = 1.0
        sharpe_seeds.append(e)
    best_sharpe_w = max(sharpe_seeds,
                        key=lambda w: _sharpe_of(w, mean_m, cov_m, rf_annual))

    def neg_sharpe(w):
        var_w = max(float(w @ cov_m @ w), 1e-18)
        vol_w = np.sqrt(var_w)
        ann_v = _annualize_vol(vol_w)
        if ann_v <= 0:
            return 0.0
        ann_r = _annualize_ret(float(w @ mean_m))
        return -(ann_r - rf_annual) / ann_v

    refined = _solve(neg_sharpe, n, bounds, [sum_to_one],
                     warm_starts=[best_sharpe_w, min_var_w, max_ret_w])
    if refined is not None:
        sh_refined = _sharpe_of(refined.x, mean_m, cov_m, rf_annual)
        sh_seed = _sharpe_of(best_sharpe_w, mean_m, cov_m, rf_annual)
        if sh_refined > sh_seed:
            best_sharpe_w = refined.x

    # ── Same-return / same-risk anchored against the user portfolio ──
    orig_ret = float(w_orig @ mean_m)
    orig_var = float(w_orig @ cov_m @ w_orig)

    same_return_pt = _frontier_at_return(
        orig_ret, mean_m, cov_m, rf_annual, n, bounds, sum_to_one,
        curve_pairs, min_var_w, max_ret_w, min_ret, max_ret,
    )
    same_risk_pt = _frontier_at_risk(
        orig_var, mean_m, cov_m, rf_annual, n, bounds, sum_to_one,
        curve_pairs, min_var_w, max_ret_w,
    )

    max_sharpe_pt = _portfolio_point(best_sharpe_w, mean_m, cov_m, rf_annual)
    orig_pt = _portfolio_point(w_orig, mean_m, cov_m, rf_annual)

    cml = _compute_cml(max_sharpe_pt, orig_pt, rf_annual)

    return {
        "curve": curve,
        "min_variance": _portfolio_point(min_var_w, mean_m, cov_m, rf_annual),
        "max_sharpe": max_sharpe_pt,
        "same_return": same_return_pt,
        "same_risk": same_risk_pt,
        "cml": cml,
    }


# ── Capital Market Line ─────────────────────────────────────────

def _compute_cml(tangency, original, rf_annual):
    """CML = straight line from (0, rf) through the tangency portfolio in
    (annualized vol, annualized return) space. Returns both same-return and
    same-risk anchored CML portfolios as a mix of T-bills + tangency weights.
    Returns None when the tangency Sharpe is non-positive (no CML to draw)."""
    tan_vol = float(tangency["annualized_volatility"])
    tan_ret = float(tangency["annualized_return"])
    if tan_vol <= 0:
        return None
    slope = (tan_ret - rf_annual) / tan_vol
    if slope <= 0:
        return None

    tan_w = list(tangency["weights"])
    orig_ret = float(original["annualized_return"])
    orig_vol = float(original["annualized_volatility"])

    def cml_point(target_vol: float, target_ret: float) -> dict:
        # Fraction w invested in the tangency portfolio; (1-w) in T-bills.
        w_tan = target_vol / tan_vol if tan_vol > 0 else 0.0
        risky_weights = [w_tan * w for w in tan_w]
        t_bill_weight = 1.0 - w_tan
        return {
            "weights": risky_weights,
            "tangency_fraction": w_tan,
            "t_bill_weight": t_bill_weight,
            "annualized_return": target_ret,
            "annualized_volatility": target_vol,
            "sharpe_ratio": slope,
        }

    # Same return as original portfolio (lower risk on the CML if orig > rf).
    same_return = None
    if orig_ret > rf_annual:
        target_vol = (orig_ret - rf_annual) / slope
        same_return = cml_point(target_vol, orig_ret)

    # Same risk as original portfolio (higher return on the CML).
    same_risk = None
    if orig_vol > 0:
        target_ret = rf_annual + slope * orig_vol
        same_risk = cml_point(orig_vol, target_ret)

    return {
        "slope": slope,
        "intercept": rf_annual,
        "tangency_volatility": tan_vol,
        "tangency_return": tan_ret,
        "same_return": same_return,
        "same_risk": same_risk,
    }


# ── Same-return / same-risk solvers ──────────────────────────────

def _frontier_at_return(target_ret, mean_m, cov_m, rf_annual,
                        n, bounds, sum_to_one,
                        curve_pairs, min_var_w, max_ret_w,
                        min_ret, max_ret):
    """Min-variance portfolio whose expected return equals target_ret.
    Clamps to feasible range and falls back to the closest curve point on
    SLSQP failure so the marker always renders."""
    if target_ret <= min_ret + 1e-12:
        return _portfolio_point(min_var_w, mean_m, cov_m, rf_annual)
    if target_ret >= max_ret - 1e-12:
        return _portfolio_point(max_ret_w, mean_m, cov_m, rf_annual)

    def variance(w):
        return float(w @ cov_m @ w)

    cons = [
        sum_to_one,
        {"type": "eq", "fun": lambda w: float(w @ mean_m - target_ret)},
    ]

    closest = min(curve_pairs,
                  key=lambda pair: abs(pair[1]["expected_monthly_return"] - target_ret))
    res = _solve(variance, n, bounds, cons,
                 warm_starts=[closest[0], min_var_w])
    if res is not None:
        return _portfolio_point(res.x, mean_m, cov_m, rf_annual)
    return closest[1]


def _frontier_at_risk(target_var, mean_m, cov_m, rf_annual,
                      n, bounds, sum_to_one,
                      curve_pairs, min_var_w, max_ret_w):
    """Highest-return portfolio whose variance equals target_var.
    Clamps to feasible range and falls back to the closest curve point on
    SLSQP failure."""
    min_var_value = float(min_var_w @ cov_m @ min_var_w)
    # Long-only portfolio variance is bounded above by the largest-variance
    # single asset (variance is convex on the simplex).
    max_var_value = float(np.max(np.diag(cov_m)))

    if target_var <= min_var_value + 1e-18:
        return _portfolio_point(min_var_w, mean_m, cov_m, rf_annual)
    if target_var >= max_var_value - 1e-18:
        max_var_idx = int(np.argmax(np.diag(cov_m)))
        e = np.zeros(len(min_var_w))
        e[max_var_idx] = 1.0
        return _portfolio_point(e, mean_m, cov_m, rf_annual)

    def neg_return(w):
        return float(-(w @ mean_m))

    cons = [
        sum_to_one,
        {"type": "eq", "fun": lambda w: float(w @ cov_m @ w - target_var)},
    ]

    def var_of_pair(pair):
        return pair[1]["monthly_volatility"] ** 2

    closest = min(curve_pairs, key=lambda pair: abs(var_of_pair(pair) - target_var))
    res = _solve(neg_return, n, bounds, cons,
                 warm_starts=[closest[0], max_ret_w])
    if res is not None:
        return _portfolio_point(res.x, mean_m, cov_m, rf_annual)
    return closest[1]
