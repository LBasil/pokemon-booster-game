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

/** Foil tearing: a band-passed noise burst sweeping upward. */
export function tear(enabled) {
  const ac = enabled && audio()
  if (!ac) return
  const now = ac.currentTime + 0.15 // lines up with the strip starting to peel
  const src = noise(ac, 0.6)
  const filter = ac.createBiquadFilter()
  filter.type = 'bandpass'
  filter.Q.value = 1.2
  filter.frequency.setValueAtTime(900, now)
  filter.frequency.exponentialRampToValueAtTime(4200, now + 0.55)
  src.connect(filter).connect(envelope(ac, 1, now, 0.05, 0.5, 0.5)).connect(ac.destination)
  src.start(now)
  src.stop(now + 0.6)
}

/** A card flipping: short airy swish. */
export function flip(enabled) {
  const ac = enabled && audio()
  if (!ac) return
  const now = ac.currentTime
  const src = noise(ac, 0.18)
  const filter = ac.createBiquadFilter()
  filter.type = 'highpass'
  filter.frequency.value = 1800
  src.connect(filter).connect(envelope(ac, 1, now, 0.02, 0.14, 0.25)).connect(ac.destination)
  src.start(now)
  src.stop(now + 0.2)
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
