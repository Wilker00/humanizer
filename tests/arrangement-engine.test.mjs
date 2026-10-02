import test from 'node:test';
import assert from 'node:assert/strict';
import {
  takeGainValue,
  automationGainAtFractional,
  beatsPerBar,
  resolveArrangementAtBar,
  mergePlaylistPreservingEdits,
  pickTopClip
} from '../engine/arrangement-engine.js';
import { emptyMelodyPattern, emptyDrumPattern, emptyChordPattern, ensurePatternBank } from '../engine/patterns.js';
import { rebuildPlaylistFromSections, emptyPlaylist } from '../engine/playlist.js';

test('zero take gain stays silent (never coerced to unity)', () => {
  assert.equal(takeGainValue({ gain: 0 }), 0);
  assert.equal(takeGainValue({ gain: 0.5 }), 0.5);
  assert.equal(takeGainValue({}), 1);
  assert.equal(takeGainValue(null), 1);
});

test('beats per bar follows meter', () => {
  assert.equal(beatsPerBar('4/4'), 4);
  assert.equal(beatsPerBar('3/4'), 3);
  assert.equal(beatsPerBar('6/8'), 6);
});

test('automation interpolates within a bar', () => {
  const clip = {
    startBar: 0,
    lengthBars: 2,
    gain: 1,
    automation: [{ bar: 0, gain: 0 }, { bar: 1, gain: 1 }]
  };
  assert.ok(automationGainAtFractional(clip, 0) < 0.05);
  assert.ok(Math.abs(automationGainAtFractional(clip, 0.5) - 0.5) < 0.05);
  assert.ok(automationGainAtFractional(clip, 1) > 0.95);
});

test('song-mode gaps are silent; overlapping clips pick the topmost', () => {
  const melA = emptyMelodyPattern('A', 1, [{ n: 'C4', x: 0, w: 1 }]);
  const melB = emptyMelodyPattern('B', 1, [{ n: 'G4', x: 0, w: 1 }]);
  const drums = emptyDrumPattern('D', 1, { kick: [0] });
  const chords = emptyChordPattern('C', 1, { name: 'Test', bars: ['Am7', 'Fmaj7', 'Cmaj7', 'G', 'Em7', 'Am7', 'Dm7', 'G7'] });
  const patterns = ensurePatternBank({ melody: [melA, melB], drums: [drums], chords: [chords] });
  const sections = [
    { name: 'Verse', bars: 2, active: { keys: true, drums: true, chords: true, vocals: false }, patterns: { keys: melA.id, drums: drums.id, chords: chords.id } },
    { name: 'Hook', bars: 2, active: { keys: true, drums: true, chords: true, vocals: false }, patterns: { keys: melB.id, drums: drums.id, chords: chords.id } }
  ];
  const playlist = rebuildPlaylistFromSections(sections, { melodyAdded: true, drumsAdded: true, chordAdded: true });
  // Clear keys clips to create a gap on bar 0
  const keysTrack = playlist.tracks.find(t => t.id === 'keys');
  keysTrack.clips = keysTrack.clips.filter(c => c.startBar >= 2);

  const gap = resolveArrangementAtBar({
    songMode: true,
    playlist,
    patterns,
    sections,
    songBar: 0,
    localStep: 0,
    meter: '4/4'
  });
  assert.equal(gap.gap.keys, true);
  assert.deepEqual(gap.melodyNotes, []);

  const hook = resolveArrangementAtBar({
    songMode: true,
    playlist,
    patterns,
    sections,
    songBar: 2,
    localStep: 0,
    meter: '4/4'
  });
  assert.equal(hook.gap.keys, false);
  assert.equal(hook.melodyNotes[0]?.n, 'G4');

  // Multi-bar chord progression advances past first four symbols
  const late = resolveArrangementAtBar({
    songMode: true,
    playlist,
    patterns,
    sections,
    songBar: 0,
    localStep: 0,
    meter: '4/4'
  });
  // Force chord pattern localBar by placing a 2-bar chord pattern
  chords.bars = 2;
  chords.progression.bars = ['Am7', 'Fmaj7', 'Cmaj7', 'G', 'Em7', 'Dm7', 'G7', 'Am7'];
  patterns.chords = [chords];
  sections[0].patterns.chords = chords.id;
  const playlist2 = rebuildPlaylistFromSections(sections, { melodyAdded: true, drumsAdded: true, chordAdded: true });
  const bar0 = resolveArrangementAtBar({ songMode: true, playlist: playlist2, patterns, sections, songBar: 0, localStep: 0, meter: '4/4' });
  const bar1 = resolveArrangementAtBar({ songMode: true, playlist: playlist2, patterns, sections, songBar: 0, localStep: 0, meter: '4/4' });
  // localBar for songBar 1 within 2-bar pattern
  const secondBar = resolveArrangementAtBar({ songMode: true, playlist: playlist2, patterns, sections, songBar: 1, localStep: 0, meter: '4/4' });
  assert.equal(bar0.chordSymbol, 'Am7');
  assert.equal(secondBar.chordSymbol, 'Em7');

  const top = pickTopClip([
    { id: 'a', startBar: 0, lengthBars: 4, patternId: '1' },
    { id: 'b', startBar: 2, lengthBars: 2, patternId: '2' }
  ], 2);
  assert.equal(top.id, 'b');
});

test('rebuild merge preserves clip gain, automation, and manual placement', () => {
  const mel = emptyMelodyPattern('M', 1, [{ n: 'C4', x: 0, w: 1 }]);
  const patterns = ensurePatternBank({ melody: [mel], drums: [], chords: [] });
  const sections = [
    { name: 'Verse', bars: 2, active: { keys: true, drums: false, chords: false, vocals: false }, patterns: { keys: mel.id } }
  ];
  const base = rebuildPlaylistFromSections(sections, { melodyAdded: true });
  const edited = structuredClone(base);
  const clip = edited.tracks.find(t => t.id === 'keys').clips[0];
  clip.startBar = 1;
  clip.lengthBars = 1;
  clip.gain = 0.4;
  clip.automation = [{ bar: 0, gain: 0 }, { bar: 1, gain: 1 }];

  const rebuilt = rebuildPlaylistFromSections(sections, { melodyAdded: true });
  const merged = mergePlaylistPreservingEdits(edited, rebuilt);
  const kept = merged.tracks.find(t => t.id === 'keys').clips.find(c => c.patternId === mel.id);
  assert.equal(kept.startBar, 1);
  assert.equal(kept.lengthBars, 1);
  assert.equal(kept.gain, 0.4);
  assert.equal(kept.automation.length, 2);
});

test('resolveArrangementAtBar resolves extraTrackNotes for bass and custom tracks', () => {
  const bassPat = { id: 'b-1', name: 'Bass Sub', bars: 1, notes: [{ n: 'C2', x: 0, w: 2, v: 0.95 }] };
  const patterns = ensurePatternBank({ melody: [], bass: [bassPat], drums: [], chords: [] });
  const playlist = {
    tracks: [
      { id: 'keys', clips: [] },
      { id: 'drums', clips: [] },
      { id: 'chords', clips: [] },
      { id: 'vocals', clips: [] },
      { id: 'bass', kind: 'bass', clips: [{ id: 'clip-b', patternId: 'b-1', startBar: 0, lengthBars: 2 }] }
    ]
  };

  const songRes = resolveArrangementAtBar({
    songMode: true,
    playlist,
    patterns,
    sections: [{ name: 'Intro', bars: 2, active: { keys: true, drums: true, chords: true, vocals: true } }],
    songBar: 0,
    localStep: 0,
    meter: '4/4'
  });

  assert.ok(songRes.extraTrackNotes.bass, 'Must resolve bass in extraTrackNotes');
  assert.equal(songRes.extraTrackNotes.bass.length, 1);
  assert.equal(songRes.extraTrackNotes.bass[0].n, 'C2');

  const loopRes = resolveArrangementAtBar({
    songMode: false,
    playlist: null,
    patterns: null,
    sections: null,
    songBar: 0,
    localStep: 0,
    meter: '4/4',
    working: {
      bassPattern: [{ n: 'F1', x: 4, w: 2 }]
    }
  });

  assert.ok(loopRes.extraTrackNotes.bass, 'Must resolve bass in loop mode');
  assert.equal(loopRes.extraTrackNotes.bass[0].n, 'F1');
});
