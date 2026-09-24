const clamp01 = (value) => Math.min(1, Math.max(0, value))

/**
 * Maps a pointer position inside an element to a 3D tilt + a highlight position.
 * The card "leans away" from the pointer, and the shine follows it.
 * @param {number} x - pointer x relative to the element's left edge (px)
 * @param {number} y - pointer y relative to the element's top edge (px)
 * @param {number} width - element width (px)
 * @param {number} height - element height (px)
 * @param {number} [maxTilt=14] - max rotation in degrees on each axis
 * @returns {{ rx: number, ry: number, mx: number, my: number }} rotations in
 *   degrees, and the pointer position as a percentage (0–100) of the element
 */
export function tiltFromPointer(x, y, width, height, maxTilt = 14) {
  if (!width || !height) return { rx: 0, ry: 0, mx: 50, my: 50 }

  const px = clamp01(x / width)
  const py = clamp01(y / height)

  return {
    rx: round((0.5 - py) * 2 * maxTilt),
    ry: round((px - 0.5) * 2 * maxTilt),
    mx: round(px * 100),
    my: round(py * 100),
  }
}

const round = (value) => Math.round(value * 100) / 100 + 0
