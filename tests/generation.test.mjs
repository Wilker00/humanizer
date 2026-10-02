import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConstrainedPhrase,
  chordPitchClasses,
  rewriteDrumLanes,
  suggestLatencyOffsetMs,
  libraryPreviewRate,
  mergeLockedNotes,
  interpretMusicPrompt
} from '../engine/generation.js';
import { duplicateSection } from '../engine/daw-bridge.js';
import { generateSharePackReadme, sharePackStemName } from '../engine/export-tools.js';

const scale = ['A3', 'C4', 'D4', 'E4', 'G4', 'A4', 'C5', 'D5', 'E5'];

test('locked melody notes survive a rewrite and new notes follow the chord', () => {
  const classes = chordPitchClasses(['Am7', 'Fmaj7']);
  assert.ok(classes.includes('A') && classes.includes('C') && classes.includes('E') && classes.includes('G'));
  const locked = [{ n: 'D4', x: 0, w: 2, locked: true }];
  const phrase = buildConstrainedPhrase(scale, 0, {
    density: 0.8,
    register: 0.6,
    chordClasses: classes,
    locked,
    rng: () => 0.95
  });
  const kept = phrase.find(note => note.x === 0);
  assert.equal(kept.n, 'D4');
  assert.equal(kept.locked, true);
  const rewritten = phrase.filter(note => note.x !== 0);
  assert.ok(rewritten.length > 0);
  for (const note of rewritten) {
    const pc = note.n.replace(/\d/g, '');
    assert.ok(classes.includes(pc), `${note.n} left the chord`);
  }
});

test('rewriting drums keeps a locked kick and can change hats', () => {
  const current = { kick: [0, 8], hat: [0, 4, 8, 12], snare: [4, 12] };
  const kit = { kick: [0, 4, 8, 12], hat: [2, 6, 10, 14], snare: [4, 12] };
  const next = rewriteDrumLanes(current, kit, {
    lockedLanes: ['kick'],
    lanes: ['kick', 'hat', 'snare'],
    variation: 1,
    rng: () => 0
  });
  assert.deepEqual(next.kick, [0, 8]);
  assert.notDeepEqual(next.hat, current.hat);
});

test('mergeLockedNotes drops generated notes that sit on a locked step', () => {
  const merged = mergeLockedNotes(
    [{ n: 'C4', x: 0, w: 1 }, { n: 'E4', x: 4, w: 1 }],
    [{ n: 'G4', x: 0, w: 1 }]
  );
  assert.equal(merged.filter(note => note.x === 0).length, 1);
  assert.equal(merged.find(note => note.x === 0).n, 'G4');
  assert.equal(merged.find(note => note.x === 4).n, 'E4');
});

test('latency calibration pulls a late clap earlier', () => {
  assert.equal(suggestLatencyOffsetMs(1000, 1080), -80);
  assert.equal(suggestLatencyOffsetMs(1000, 5000), -200);
});

test('library preview follows project tempo and key', () => {
  assert.equal(libraryPreviewRate({ bpm: 184, fitTempo: true, fitKey: false }), 2);
  assert.ok(libraryPreviewRate({ bpm: 92, fitTempo: false, fitKey: true, keyRoot: 'C' }) < 1);
  assert.equal(libraryPreviewRate({ bpm: 92, fitTempo: false, fitKey: false }), 1);
});

test('duplicating a section forks its patterns', () => {
  const state = {
    pattern: [{ n: 'C4', x: 0, w: 1 }],
    drums: {
      kick: new Set([0, 8]),
      snare: new Set([4]),
      hat: new Set([2]),
      clap: new Set(),
      openhat: new Set(),
      bass: new Set()
    },
    drumRolls: {},
    chords: { name: 'Moonlit', bars: ['Am7', 'Fmaj7', 'Cmaj7', 'G'] },
    sections: [
      { name: 'Verse', bars: 4, active: { keys: true, drums: true, chords: true, vocals: false } }
    ],
    melodyAdded: true,
    drumsAdded: true,
    chordAdded: true,
    vocalAdded: false,
    songSection: 0
  };
  duplicateSection(state, 0);
  assert.equal(state.sections.length, 2);
  assert.notEqual(state.sections[0].patterns.keys, state.sections[1].patterns.keys);
  assert.notEqual(state.sections[0].patterns.drums, state.sections[1].patterns.drums);
});

test('a beat brief maps only the cues the local rules support', () => {
  const recipe = interpretMusicPrompt('sparse warm R&B in A minor at 92 BPM with a low melody');
  assert.equal(recipe.bpm, 92);
  assert.equal(recipe.key, 'A minor');
  assert.equal(recipe.kit, 'rnb');
  assert.equal(recipe.density, 0.3);
  assert.ok(recipe.register < 0.5);
  assert.ok(recipe.matched.includes('92 BPM'));
  assert.ok(recipe.matched.includes('sparse'));
  const plain = interpretMusicPrompt('make something cinematic with strings');
  assert.equal(plain.bpm, null);
  assert.equal(plain.key, null);
  assert.equal(plain.matched.length, 0);
});

test('share pack names aligned stems and explains the DAW handoff', () => {
  const stem = sharePackStemName('Late Night', 'keys');
  assert.equal(stem, 'stems/late-night-keys.wav');
  const readme = generateSharePackReadme({
    name: 'Late Night',
    bpm: 92,
    key: 'A minor',
    sections: [{ name: 'Hook', bars: 8, active: { keys: true } }],
    proSession: { markers: [{ bar: 4, name: 'Drop' }] }
  }, { stemNames: [stem] });
  assert.match(readme, /OPEN IN ABLETON, FL STUDIO, OR LOGIC/);
  assert.match(readme, /stems\/late-night-keys\.wav/);
  assert.match(readme, /bar 5: Drop/);
  assert.match(readme, /beats or tones/);
  assert.match(readme, /handoff/);
});
