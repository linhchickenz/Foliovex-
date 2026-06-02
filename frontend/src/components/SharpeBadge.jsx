import { sharpeRating } from '../utils/format'

export default function SharpeBadge({ value }) {
  const rating = sharpeRating(value)
  if (!rating) return null
  return (
    <span className={`sharpe-badge sharpe-badge-${rating.tier}`}>
      {rating.text}
    </span>
  )
}
