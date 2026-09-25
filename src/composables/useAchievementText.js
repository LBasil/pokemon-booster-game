import { useI18n } from 'vue-i18n'

// Visible texts of an achievement (from utils/achievements.js), shared by the
// tiles and the search. Hidden ones stay "???" until unlocked.
export function useAchievementText() {
  const { t, locale } = useI18n()

  const number = (value) => value.toLocaleString(locale.value)
  const euros = (value) =>
    new Intl.NumberFormat(locale.value, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value)

  const secret = (item) => item.hidden && !item.unlocked

  // Region and type names are translated; the rest goes in as is
  function params(item) {
    const { region, type, ...rest } = item.params
    return {
      count: number(item.target),
      amount: euros(item.target),
      ...rest,
      ...(region && { region: t(`achievements.regions.${region}`) }),
      ...(type && { type: t(`collection.types.${type}`) }),
    }
  }

  const title = (item) =>
    secret(item)
      ? t('achievements.ui.hiddenTitle')
      : t(item.title.startsWith('items.') ? `achievements.${item.title}.title` : `achievements.${item.title}`, params(item))

  const desc = (item) => (secret(item) ? t('achievements.ui.hiddenDesc') : t(`achievements.desc.${item.desc}`, params(item), item.target))

  const percent = (value) => new Intl.NumberFormat(locale.value, { style: 'percent' }).format(value / 100)
  const format = (item) => (item.money ? euros : item.percent ? percent : number)
  const progress = (item) => `${format(item)(item.current)} / ${format(item)(item.target)}`

  // Share of players holding it (rateOf): "12% of players", "Less than 1%", "No one yet"
  const rate = (value) => {
    if (value === 0) return t('achievements.ui.rateNobody')
    if (value < 1) return t('achievements.ui.rateUnder1')
    const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value)
    return t('achievements.ui.rate', { rate: rounded.toLocaleString(locale.value) })
  }

  return { title, desc, progress, secret, number, rate }
}
