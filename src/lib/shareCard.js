// Builds a 1080x1350 share image of a pulled card (canvas, in the design
// system's look) and hands it to the native share sheet, or downloads it
// where sharing files isn't supported. Card images come from the
// pokemontcg.io CDN, which sends CORS headers, so the canvas stays exportable.

const W = 1080
const H = 1350

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

const holo = (ctx, x0, y0, x1, y1) => {
  const gradient = ctx.createLinearGradient(x0, y0, x1, y1)
  gradient.addColorStop(0, '#6ee7f9')
  gradient.addColorStop(0.35, '#a78bfa')
  gradient.addColorStop(0.65, '#f472b6')
  gradient.addColorStop(1, '#fcd34d')
  return gradient
}

/**
 * @param {{ card: object, title: string, subtitle: string, brand: string }} options
 * @returns {Promise<Blob>}
 */
export async function renderShareImage({ card, title, subtitle, brand }) {
  await document.fonts?.ready
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')

  // Night background with the aurora glows
  ctx.fillStyle = '#0a0d1a'
  ctx.fillRect(0, 0, W, H)
  for (const [x, y, r, color] of [
    [900, 150, 520, 'rgba(167, 139, 250, 0.35)'],
    [120, 420, 480, 'rgba(56, 189, 248, 0.28)'],
    [620, 1300, 460, 'rgba(244, 114, 182, 0.22)'],
  ]) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r)
    glow.addColorStop(0, color)
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, W, H)
  }

  // Card with a holo halo
  const img = await loadImage(card.image_url || card.image_small)
  const cardW = 620
  const cardH = Math.round(cardW * (img.height / img.width))
  const cardX = (W - cardW) / 2
  const cardY = 170
  ctx.save()
  ctx.shadowColor = 'rgba(167, 139, 250, 0.8)'
  ctx.shadowBlur = 90
  roundedRect(ctx, cardX, cardY, cardW, cardH, 28)
  ctx.fillStyle = holo(ctx, cardX, cardY, cardX + cardW, cardY + cardH)
  ctx.fill()
  ctx.restore()
  ctx.save()
  roundedRect(ctx, cardX, cardY, cardW, cardH, 26)
  ctx.clip()
  ctx.drawImage(img, cardX, cardY, cardW, cardH)
  ctx.restore()

  // Texts
  ctx.textAlign = 'center'
  ctx.fillStyle = '#eef1fb'
  ctx.font = '800 64px Unbounded, system-ui, sans-serif'
  ctx.fillText(title, W / 2, cardY + cardH + 110, W - 120)
  ctx.fillStyle = holo(ctx, 300, 0, 780, 0)
  ctx.font = '700 38px Manrope, system-ui, sans-serif'
  ctx.fillText(subtitle, W / 2, cardY + cardH + 170, W - 120)
  ctx.fillStyle = '#a6aecb'
  ctx.font = '700 34px Unbounded, system-ui, sans-serif'
  ctx.fillText(brand, W / 2, 100)

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

/**
 * Shares (or downloads) the image.
 * @returns {Promise<'shared'|'downloaded'|'cancelled'>}
 */
export async function shareCard({ card, title, subtitle, brand, text }) {
  const blob = await renderShareImage({ card, title, subtitle, brand })
  const file = new File([blob], `${card.id}.png`, { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text })
      return 'shared'
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled'
    }
  }
  const url = URL.createObjectURL(blob)
  const link = Object.assign(document.createElement('a'), { href: url, download: file.name })
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'downloaded'
}
