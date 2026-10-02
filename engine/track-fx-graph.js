/**
 * Track insert FX shared by live playback, offline export, and unit tests.
 * Types here are the only inserts the mixer is allowed to add.
 */

import { eqBandsDb } from './voice-engine.js';

export const WIRED_FX_TYPES = ['eq', 'compress', 'saturator', 'chorus', 'filter', 'utility'];

export function isWiredFxType(type) {
  return WIRED_FX_TYPES.includes(type);
}

export function fxAmount(fx) {
  const raw = fx?.params?.amount ?? fx?.params?.drive ?? 0.5;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

export function activeInserts(chain = []) {
  return (chain || []).filter(fx => fx && !fx.bypass && isWiredFxType(fx.type));
}

/** Audible fader after mute, solo, and automation. Group buses apply on top. */
export function channelAudibleGain({
  vol = 0.75,
  mute = false,
  solo = false,
  anySolo = false,
  automation = 1
} = {}) {
  if (mute) return 0;
  if (anySolo && !solo) return 0;
  return Math.max(0, Number(vol) || 0) * Math.max(0, Number(automation) || 0);
}

function saturationCurve(amount) {
  const samples = 256;
  const curve = new Float32Array(samples);
  const drive = 1 + amount * 10;
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive);
  }
  return curve;
}

/**
 * Connect `input` through the insert chain. Returns the wet output node.
 * `ctx` is an AudioContext or OfflineAudioContext.
 */
export function connectFxChain(ctx, input, chain = []) {
  let node = input;
  const stops = [];
  for (const fx of activeInserts(chain)) {
    const stage = createFxStage(ctx, fx);
    node.connect(stage.input);
    node = stage.output;
    if (stage.stop) stops.push(stage.stop);
  }
  return {
    input,
    output: node,
    stop() {
      for (const stop of stops) {
        try { stop(); } catch { /* oscillator may already be stopped */ }
      }
    }
  };
}

function createFxStage(ctx, fx) {
  const amount = fxAmount(fx);
  if (fx.type === 'eq') {
    const bands = eqBandsDb(fx.params, amount);
    const low = ctx.createBiquadFilter();
    const mid = ctx.createBiquadFilter();
    const high = ctx.createBiquadFilter();
    low.type = 'lowshelf';
    low.frequency.value = 140;
    low.gain.value = bands.low;
    mid.type = 'peaking';
    mid.frequency.value = 1000;
    mid.Q.value = 0.9;
    mid.gain.value = bands.mid;
    high.type = 'highshelf';
    high.frequency.value = 6500;
    high.gain.value = bands.high;
    low.connect(mid);
    mid.connect(high);
    return { input: low, output: high };
  }
  if (fx.type === 'filter') {
    const filter = ctx.createBiquadFilter();
    if (amount < 0.42) {
      filter.type = 'lowpass';
      filter.frequency.value = 180 + (amount / 0.42) * 6000;
      filter.Q.value = 0.75;
    } else if (amount > 0.58) {
      filter.type = 'highpass';
      filter.frequency.value = 40 + ((amount - 0.58) / 0.42) * 3500;
      filter.Q.value = 0.7;
    } else {
      filter.type = 'allpass';
      filter.frequency.value = 1000;
    }
    return { input: filter, output: filter };
  }
  if (fx.type === 'utility') {
    const gain = ctx.createGain();
    gain.gain.value = amount * 2;
    return { input: gain, output: gain };
  }
  if (fx.type === 'compress') {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6 - amount * 30;
    comp.knee.value = 8;
    comp.ratio.value = 1.2 + amount * 7;
    comp.attack.value = 0.012;
    comp.release.value = 0.16;
    const makeup = ctx.createGain();
    makeup.gain.value = 1 + amount * 1.4;
    comp.connect(makeup);
    return { input: comp, output: makeup };
  }
  if (fx.type === 'saturator') {
    const drive = ctx.createGain();
    drive.gain.value = 1 + amount * 6;
    const shaper = ctx.createWaveShaper();
    shaper.curve = saturationCurve(amount);
    shaper.oversample = '2x';
    const trim = ctx.createGain();
    trim.gain.value = 1 / (1 + amount * 2.2);
    drive.connect(shaper);
    shaper.connect(trim);
    return { input: drive, output: trim };
  }
  if (fx.type === 'chorus') {
    const input = ctx.createGain();
    const mix = ctx.createGain();
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const delay = ctx.createDelay(0.08);
    dry.gain.value = 0.72;
    wet.gain.value = 0.22 + amount * 0.45;
    delay.delayTime.value = 0.016;
    const lfo = ctx.createOscillator();
    const lfoDepth = ctx.createGain();
    lfo.frequency.value = 0.6 + amount * 2.4;
    lfoDepth.gain.value = 0.003 + amount * 0.004;
    lfo.connect(lfoDepth);
    lfoDepth.connect(delay.delayTime);
    try { lfo.start(0); } catch { /* already started */ }
    input.connect(dry);
    input.connect(delay);
    dry.connect(mix);
    delay.connect(wet);
    wet.connect(mix);
    return { input, output: mix, stop() { try { lfo.stop(); } catch { /* ignore */ } } };
  }
  const pass = ctx.createGain();
  pass.gain.value = 1;
  return { input: pass, output: pass };
}

function applyBiquad(samples, b0, b1, b2, a1, a2) {
  const out = new Float32Array(samples.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return out;
}

function highShelf(samples, sampleRate, freq, gainDb) {
  const A = 10 ** (gainDb / 40);
  const w0 = 2 * Math.PI * freq / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / 2 * Math.SQRT2;
  const twoSqrtA = 2 * Math.sqrt(A);
  const b0 = A * ((A + 1) + (A - 1) * cos + twoSqrtA * alpha);
  const b1 = -2 * A * ((A - 1) + (A + 1) * cos);
  const b2 = A * ((A + 1) + (A - 1) * cos - twoSqrtA * alpha);
  const a0 = (A + 1) - (A - 1) * cos + twoSqrtA * alpha;
  const a1 = 2 * ((A - 1) - (A + 1) * cos);
  const a2 = (A + 1) - (A - 1) * cos - twoSqrtA * alpha;
  return applyBiquad(samples, b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
}

function onePoleLowpass(samples, sampleRate, cutoff) {
  const out = new Float32Array(samples.length);
  const rc = 1 / (2 * Math.PI * Math.max(20, cutoff));
  const dt = 1 / sampleRate;
  const a = dt / (rc + dt);
  let y = 0;
  for (let i = 0; i < samples.length; i++) {
    y += a * (samples[i] - y);
    out[i] = y;
  }
  return out;
}

function onePoleHighpass(samples, sampleRate, cutoff) {
  const low = onePoleLowpass(samples, sampleRate, cutoff);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] - low[i];
  return out;
}

function applyFx(samples, sampleRate, fx) {
  const amount = fxAmount(fx);
  if (fx.type === 'eq') {
    const bands = eqBandsDb(fx.params, amount);
    let data = highShelf(samples, sampleRate, 140, bands.low);
    data = highShelf(data, sampleRate, 1000, bands.mid * 0.15);
    return highShelf(data, sampleRate, 6500, bands.high);
  }
  if (fx.type === 'filter') {
    if (amount < 0.42) return onePoleLowpass(samples, sampleRate, 180 + (amount / 0.42) * 6000);
    if (amount > 0.58) return onePoleHighpass(samples, sampleRate, 40 + ((amount - 0.58) / 0.42) * 3500);
    return Float32Array.from(samples);
  }
  if (fx.type === 'utility') {
    const gain = amount * 2;
    const out = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain;
    return out;
  }
  if (fx.type === 'compress') {
    const threshold = 0.15 + (1 - amount) * 0.55;
    const ratio = 1.2 + amount * 7;
    const makeup = 1 + amount * 0.8;
    const out = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i];
      const abs = Math.abs(x);
      const y = abs <= threshold ? x : Math.sign(x) * (threshold + (abs - threshold) / ratio);
      out[i] = y * makeup;
    }
    return out;
  }
  if (fx.type === 'saturator') {
    const drive = 1 + amount * 6;
    const trim = 1 / (1 + amount * 2.2);
    const out = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) out[i] = Math.tanh(samples[i] * drive) * trim;
    return out;
  }
  if (fx.type === 'chorus') {
    const delay = Math.max(1, Math.round(sampleRate * 0.016));
    const wet = 0.22 + amount * 0.45;
    const out = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const delayed = i >= delay ? samples[i - delay] : 0;
      out[i] = samples[i] * 0.72 + delayed * wet;
    }
    return out;
  }
  return Float32Array.from(samples);
}

/** Mono reference render used to prove inserts change energy without a browser. */
export function processInsertChain(samples, sampleRate, chain = []) {
  let data = Float32Array.from(samples);
  for (const fx of activeInserts(chain)) data = applyFx(data, sampleRate, fx);
  return data;
}

export function signalRms(samples) {
  if (!samples?.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

export function sineBuffer(sampleRate, seconds, freq, amplitude = 0.25) {
  const length = Math.max(1, Math.floor(sampleRate * seconds));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = Math.sin(2 * Math.PI * freq * i / sampleRate) * amplitude;
  }
  return out;
}

// ─── Sidechain Routing Model ───────────────────────────────────────────
// A sidechain route sends only the control signal (for ducking/keying)
// without summing the audio into the destination mix bus.

export function createSidechainRoute(sourceTrackId, destTrackId, amount = 1.0) {
  return {
    source: sourceTrackId,
    dest: destTrackId,
    amount: Math.max(0, Math.min(1, Number(amount) || 1)),
    sidechainOnly: true // Audio does NOT sum — key/trigger signal only
  };
}

export function addSidechainRoute(routes = [], sourceTrackId, destTrackId, amount = 1.0) {
  const existing = routes.findIndex(r => r.source === sourceTrackId && r.dest === destTrackId);
  if (existing >= 0) {
    routes[existing].amount = Math.max(0, Math.min(1, Number(amount) || 1));
    routes[existing].sidechainOnly = true;
    return routes;
  }
  routes.push(createSidechainRoute(sourceTrackId, destTrackId, amount));
  return routes;
}

export function removeSidechainRoute(routes = [], sourceTrackId, destTrackId) {
  return routes.filter(r => !(r.source === sourceTrackId && r.dest === destTrackId));
}

export function getSidechainSources(routes = [], destTrackId) {
  return routes.filter(r => r.dest === destTrackId && r.sidechainOnly);
}

// ─── FX Slot Reordering ────────────────────────────────────────────────
// Swap two FX insert slots on a track's chain

export function swapFxSlots(fxArray = [], indexA, indexB) {
  if (!Array.isArray(fxArray)) return fxArray;
  if (indexA < 0 || indexA >= fxArray.length) return fxArray;
  if (indexB < 0 || indexB >= fxArray.length) return fxArray;
  if (indexA === indexB) return fxArray;
  const temp = fxArray[indexA];
  fxArray[indexA] = fxArray[indexB];
  fxArray[indexB] = temp;
  return fxArray;
}

export function moveFxSlotUp(fxArray = [], index) {
  return swapFxSlots(fxArray, index, index - 1);
}

export function moveFxSlotDown(fxArray = [], index) {
  return swapFxSlots(fxArray, index, index + 1);
}

