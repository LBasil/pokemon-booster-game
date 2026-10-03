// Booster sound effects, synthesized with the Web Audio API: no audio files
// to license or download. Every function is a no-op when sound is off or the
// browser has no AudioContext. Call sites pass `enabled` from the settings store.

let ctx = null

function audio() {
  if (typeof window === 'undefined') return null
  const AudioContext = window.AudioContext || window.webkitAudioContext
  if (!AudioContext) return null
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

function noise(ac, duration) {
  const buffer = ac.createBuffer(1, Math.floor(ac.sampleRate * duration), ac.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  const source = ac.createBufferSource()
  source.buffer = buffer
  return source
}

function envelope(ac, gain, start, attack, decay, peak) {
  const node = ac.createGain()
  node.gain.setValueAtTime(0.0001, start)
  node.gain.exponentialRampToValueAtTime(peak * gain, start + attack)
  node.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay)
  return node
}

function tone(ac, { freq, start, duration = 0.25, type = 'sine', peak = 0.2, slideTo }) {
  const osc = ac.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + duration)
  const env = envelope(ac, 1, start, 0.01, duration, peak)
  osc.connect(env).connect(ac.destination)
  osc.start(start)
  osc.stop(start + duration + 0.05)
}

/**
 * Crackle texture of a foil tear: many tiny noise bursts (~2.5ms each) at
 * random times, more and more of them as the strip speeds up, over a faint
 * continuous rip, then one stronger snap as the strip comes off.
 */
function crackles(ac, duration, { from, to }) {
  const rate = ac.sampleRate
  const length = Math.floor(rate * duration)
  const buffer = ac.createBuffer(1, length, rate)
  const data = buffer.getChannelData(0)
  const decay = Math.exp(-1 / (rate * 0.0025))
  const snapAt = Math.floor(length * 0.9)
  let burst = 0
  for (let i = 0; i < length; i++) {
    const t = i / length
    const density = from + (to - from) * t * t // crackles per second, accelerating
    if (Math.random() < density / rate) burst = Math.max(burst, 0.3 + Math.random() * 0.7)
    if (i === snapAt) burst = 1.4
    burst *= decay
    const rip = 0.1 * Math.sin(Math.PI * Math.min(t / 0.9, 1))
    data[i] = (Math.random() * 2 - 1) * (burst + rip)
  }
  const source = ac.createBufferSource()
  source.buffer = buffer
  return source
}

/**
 * Foil tearing, synced with the strip peeling (BoosterPack: 0.15s -> 0.85s,
 * accelerating; lite: 0.2s -> 0.55s). History (user, 2026-10-02): a plain
 * noise sweep at 0.5 was "violent", the same quieter under a 2800 Hz lowpass
 * was "étouffé et sourd". Foil reads as crisp transients in the 2-8 kHz
 * range with gaps between them, so it stays bright without being harsh:
 * highpass the body away, a small presence bump, the fizz above 10 kHz cut.
 * Then (2026-10-03) "baisse le son ou un peu moins aigu": a bit of both,
 * highpass 1400 -> 1200 Hz, bump 4500 -> 3500 Hz, lowpass 10 -> 7.5 kHz, level 0.22 -> 0.17.
 */
export function tear(enabled, { lite = false } = {}) {
  const ac = enabled && audio()
  if (!ac) return
  const now = ac.currentTime + (lite ? 0.2 : 0.15)
  const duration = lite ? 0.36 : 0.7
  const src = crackles(ac, duration, lite ? { from: 150, to: 450 } : { from: 70, to: 380 })
  const low = ac.createBiquadFilter()
  low.type = 'highpass'
  low.frequency.value = 1200
  const presence = ac.createBiquadFilter()
  presence.type = 'peaking'
  presence.frequency.value = 3500
  presence.Q.value = 0.9
  presence.gain.value = 4
  const fizz = ac.createBiquadFilter()
  fizz.type = 'lowpass'
  fizz.frequency.value = 7500
  const level = ac.createGain()
  level.gain.setValueAtTime(0.0001, now)
  level.gain.exponentialRampToValueAtTime(0.17, now + 0.03)
  level.gain.setValueAtTime(0.17, now + duration - 0.05)
  level.gain.exponentialRampToValueAtTime(0.0001, now + duration)
  src.connect(low).connect(presence).connect(fizz).connect(level).connect(ac.destination)
  src.start(now)
  src.stop(now + duration)
}

/**
 * A card flipping: a soft papery "fwip". Band-passed noise sweeping down,
 * highs cut and kept quiet (it plays 10 times a pack: the old bright hiss,
 * high-passed at 1800 Hz, got tiring); a slightly different pitch each card.
 */
export function flip(enabled) {
  const ac = enabled && audio()
  if (!ac) return
  const now = ac.currentTime
  const pitch = 0.9 + Math.random() * 0.2
  const src = noise(ac, 0.16)
  const band = ac.createBiquadFilter()
  band.type = 'bandpass'
  band.Q.value = 0.8
  band.frequency.setValueAtTime(2000 * pitch, now)
  band.frequency.exponentialRampToValueAtTime(800 * pitch, now + 0.12)
  const soft = ac.createBiquadFilter()
  soft.type = 'lowpass'
  soft.frequency.value = 3500
  src.connect(band).connect(soft).connect(envelope(ac, 1, now, 0.015, 0.11, 0.09)).connect(ac.destination)
  src.start(now)
  src.stop(now + 0.16)
}

/** Rare card: a bright two-note chime. */
export function rare(enabled) {
  const ac = enabled && audio()
  if (!ac) return
  const now = ac.currentTime + 0.25
  tone(ac, { freq: 880, start: now, duration: 0.35, type: 'triangle', peak: 0.18 })
  tone(ac, { freq: 1318.5, start: now + 0.09, duration: 0.45, type: 'triangle', peak: 0.16 })
}

/** Hit (ultra/secret): a rising charge, then a sparkly major arpeggio. */
export function hit(enabled, { secret = false } = {}) {
  const ac = enabled && audio()
  if (!ac) return
  const now = ac.currentTime
  tone(ac, { freq: 220, slideTo: 880, start: now, duration: 0.55, type: 'sawtooth', peak: 0.05 })
  const notes = secret ? [523.3, 659.3, 784, 1046.5, 1318.5, 1568] : [523.3, 659.3, 784, 1046.5]
  notes.forEach((freq, i) => tone(ac, { freq, start: now + 0.6 + i * 0.07, duration: 0.6, type: 'triangle', peak: 0.16 }))
}

/** Achievement unlocked: a soft bell pair, then a sparkle on top. */
export function achievement(enabled) {
  const ac = enabled && audio()
  if (!ac) return
  const now = ac.currentTime
  tone(ac, { freq: 987.8, start: now, duration: 0.5, type: 'sine', peak: 0.14 })
  tone(ac, { freq: 1480, start: now + 0.12, duration: 0.7, type: 'sine', peak: 0.12 })
  tone(ac, { freq: 2960, start: now + 0.24, duration: 0.35, type: 'triangle', peak: 0.04 })
}

/** Short vibration pattern for hits (Android; ignored where unsupported). */
export function buzz(enabled, pattern = [30, 40, 60]) {
  if (enabled && typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(pattern)
}
