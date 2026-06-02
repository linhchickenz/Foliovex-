/**
 * Display formatters shared across result components.
 * All percentage helpers expect decimals (0.0512 → "5.12%").
 */

// Always "US$" or "CA$" — never rely on Intl to add the right prefix,
// because some locales/runtimes emit bare "$" for USD.
const currencyPrefix = (currency) => currency === 'CAD' ? 'CA$' : 'US$'

export const fmtCurrency = (amount, currency, decimals = 0) => {
  if (amount == null || isNaN(amount)) return '—'
  const num = new Intl.NumberFormat('en-CA', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount)
  return `${currencyPrefix(currency)}${num}`
}

export const fmtPct = (value, digits = 2) => {
  if (value == null || isNaN(value)) return '—'
  return `${(value * 100).toFixed(digits)}%`
}

export const fmtPctSigned = (value, digits = 2) => {
  if (value == null || isNaN(value)) return '—'
  const sign = value >= 0 ? '+' : ''
  return `${sign}${(value * 100).toFixed(digits)}%`
}

export const fmtNum = (value, digits = 2) => {
  if (value == null || isNaN(value)) return '—'
  return value.toFixed(digits)
}

export const fmtSharpe = (value) => {
  if (value == null || isNaN(value)) return '—'
  return (value >= 0 ? '+' : '') + value.toFixed(2)
}

export const sharpeRating = (value) => {
  if (value == null || isNaN(value)) return null
  if (value < 1.0) return { text: 'Bad',       tier: 'bad'       }
  if (value < 2.0) return { text: 'Good',       tier: 'good'      }
  if (value < 3.0) return { text: 'Very Good',  tier: 'great'     }
  return                   { text: 'Excellent',  tier: 'excellent' }
}

export const fmtDollarReturn = (amount, rate, currency) => {
  if (amount == null || isNaN(amount) || rate == null || isNaN(rate)) return null
  const dollar = amount * rate
  const abs = new Intl.NumberFormat('en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(dollar))
  const sign = dollar >= 0 ? '+' : '-'
  return `${sign}${currencyPrefix(currency)}${abs}`
}
