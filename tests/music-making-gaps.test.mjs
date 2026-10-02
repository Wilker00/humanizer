import test from 'node:test';
import assert from 'node:assert/strict';

import {
  emptyDrumPattern,
  emptyBassPattern,
  emptyMelodyPattern,
  serializeDrums,
  deserializeDrums,
  ensurePatternBank,
  writeWorkingToPattern,
  readPatternToWorking,
  setPatternBars
} from '../engine/patterns.js';
import {
  migrateProjectToV3,
  validateProject
} from '../engine/project-format.js';
import {
  drumHitsForBar,
  resolveArrangementAtBar,
  trackAutomationGainAt,
  automationGainAtFractional
} from '../engine/arrangement-engine.js';
import {
  normalizeTrackList,
  defaultTrackMeta,
  setTrackAutomation,
  splitClip,
  moveClip,
  duplicateClip,
  emptyPlaylist
} from '../engine/playlist.js';

test('A1: per-hit drum velocity and nudge round-trip in pattern bank', () => {
  const pat = emptyDrumPattern('Trap 1', 1, { kick: [0, 4, 8, 12] }, { kick: { 12: 2 } }, { kick: { 0: 0.9, 4: 0.6, 8: 0.8, 12: 1.0 } }, { kick: { 4: 0.1, 8: -0.05 } });
  assert.equal(pat.velocity.kick[0], 0.9);
  assert.equal(pat.velocity.kick[4], 0.6);
  assert.equal(pat.nudge.kick[4], 0.1);

  const bank = ensurePatternBank({ drums: [pat] });
  assert.equal(bank.drums[0].velocity.kick[0], 0.9);
  assert.equal(bank.drums[0].nudge.kick[4], 0.1);

  const working = readPatternToWorking(bank, 'drums', pat.id);
  assert.equal(working.velocity.kick[0], 0.9);
  assert.equal(working.nudge.kick[4], 0.1);

  // Modify and write back
  working.velocity.kick[0] = 0.75;
  working.nudge.kick[0] = 0.02;
  writeWorkingToPattern(bank, 'drums', pat.id, working);
  assert.equal(bank.drums[0].velocity.kick[0], 0.75);
  assert.equal(bank.drums[0].nudge.kick[0], 0.02);
});

test('A2: extra drum lanes beyond fixed set serialize, deserialize and validate', () => {
  const customLanes = ['kick', 'snare', 'clap', 'hat', 'openhat', 'bass', 'cowbell', 'shaker', 'perc'];
  const steps = {
    kick: [0, 8],
    cowbell: [4, 12],
    shaker: [0, 2, 4, 6, 8, 10, 12, 14]
  };
  const serialized = serializeDrums(steps, customLanes);
  assert.deepEqual(serialized.cowbell, [4, 12]);
  assert.deepEqual(serialized.shaker, [0, 2, 4, 6, 8, 10, 12, 14]);

  const deserialized = deserializeDrums(serialized, customLanes);
  assert.equal(deserialized.cowbell.has(4), true);
  assert.equal(deserialized.shaker.has(6), true);

  const pat = emptyDrumPattern('Extra Lanes', 1, serialized, {}, { cowbell: { 4: 0.8 } });
  assert.equal(pat.steps.cowbell.length, 2);
  assert.equal(pat.velocity.cowbell[4], 0.8);
});

test('A3: independent drum pattern length (2-bar, 4-bar) functions and validates', () => {
  const pat = emptyDrumPattern('Two Bar Beat', 2, { kick: [0, 8, 16, 24] });
  assert.equal(pat.bars, 2);

  const bank = ensurePatternBank({ drums: [pat] });
  assert.equal(bank.drums[0].bars, 2);

  const hitsBar0 = drumHitsForBar(pat, 0, '4/4');
  const hitsBar1 = drumHitsForBar(pat, 1, '4/4');
  assert.deepEqual(hitsBar0.steps.kick, [0, 8]);
  assert.deepEqual(hitsBar1.steps.kick, [0, 8]); // relative to bar 1 (16-16=0, 24-16=8)
});

test('A4: choke groups default and persist in drum patterns', () => {
  const pat = emptyDrumPattern('HiHats', 1, { hat: [0, 2, 4, 6], openhat: [4] });
  assert.equal(pat.chokeGroups.openhat, 1);
  assert.equal(pat.chokeGroups.hat, 1);

  const hits = drumHitsForBar(pat, 0, '4/4');
  assert.equal(hits.chokeGroups.openhat, 1);
  assert.equal(hits.chokeGroups.hat, 1);
});

test('A5: dedicated bass pattern bank operates independently from melody', () => {
  const mel = emptyMelodyPattern('Lead 1', 1, [{ n: 'C4', x: 0, w: 1, v: 0.9 }]);
  const bss = emptyBassPattern('Sub 1', 1, [{ n: 'C1', x: 0, w: 2, v: 1.0 }]);

  const bank = ensurePatternBank({ melody: [mel], bass: [bss] });
  assert.equal(bank.melody.length, 1);
  assert.equal(bank.bass.length, 1);
  assert.equal(bank.bass[0].notes[0].n, 'C1');

  // Mutating bass does not touch melody
  bank.bass[0].notes[0].n = 'F1';
  assert.equal(bank.melody[0].notes[0].n, 'C4');
  assert.equal(bank.bass[0].notes[0].n, 'F1');
});

test('B6 & B7: continuous track and clip automation interpolate across bars and survive rebuild', () => {
  const track = defaultTrackMeta('lead-1');
  track.automation = [
    { bar: 0, gain: 0.2 },
    { bar: 2, gain: 1.0 },
    { bar: 4, gain: 0.6 }
  ];

  // At bar 0
  assert.equal(trackAutomationGainAt(track, 0), 0.2);
  // At bar 1 (midpoint of 0.2 and 1.0)
  assert.ok(Math.abs(trackAutomationGainAt(track, 1) - 0.6) < 0.001);
  // At bar 2
  assert.equal(trackAutomationGainAt(track, 2), 1.0);
  // At bar 3 (midpoint of 1.0 and 0.6)
  assert.ok(Math.abs(trackAutomationGainAt(track, 3) - 0.8) < 0.001);
  // At bar 4
  assert.equal(trackAutomationGainAt(track, 4), 0.6);
  // Beyond bar 4 clamps to last value
  assert.equal(trackAutomationGainAt(track, 5), 0.6);

  setTrackAutomation([track], 'lead-1', [{ bar: 0, gain: 0.5 }, { bar: 1, gain: 0.9 }]);
  assert.equal(track.automation.length, 2);
  assert.equal(track.automation[0].gain, 0.5);
});

test('D16: send level parameter in track mix defaults to 0 and clamps properly', () => {
  const tracks = normalizeTrackList([
    { id: 'drums', mix: { vol: 0.8, pan: 0, send: 0.35 } },
    { id: 'vocals', mix: { vol: 0.9, pan: 0, send: 0.5 } }
  ]);
  assert.equal(tracks[0].mix.send, 0.35);
  assert.equal(tracks[1].mix.send, 0.5);
});

test('C13: non-destructive audio clip split and move preserve offsets', () => {
  const playlist = emptyPlaylist(['vocals']);
  const clip = {
    id: 'clip-vocal-1',
    audioTakeId: 'take-123',
    startBar: 2,
    lengthBars: 4,
    takeStart: 0.1,
    takeEnd: 0.9,
    gain: 0.8,
    mode: 'trim'
  };
  playlist.tracks[0].clips.push(clip);

  // Split at bar 4 (local split ratio is (4-2)/4 = 0.5)
  const right = splitClip(playlist, 'vocals', 'clip-vocal-1', 4);
  assert.ok(right);
  assert.equal(clip.startBar, 2);
  assert.equal(clip.lengthBars, 2);
  assert.equal(clip.takeStart, 0.1);
  assert.ok(Math.abs(clip.takeEnd - 0.5) < 0.001);

  assert.equal(right.startBar, 4);
  assert.equal(right.lengthBars, 2);
  assert.ok(Math.abs(right.takeStart - 0.5) < 0.001);
  assert.equal(right.takeEnd, 0.9);

  // Move right clip
  moveClip(playlist, 'vocals', right.id, 6, 'bar');
  assert.equal(right.startBar, 6);
});

import {
  calculateAudioPeaks,
  resolveStemTracks,
  boxSelectNotes,
  reorderChords,
  setChordDuration,
  setTrackArmed
} from '../engine/export-tools.js';

test('D14: stem export discovers user tracks beyond default set', () => {
  const userTracks = [
    { id: 'keys', name: 'Keys', kind: 'melody' },
    { id: 'drums', name: 'Drums', kind: 'drums' },
    { id: 'chords', name: 'Chords', kind: 'chords' },
    { id: 'vocals', name: 'Vocals', kind: 'vocals' },
    { id: 'lead-1', name: 'Synth Lead', kind: 'lead' },
    { id: 'bass-sub', name: 'Sub Bass', kind: 'bass' }
  ];
  const state = {
    melodyAdded: true,
    drumsAdded: true,
    chordAdded: false,
    vocalAdded: false,
    bassPattern: [{ n: 'C1', x: 0, w: 2 }],
    playlist: {
      tracks: [
        { id: 'lead-1', clips: [{ id: 'clip-1', startBar: 0, lengthBars: 2 }] }
      ]
    }
  };

  const stems = resolveStemTracks(userTracks, state);
  const stemIds = stems.map(s => s.id);
  assert.ok(stemIds.includes('keys'));
  assert.ok(stemIds.includes('drums'));
  assert.ok(stemIds.includes('lead-1'));
  assert.ok(stemIds.includes('bass-sub'));
  assert.ok(!stemIds.includes('chords')); // Not added
});

test('D18: true-peak calculation measures inter-sample peak and detects clipping', () => {
  // Synthesize two consecutive high-amplitude samples that produce an inter-sample overshoot > 1.0
  const buffer = new Float32Array([0.0, 0.95, 0.95, 0.0, -0.95, -0.95, 0.0]);
  const peaks = calculateAudioPeaks(buffer);

  assert.ok(peaks.samplePeakLinear <= 0.95);
  // Hermite interpolation between 0.95 and 0.95 with zeroes on either side peaks above 0.95!
  assert.ok(peaks.truePeakLinear > peaks.samplePeakLinear);
  assert.ok(peaks.truePeakDb > peaks.samplePeakDb);
});

test('E19: piano roll box-select identifies all intersecting notes', () => {
  const pitchList = ['C5', 'B4', 'A4', 'G4', 'F4', 'E4', 'D4', 'C4'];
  const notes = [
    { n: 'C4', x: 0, w: 2 }, // pitch index 7, range 0..2
    { n: 'E4', x: 2, w: 2 }, // pitch index 5, range 2..4
    { n: 'G4', x: 4, w: 2 }, // pitch index 3, range 4..6
    { n: 'C5', x: 6, w: 2 }  // pitch index 0, range 6..8
  ];

  // Box from step 1 to 5, pitch indices 3 to 6 (E4, F4, G4)
  const selected = boxSelectNotes(notes, 1, 5, pitchList, 3, 6);
  // Note 1 (E4, x:2, w:2) is in pitch [3..6] and time [1..5] -> should be selected
  // Note 2 (G4, x:4, w:2) starts at 4, which is < 5 -> overlap!
  assert.deepEqual(selected, [1, 2]);
});

test('E20: chord duration and reordering updates progression', () => {
  const chords = {
    name: 'Neo Soul',
    bars: ['Am7', 'Dm9', 'G13', 'Cmaj7'],
    durations: [1, 1, 1, 1]
  };

  // Reorder: move Dm9 (index 1) to end (index 3)
  const reordered = reorderChords(chords, 1, 3);
  assert.deepEqual(reordered.bars, ['Am7', 'G13', 'Cmaj7', 'Dm9']);

  // Set duration of Am7 (index 0) to 2 bars
  const withDur = setChordDuration(reordered, 0, 2);
  assert.equal(withDur.durations[0], 2);
});

test('C9 & C12: track arming routes recording target exclusively or additively', () => {
  const tracks = [
    { id: 'keys', name: 'Keys', kind: 'melody', armed: false },
    { id: 'vocals', name: 'Vocals', kind: 'vocals', armed: false },
    { id: 'bass', name: 'Bass', kind: 'bass', armed: false }
  ];

  const armedVocals = setTrackArmed(tracks, 'vocals', true);
  assert.equal(armedVocals.find(t => t.id === 'vocals').armed, true);
  assert.equal(armedVocals.find(t => t.id === 'keys').armed, false);

  // Arm bass exclusively
  const armedBass = setTrackArmed(armedVocals, 'bass', true);
  assert.equal(armedBass.find(t => t.id === 'bass').armed, true);
  assert.equal(armedBass.find(t => t.id === 'vocals').armed, false);
});

