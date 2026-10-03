import test from 'node:test';
import assert from 'node:assert/strict';
import { formantShift } from '../engine/formant-shift.js';

test('formant shift returns a finite, audible buffer at the original duration', () => {
  const sampleRate = 44_100;
  const samples = new Float32Array(Math.round(sampleRate * 0.35));
  for (let i = 0; i < samples.length; i++) {
    const phase = i / sampleRate;
    samples[i] = 0.45 * Math.sin(2 * Math.PI * 180 * phase) + 0.15 * Math.sin(2 * Math.PI * 360 * phase);
  }

  const shifted = formantShift(samples, sampleRate, 180, 240);
  assert.ok(shifted instanceof Float32Array);
  assert.equal(shifted.length, samples.length);
  assert.ok(shifted.every(Number.isFinite));
  const energy = shifted.reduce((sum, value) => sum + value * value, 0);
  assert.ok(energy > 1, 'shifted vocal should remain audible');
});

test('formant shift declines audio that is too short to process safely', () => {
  assert.equal(formantShift(new Float32Array(32), 44_100, 180, 240), null);
});
