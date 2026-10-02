/**
 * Playback math for the sampler, synth patch, EQ bands, and tempo-following loops.
 * No interface. Callers already store these values on the track or clip.
 */

const PITCHES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };

export function midiNumber(note) {
  const match = String(note || '').match(/^([A-G](?:#|b)?)(-?\d+)$/);
  if (!match) return null;
  const pc = FLATS[match[1]] || match[1];
  const index = PITCHES.indexOf(pc);
  if (index < 0) return null;
  return (Number(match[2]) + 1) * 12 + index;
}

export function samplerPlaybackRate(note, rootKey = 'C4') {
  const played = midiNumber(note);
  const root = midiNumber(rootKey);
  if (played == null || root == null) return 1;
  return Math.max(0.25, Math.min(4, 2 ** ((played - root) / 12)));
}

export function noteInKeyRange(note, lowKey = 'C2', highKey = 'C6') {
  const played = midiNumber(note);
  const low = midiNumber(lowKey);
  const high = midiNumber(highKey);
  if (played == null || low == null || high == null) return false;
  return played >= Math.min(low, high) && played <= Math.max(low, high);
}

export function patchIsCustom(patch, base) {
  if (!patch || !base) return false;
  return ['attack', 'decay', 'sustain', 'release', 'filterHz', 'drive', 'unison'].some(key => {
    return Math.abs((Number(patch[key]) || 0) - (Number(base[key]) || 0)) > 0.001;
  });
}

/** Beats/tones follow the project tempo. Off leaves the file at its recorded speed. */
export function warpPlaybackRate({ warpMode = 'off', sourceBpm = 120, projectBpm = 120 } = {}) {
  if (warpMode !== 'beats' && warpMode !== 'tones') return 1;
  const source = Math.max(40, Math.min(240, Number(sourceBpm) || 120));
  const project = Math.max(40, Math.min(240, Number(projectBpm) || source));
  return Math.max(0.25, Math.min(4, project / source));
}

export function clipPlaybackRate(clip, projectBpm, chainRate = 1) {
  const warp = warpPlaybackRate({
    warpMode: clip?.warpMode,
    sourceBpm: clip?.sourceBpm,
    projectBpm
  });
  return Math.max(0.25, Math.min(4, (Number(chainRate) || 1) * warp));
}

/**
 * Independent lowshelf / peak / highshelf gains in dB.
 * A single amount still tilts all three when the bands are absent.
 */
export function eqBandsDb(params = {}, amount = 0.5) {
  const has = key => params?.[key] != null && Number.isFinite(Number(params[key]));
  const db = key => Math.max(-12, Math.min(12, Number(params[key]) || 0));
  if (has('low') || has('mid') || has('high')) {
    return {
      low: has('low') ? db('low') : 0,
      mid: has('mid') ? db('mid') : 0,
      high: has('high') ? db('high') : 0
    };
  }
  const tilt = (Number(amount) - 0.5) * 24;
  return { low: tilt * 0.65, mid: tilt * 0.35, high: tilt };
}

export function applyEnvelope(param, { peak = 0.2, attack = 0.01, decay = 0.2, sustain = 0.7, release = 0.35, when = 0, duration = 0.3 } = {}) {
  if (!param?.setValueAtTime) return;
  const a = Math.max(0.001, Number(attack) || 0.01);
  const d = Math.max(0.001, Number(decay) || 0.2);
  const s = Math.max(0, Math.min(1, Number(sustain) || 0));
  const r = Math.max(0.001, Number(release) || 0.35);
  const hold = Math.max(0.02, Number(duration) || 0.3);
  const level = Math.max(0.0001, Number(peak) || 0.0001);
  const start = Math.max(0, Number(when) || 0);
  const peakAt = start + Math.min(a, hold);
  const decayAt = Math.min(start + hold, peakAt + d);
  const sustainLevel = Math.max(0.0001, level * s);
  try {
    param.cancelScheduledValues(start);
    param.setValueAtTime(0.0001, start);
    param.linearRampToValueAtTime(level, peakAt);
    param.linearRampToValueAtTime(sustainLevel, Math.max(peakAt + 0.001, decayAt));
    param.setValueAtTime(sustainLevel, start + hold);
    param.exponentialRampToValueAtTime(0.0001, start + hold + r);
  } catch {
    param.value = level;
  }
}

/**
 * Guess a loop tempo from an energy envelope. Returns null when the pulse is weak.
 */
export function estimateLoopBpm(samples, sampleRate) {
  if (!samples?.length || !(sampleRate > 0)) return null;
  const hop = Math.max(1, Math.floor(sampleRate / 200));
  const env = [];
  for (let i = 0; i < samples.length; i += hop) {
    let sum = 0;
    const end = Math.min(samples.length, i + hop);
    for (let j = i; j < end; j++) sum += samples[j] * samples[j];
    env.push(Math.sqrt(sum / Math.max(1, end - i)));
  }
  if (env.length < 16) return null;
  const envRate = sampleRate / hop;
  const minLag = Math.max(1, Math.floor(envRate * 60 / 180));
  const maxLag = Math.min(env.length - 2, Math.floor(envRate * 60 / 70));
  let best = 0;
  let bestLag = 0;
  let total = 0;
  let count = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    const limit = env.length - lag;
    for (let i = 0; i < limit; i += 2) corr += env[i] * env[i + lag];
    total += corr;
    count += 1;
    if (corr > best) {
      best = corr;
      bestLag = lag;
    }
  }
  if (!bestLag || !count || best < (total / count) * 1.08) return null;
  let bpm = 60 / (bestLag / envRate);
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  return Math.round(bpm);
}
