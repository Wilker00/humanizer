import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProject, migrateProjectToV2 } from '../engine/project-format.js';
import { ensurePatternBank, emptyMelodyPattern, duplicatePatternInBank } from '../engine/patterns.js';
import { rebuildPlaylistFromSections, resolvePatternAtBar, automationGainAt, totalSongBars } from '../engine/playlist.js';

const project = () => ({name:'Test',pattern:[{n:'C4',x:0,w:2}],drums:{kick:[0,8]},bpm:92,key:'A minor',kit:'rnb'});
test('legacy projects and valid FX retain their contents without mutation',()=>{
  const value={...project(),fx:{filter:-67,reverb:.22,delay:.15},eq:{low:-6,mid:2,high:4}};
  const before=structuredClone(value);
  assert.equal(validateProject(value,{keys:['A minor'],kits:['rnb']}),value);
  assert.deepEqual(value,before);
});
test('malformed musical data is rejected before it reaches playback',()=>{
  for(const patch of [
    {bpm:-1}, {bpm:Infinity}, {pattern:[{n:'bad',x:0,w:1}]},
    {pattern:[{n:'C4',x:200,w:2}]}, {drums:{kick:[200]}}, {idea:4},
    {sections:[{name:'Bad',bars:1000,active:{}}]}, {mix:{keys:{vol:'loud'}}},
    {chords:{bars:[]}}, {schemaVersion:999}, {customSampleAssets:[]},
    {drumRolls:{kick:{0:500}}}, {fx:{filter:101}},
  ]) assert.throws(()=>validateProject({...project(),...patch}),/Invalid project/);
});
test('unknown project formats and keys fail with useful errors',()=>{
  for(const value of [null,[],{}, {pattern:[]}]) assert.throws(()=>validateProject(value),/structure/);
  assert.throws(()=>validateProject(project(),{keys:['C major']}),/key/);
});
test('schema v1 migrates to pattern bank and playlist',()=>{
  const migrated = migrateProjectToV2({
    ...project(),
    melodyAdded: true,
    drumsAdded: true,
    chordAdded: true,
    chords: { name: 'Moonlit', bars: ['Am7','Fmaj7'] },
    sections: [
      { name: 'Verse', bars: 2, active: { keys: true, drums: true, chords: true, vocals: false } },
      { name: 'Hook', bars: 2, active: { keys: true, drums: true, chords: true, vocals: true } }
    ],
    sectionPatterns: { '1': [{ n: 'E4', x: 0, w: 2 }] }
  });
  assert.equal(migrated.schemaVersion, 2);
  assert.ok(migrated.patterns.melody.length >= 2);
  assert.equal(migrated.patterns.drums.length, 1);
  assert.equal(totalSongBars(migrated.sections), 4);
  assert.ok(migrated.playlist.tracks.find(t => t.id === 'drums').clips.length >= 1);
  assert.notEqual(migrated.sections[0].patterns.keys, migrated.sections[1].patterns.keys);
});
test('v2 projects validate pattern banks and velocity notes',()=>{
  const migrated = migrateProjectToV2(project());
  migrated.patterns.melody[0].notes = [{ n: 'C4', x: 0, w: 2, v: 0.8 }];
  assert.equal(validateProject(migrated, { keys: ['A minor'], kits: ['rnb'] }), migrated);
});
test('unique patterns and automation resolve per bar',()=>{
  const bank = ensurePatternBank({
    melody: [emptyMelodyPattern('A', 1, [{ n: 'C4', x: 0, w: 1 }])],
    drums: [],
    chords: []
  });
  const copy = duplicatePatternInBank(bank, 'melody', bank.melody[0].id, 'B');
  copy.notes = [{ n: 'G4', x: 0, w: 1 }];
  const sections = [
    { name: 'Verse', bars: 1, active: { keys: true, drums: false, chords: false, vocals: false }, patterns: { keys: bank.melody[0].id } },
    { name: 'Hook', bars: 1, active: { keys: true, drums: false, chords: false, vocals: false }, patterns: { keys: copy.id } }
  ];
  const playlist = rebuildPlaylistFromSections(sections, { melodyAdded: true });
  const verse = resolvePatternAtBar(playlist, bank, 'keys', 'melody', 0);
  const hook = resolvePatternAtBar(playlist, bank, 'keys', 'melody', 1);
  assert.equal(verse.pattern.notes[0].n, 'C4');
  assert.equal(hook.pattern.notes[0].n, 'G4');
  const clip = playlist.tracks[0].clips[0];
  clip.automation = [{ bar: 0, gain: 0 }, { bar: 1, gain: 1 }];
  assert.ok(automationGainAt(clip, 0) < 0.1);
  assert.ok(automationGainAt(clip, 0.5) > 0.4);
});
