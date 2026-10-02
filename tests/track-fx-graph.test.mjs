import test from 'node:test';
import assert from 'node:assert/strict';
import {
  channelAudibleGain,
  connectFxChain,
  processInsertChain,
  signalRms,
  sineBuffer,
  WIRED_FX_TYPES
} from '../engine/track-fx-graph.js';

function mockContext() {
  const make = kind => ({
    kind,
    type: '',
    frequency: { value: 0 },
    gain: { value: 1 },
    Q: { value: 1 },
    threshold: { value: 0 },
    knee: { value: 0 },
    ratio: { value: 1 },
    attack: { value: 0 },
    release: { value: 0 },
    delayTime: { value: 0 },
    oversample: '',
    curve: null,
    connections: [],
    connect(dest) {
      this.connections.push(dest);
      return dest;
    },
    start() {},
    stop() {}
  });
  return {
    createGain: () => make('gain'),
    createBiquadFilter: () => make('biquad'),
    createDynamicsCompressor: () => make('comp'),
    createWaveShaper: () => make('shaper'),
    createDelay: () => make('delay'),
    createOscillator: () => make('osc')
  };
}

test('wired insert types match the mixer menu', () => {
  assert.deepEqual(WIRED_FX_TYPES, ['eq', 'compress', 'saturator', 'chorus', 'filter', 'utility']);
});

test('insert EQ changes high-frequency energy and bypass matches dry', () => {
  const sampleRate = 44100;
  const tone = sineBuffer(sampleRate, 0.2, 6000, 0.2);
  const dry = signalRms(processInsertChain(tone, sampleRate, []));
  const bypassed = signalRms(processInsertChain(tone, sampleRate, [
    { type: 'eq', bypass: true, params: { amount: 1 } }
  ]));
  const boosted = signalRms(processInsertChain(tone, sampleRate, [
    { type: 'eq', bypass: false, params: { amount: 1 } }
  ]));
  assert.ok(Math.abs(dry - bypassed) < 1e-9);
  assert.ok(boosted > dry * 1.15, `expected EQ boost, dry ${dry} wet ${boosted}`);
});

test('utility silence, lowpass, and compression change a fixture differently', () => {
  const sampleRate = 44100;
  const tone = sineBuffer(sampleRate, 0.2, 4000, 0.8);
  const dry = signalRms(tone);
  const silent = signalRms(processInsertChain(tone, sampleRate, [
    { type: 'utility', params: { amount: 0 } }
  ]));
  const lowpassed = signalRms(processInsertChain(tone, sampleRate, [
    { type: 'filter', params: { amount: 0.05 } }
  ]));
  const crushed = processInsertChain(tone, sampleRate, [
    { type: 'compress', params: { amount: 1 } }
  ]);
  let dryPeak = 0;
  let crushedPeak = 0;
  for (let i = 0; i < tone.length; i++) {
    dryPeak = Math.max(dryPeak, Math.abs(tone[i]));
    crushedPeak = Math.max(crushedPeak, Math.abs(crushed[i]));
  }
  assert.ok(silent < 1e-8);
  assert.ok(lowpassed < dry * 0.45);
  assert.ok(crushedPeak < dryPeak);
});

test('mute, solo, and automation scale channel render gain', () => {
  const open = channelAudibleGain({ vol: 0.8, automation: 1, anySolo: false });
  const faded = channelAudibleGain({ vol: 0.8, automation: 0.25, anySolo: false });
  assert.ok(faded > 0 && faded < open * 0.5);
  assert.equal(channelAudibleGain({ vol: 0.8, mute: true, automation: 1 }), 0);
  assert.equal(channelAudibleGain({ vol: 0.8, solo: false, anySolo: true, automation: 1 }), 0);
  assert.ok(channelAudibleGain({ vol: 0.8, solo: true, anySolo: true, automation: 1 }) > 0);
});

test('connectFxChain inserts an EQ stage and skips a bypassed insert', () => {
  const ctx = mockContext();
  const input = ctx.createGain();
  const live = connectFxChain(ctx, input, [{ type: 'eq', bypass: false, params: { amount: 0.9 } }]);
  assert.notEqual(live.output, input);
  assert.equal(live.output.kind, 'biquad');
  const dry = connectFxChain(ctx, ctx.createGain(), [{ type: 'eq', bypass: true, params: { amount: 1 } }]);
  assert.equal(dry.output.connections.length, 0);
});
