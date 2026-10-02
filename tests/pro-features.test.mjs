import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeGroupBuses,
  applyGroupVolume,
  groupForTrack,
  normalizeProSession,
  estimateIntegratedLufs,
  normalizeInstrumentPatch,
  normalizePluginRack,
  markerMetadata
} from '../engine/pro-features.js';
import { pushProjectVersion, listProjectVersions, getProjectVersion, clearProjectVersions } from '../engine/project-versions.js';

test('group buses mute and scale volumes', () => {
  const buses = normalizeGroupBuses({ drums: { vol: 0.5, mute: false }, vocals: { mute: true, vol: 1 } });
  assert.equal(applyGroupVolume(1, 'drums', buses), 0.5);
  assert.equal(applyGroupVolume(1, 'vocals', buses), 0);
  assert.equal(groupForTrack('lead-1', { kind: 'lead' }), 'music');
});

test('pro session normalizes latency punch markers', () => {
  const pro = normalizeProSession({
    latencyOffsetMs: 40,
    punchEnabled: true,
    punchInBar: 2,
    punchOutBar: 4,
    markers: [{ bar: 1, name: 'Drop' }]
  });
  assert.equal(pro.latencyOffsetMs, 40);
  assert.equal(pro.punchEnabled, true);
  assert.equal(pro.markers.length, 1);
  assert.equal(pro.markers[0].name, 'Drop');
});

test('pro session normalizes reference cue sidechain midi learn scenes', () => {
  const pro = normalizeProSession({
    cueMonitor: true,
    cueMuteSpeakers: true,
    referenceMode: 'reference',
    referenceDuck: 0.6,
    delayReturn: 0.45,
    sidechains: [{ sourceTrackId: 'kick', targetTrackId: 'pad', amount: 2 }],
    midiLearn: [{ trackId: 'keys', target: 'delaySend', cc: 74, channel: 20 }],
    scenes: [{ name: 'Hook', sectionIndex: 2 }],
    publishChecklist: { sharePackTested: true }
  });
  assert.equal(pro.cueMuteSpeakers, true);
  assert.equal(pro.referenceMode, 'reference');
  assert.equal(pro.sidechains[0].amount, 1);
  assert.equal(pro.midiLearn[0].channel, 16);
  assert.equal(pro.scenes[0].name, 'Hook');
  assert.equal(pro.publishChecklist.sharePackTested, true);
});

test('plugin rack and marker metadata are bounded', () => {
  const rack = normalizePluginRack([{ type: 'chorus', preset: 'Wide', params: { mix: 0.8 } }, { type: 'vst' }]);
  assert.equal(rack[0].type, 'chorus');
  assert.equal(rack[1].type, 'eq');
  const markers = markerMetadata([{ bar: 4, name: 'Drop', color: '#f00' }]);
  assert.deepEqual(markers[0], { bar: 4, name: 'Drop', color: '#f00' });
});

test('LUFS estimate returns finite values', () => {
  const samples = new Float32Array(44100);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i / 40) * 0.25;
  const result = estimateIntegratedLufs(samples, samples, 44100);
  assert.ok(Number.isFinite(result.lufs));
  assert.ok(result.lufs > -70 && result.lufs < 0);
});

test('instrument patch clamps', () => {
  const patch = normalizeInstrumentPatch({ attack: 99, filterHz: 10, unison: 9 }, 'bass');
  assert.equal(patch.attack, 2);
  assert.equal(patch.filterHz, 120);
  assert.equal(patch.unison, 3);
});

test('project versions store and restore metadata', () => {
  // jsdom-less: shim localStorage
  const mem = new Map();
  globalThis.localStorage = {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: k => mem.delete(k)
  };
  clearProjectVersions('proj-1');
  pushProjectVersion('proj-1', { id: 'proj-1', name: 'A' }, { label: 't1' });
  pushProjectVersion('proj-1', { id: 'proj-1', name: 'B' }, { label: 't2' });
  const list = listProjectVersions('proj-1');
  assert.equal(list.length, 2);
  assert.equal(list[0].label, 't2');
  const full = getProjectVersion('proj-1', list[1].id);
  assert.equal(full.snapshot.name, 'A');
  clearProjectVersions('proj-1');
});
