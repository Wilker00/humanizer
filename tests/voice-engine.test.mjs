import test from 'node:test';
import assert from 'node:assert/strict';
import {
  samplerPlaybackRate,
  noteInKeyRange,
  patchIsCustom,
  warpPlaybackRate,
  clipPlaybackRate,
  eqBandsDb,
  estimateLoopBpm
} from '../engine/voice-engine.js';

test('sampler rate is one octave up from the root', () => {
  assert.equal(samplerPlaybackRate('C5', 'C4'), 2);
  assert.equal(samplerPlaybackRate('C4', 'C4'), 1);
  assert.equal(noteInKeyRange('C3', 'C2', 'C6'), true);
  assert.equal(noteInKeyRange('C1', 'C2', 'C6'), false);
});

test('default patch is not custom and a moved filter is', () => {
  const base = { attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.35, filterHz: 2400, drive: 0, unison: 1 };
  assert.equal(patchIsCustom({ ...base }, base), false);
  assert.equal(patchIsCustom({ ...base, filterHz: 800 }, base), true);
});

test('beats and tones follow project tempo and off stays at recorded speed', () => {
  assert.equal(warpPlaybackRate({ warpMode: 'beats', sourceBpm: 70, projectBpm: 140 }), 2);
  assert.equal(warpPlaybackRate({ warpMode: 'tones', sourceBpm: 70, projectBpm: 140 }), 2);
  assert.equal(warpPlaybackRate({ warpMode: 'off', sourceBpm: 70, projectBpm: 140 }), 1);
  assert.equal(clipPlaybackRate({ warpMode: 'beats', sourceBpm: 80 }, 160, 0.94), 1.88);
});

test('eq bands stay independent and a lone amount still tilts', () => {
  const bands = eqBandsDb({ low: 6, high: -3 }, 1);
  assert.equal(bands.low, 6);
  assert.equal(bands.mid, 0);
  assert.equal(bands.high, -3);
  const tilt = eqBandsDb({}, 1);
  assert.ok(tilt.high > 10);
  assert.ok(tilt.low > 0);
});

test('a click train at 120 bpm is recognized', () => {
  const sampleRate = 8000;
  const samples = new Float32Array(sampleRate * 4);
  const period = sampleRate / 2;
  for (let i = 0; i < samples.length; i++) {
    if (i % period < 40) samples[i] = 1;
  }
  assert.equal(estimateLoopBpm(samples, sampleRate), 120);
  assert.equal(estimateLoopBpm(new Float32Array(sampleRate), sampleRate), null);
});
