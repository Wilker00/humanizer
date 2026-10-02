// One timing definition for live playback, fallback scheduling, and export.
// Tone 15 moves an odd sixteenth by 2/3 of its length times Transport.swing.
const TONE_SWING_SCALE = 0.65;

export function normalizedBpm(value) {
  const bpm = Number(value);
  return Number.isFinite(bpm) && bpm > 0 ? Math.max(40, Math.min(240, bpm)) : 92;
}

export function sixteenthSeconds(bpm) {
  return 15 / normalizedBpm(bpm);
}

export function toneSwingAmount(swing) {
  const value = Number(swing);
  return (Number.isFinite(value) ? Math.max(0, Math.min(60, value)) : 0) / 100 * TONE_SWING_SCALE;
}

export function swingOffsetSeconds(step, bpm, swing) {
  return step % 2 === 1 ? sixteenthSeconds(bpm) * (2 / 3) * toneSwingAmount(swing) : 0;
}

export function stepOffsetSeconds(step, bpm, swing) {
  return step * sixteenthSeconds(bpm) + swingOffsetSeconds(step, bpm, swing);
}

export function melodyDurationSeconds(width, bpm) {
  const step = sixteenthSeconds(bpm);
  return Math.max(step * 0.75, Number(width) * step * 0.92);
}

export function melodyGain(step, trackVolume, velocity = 1) {
  const accent = step % 8 === 0 ? 1 : step % 4 === 0 ? 0.84 : 0.66;
  const vel = Number.isFinite(Number(velocity)) ? Math.max(0, Math.min(1, Number(velocity))) : 1;
  return 0.14 * accent * trackVolume * vel;
}

export function stepsPerBar(meter = '4/4') {
  return meter === '3/4' || meter === '6/8' ? 12 : 16;
}

export function patternLoopSteps(bars = 1, meter = '4/4') {
  return stepsPerBar(meter) * Math.max(1, Math.min(8, Number(bars) || 1));
}

export function rollGainMultiplier(roll, index) {
  return roll > 1 ? 0.85 + 0.15 * (index / roll) : 1;
}

export function beatsPerBar(meter = '4/4') {
  if (meter === '3/4') return 3;
  if (meter === '6/8') return 6;
  return 4;
}

export function defaultTransport() {
  return {
    loopEnabled: false,
    loopStartBar: 0,
    loopEndBar: null,
    seekBar: 0,
    playFromSelection: true,
    zoom: 1,
    snap: 'bar',
    exportFromBar: 0,
    exportToBar: null
  };
}

export function normalizeTransport(raw, totalBars = 1) {
  const base = defaultTransport();
  if (!raw || typeof raw !== 'object') {
    base.loopEndBar = Math.max(1, totalBars);
    return base;
  }
  const total = Math.max(1, Number(totalBars) || 1);
  const loopStart = Math.max(0, Math.min(total - 1 / 16, Number(raw.loopStartBar) || 0));
  let loopEnd = raw.loopEndBar == null ? total : Number(raw.loopEndBar);
  if (!Number.isFinite(loopEnd)) loopEnd = total;
  loopEnd = Math.max(loopStart + 1 / 16, Math.min(total, loopEnd));
  return {
    loopEnabled: !!raw.loopEnabled,
    loopStartBar: loopStart,
    loopEndBar: loopEnd,
    seekBar: Math.max(0, Math.min(total, Number(raw.seekBar) || 0)),
    playFromSelection: raw.playFromSelection !== false,
    zoom: Math.max(0.5, Math.min(8, Number(raw.zoom) || 1)),
    snap: ['off', 'bar', 'beat', '1/2', '1/16'].includes(raw.snap) ? raw.snap : 'bar',
    exportFromBar: Math.max(0, Number(raw.exportFromBar) || 0),
    exportToBar: raw.exportToBar == null ? null : Math.max(0, Number(raw.exportToBar))
  };
}

/** Convert song bar (+ optional fraction) to sequence step index. */
export function barToStep(songBar, meter = '4/4') {
  const perBar = stepsPerBar(meter);
  return Math.max(0, Math.round(Number(songBar) * perBar));
}

export function stepToBar(step, meter = '4/4') {
  const perBar = stepsPerBar(meter);
  return (Number(step) || 0) / perBar;
}

/**
 * Next step after advance, respecting optional loop region in song mode.
 * loopStart/loopEnd are in bars; steps are absolute song steps.
 */
export function nextPlaybackStep(step, {
  loopSteps,
  songMode = false,
  loopEnabled = false,
  loopStartBar = 0,
  loopEndBar = null,
  meter = '4/4'
} = {}) {
  const next = (Number(step) || 0) + 1;
  const total = Math.max(1, Number(loopSteps) || 1);
  if (!songMode || !loopEnabled) return next % total;
  const perBar = stepsPerBar(meter);
  const startStep = Math.max(0, Math.floor(loopStartBar * perBar));
  const endBar = loopEndBar == null ? total / perBar : loopEndBar;
  const endStep = Math.max(startStep + 1, Math.min(total, Math.ceil(endBar * perBar)));
  if (next >= endStep) return startStep;
  if (next < startStep) return startStep;
  return next;
}

export function clampExportRange(fromBar, toBar, totalBars) {
  const total = Math.max(1, Number(totalBars) || 1);
  let from = Math.max(0, Math.floor(Number(fromBar) || 0));
  let to = toBar == null || toBar === '' ? total : Math.ceil(Number(toBar));
  if (!Number.isFinite(to)) to = total;
  to = Math.max(from + 1, Math.min(total, to));
  from = Math.min(from, to - 1);
  return { fromBar: from, toBar: to };
}
