import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizedBpm,
  sixteenthSeconds,
  toneSwingAmount,
  swingOffsetSeconds,
  stepOffsetSeconds,
  melodyDurationSeconds,
  melodyGain,
  rollGainMultiplier,
} from '../engine/transport.js';

test('the scheduler receives finite supported tempos', () => {
  for (const input of [undefined, NaN, Infinity, -1, 0, 'bad']) {
    assert.equal(normalizedBpm(input), 92);
  }
  assert.equal(normalizedBpm(10), 40);
  assert.equal(normalizedBpm('120'), 120);
  assert.equal(normalizedBpm(999), 240);
});

test('swing matches Tone 15 tick timing and preserves bar boundaries', () => {
  for (const bpm of [40, 92, 240]) {
    for (const swing of [0, 18, 60]) {
      const stepDuration = sixteenthSeconds(bpm);
      for (let step = 0; step < 32; step++) {
        // Equivalent to Transport._processTick at PPQ=192, swingSubdivision=16n.
        const ticks = step * 48;
        const toneOffset = ticks % 192 && ticks % 96
          ? (32 / 192) * (60 / bpm) * Math.sin((ticks % 96) / 96 * Math.PI) * toneSwingAmount(swing)
          : 0;
        assert.ok(Math.abs(swingOffsetSeconds(step, bpm, swing) - toneOffset) < 1e-12);
        assert.ok(stepOffsetSeconds(step + 1, bpm, swing) > stepOffsetSeconds(step, bpm, swing));
      }
      assert.equal(stepOffsetSeconds(16, bpm, swing), stepDuration * 16);
    }
  }
});

test('export note lengths remain tied to tempo and piano-roll widths', () => {
  assert.equal(melodyDurationSeconds(4, 60), melodyDurationSeconds(4, 120) * 2);
  assert.equal(melodyDurationSeconds(4, 120), 0.46);
  assert.equal(melodyGain(0, 0.8), 0.14 * 0.8);
  assert.equal(melodyGain(4, 0.8), 0.14 * 0.84 * 0.8);
  assert.equal(melodyGain(1, 0.8), 0.14 * 0.66 * 0.8);
});

test('export does not attenuate ordinary hits as if they were rolls', () => {
  assert.equal(rollGainMultiplier(1, 0), 1);
  assert.equal(rollGainMultiplier(4, 0), 0.85);
  assert.equal(rollGainMultiplier(4, 3), 0.9624999999999999);
});
