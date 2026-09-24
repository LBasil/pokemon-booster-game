const UNITS = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

/**
 * "3 minutes ago" / "il y a 3 minutes", localized. Under a minute: "now".
 * @param {string|Date} date
 * @param {string} locale
 * @param {Date} [now]
 */
export function timeAgo(date, locale, now = new Date()) {
  const seconds = Math.round((new Date(date).getTime() - now.getTime()) / 1000)
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.trunc(seconds / size), unit)
  }
  return format.format(0, 'second')
}
