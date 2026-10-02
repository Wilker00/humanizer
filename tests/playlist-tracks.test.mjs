import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyPlaylist,
  normalizePlaylist,
  normalizeTrackList,
  addTrack,
  duplicateTrack,
  deleteTrack,
  renameTrack,
  reorderTracks,
  splitClip,
  joinClips,
  pasteClips,
  cloneClips,
  deleteClips,
  duplicateClip,
  snapValue,
  moveClip,
  createClipId
} from '../engine/playlist.js';
import { migrateProjectToV3, validateProject } from '../engine/project-format.js';
import { nextPlaybackStep, clampExportRange, barToStep, normalizeTransport } from '../engine/transport.js';

test('snapValue supports bar beat and sixteenth', () => {
  assert.equal(snapValue(1.4, 'bar'), 1);
  assert.equal(snapValue(1.3, 'beat'), 1.25);
  assert.equal(snapValue(1.1, '1/16'), 1.125);
  assert.equal(snapValue(1.333, 'off'), 1.333);
});

test('independent tracks can be added duplicated renamed and deleted', () => {
  const tracks = normalizeTrackList(null, null);
  const playlist = emptyPlaylist(tracks.map(t => t.id));
  const lead = addTrack(tracks, playlist, { kind: 'lead', name: 'Lead A' });
  assert.ok(lead.id);
  assert.equal(tracks.some(t => t.id === lead.id), true);
  assert.ok(playlist.tracks.find(t => t.id === lead.id));
  const copy = duplicateTrack(tracks, playlist, lead.id);
  assert.equal(copy.name, 'Lead A copy');
  renameTrack(tracks, copy.id, 'Lead B');
  assert.equal(tracks.find(t => t.id === copy.id).name, 'Lead B');
  reorderTracks(tracks, playlist, copy.id, tracks[0].id);
  assert.equal(tracks[0].id, copy.id);
  assert.equal(deleteTrack(tracks, playlist, 'keys'), false);
  assert.equal(deleteTrack(tracks, playlist, copy.id, {}), true);
});

test('clip split join copy paste', () => {
  const playlist = emptyPlaylist();
  const clip = {
    id: createClipId(),
    patternId: 'pat-1',
    startBar: 0,
    lengthBars: 4,
    gain: 1,
    automation: []
  };
  playlist.tracks.find(t => t.id === 'keys').clips.push(clip);
  const right = splitClip(playlist, 'keys', clip.id, 2, 'bar');
  assert.ok(right);
  assert.equal(clip.lengthBars, 2);
  assert.equal(right.startBar, 2);
  const joined = joinClips(playlist, 'keys', clip.id, right.id);
  assert.ok(joined);
  assert.equal(joined.lengthBars, 4);
  const dup = duplicateClip(playlist, 'keys', joined.id);
  assert.equal(dup.startBar, 4);
  const clipboard = cloneClips(playlist, [{ trackId: 'keys', clipId: joined.id }]);
  pasteClips(playlist, clipboard, 8, 'bar');
  assert.equal(playlist.tracks.find(t => t.id === 'keys').clips.length, 3);
  deleteClips(playlist, [{ trackId: 'keys', clipId: dup.id }]);
  assert.equal(playlist.tracks.find(t => t.id === 'keys').clips.length, 2);
  moveClip(playlist, 'keys', joined.id, 1.25, 'beat');
  assert.equal(joined.startBar, 1.25);
});

test('migrateProjectToV3 adds tracks and transport', () => {
  const migrated = migrateProjectToV3({
    schemaVersion: 1,
    pattern: [],
    drums: { kick: [], snare: [], clap: [], hat: [], openhat: [], bass: [] },
    sections: [{ name: 'Intro', bars: 2, active: { keys: true, drums: true, chords: true, vocals: false } }],
    mix: { keys: { vol: 0.5, mute: false, solo: false, pan: 0 } }
  });
  assert.equal(migrated.schemaVersion, 3);
  assert.ok(migrated.tracks.length >= 4);
  assert.ok(migrated.transport);
  assert.equal(migrated.mix.keys.vol, 0.5);
  validateProject(migrated);
});

test('normalizePlaylist keeps extra tracks', () => {
  const tracks = normalizeTrackList([{ id: 'lead-1', name: 'Lead', kind: 'lead' }]);
  const raw = {
    tracks: [
      { id: 'keys', clips: [] },
      { id: 'lead-1', clips: [{ id: 'c1', patternId: 'p', startBar: 0, lengthBars: 1 }] }
    ]
  };
  const playlist = normalizePlaylist(raw, tracks);
  assert.ok(playlist.tracks.find(t => t.id === 'lead-1')?.clips.length === 1);
});

test('track patch rack sampler and clip polish metadata normalize', () => {
  const tracks = normalizeTrackList([{
    id: 'sampler-1',
    name: 'Sampler',
    kind: 'midi',
    mix: { delaySend: 0.4, delayPre: true, cue: 0.8 },
    patch: {
      attack: 0.5,
      filterHz: 9000,
      sampler: { url: 'bmai-asset:abc', name: 'Hit', rootKey: 'D4', lowKey: 'C3', highKey: 'C5', loopStart: 0.2, loopEnd: 0.7, gain: 0.6 }
    },
    fx: [{ type: 'saturator', params: { drive: 0.7 } }]
  }]);
  const sampler = tracks.find(t => t.id === 'sampler-1');
  assert.equal(sampler.mix.delayPre, true);
  assert.equal(sampler.patch.sampler.rootKey, 'D4');
  assert.equal(sampler.fx[0].type, 'saturator');

  const playlist = normalizePlaylist({
    tracks: [{ id: 'sampler-1', clips: [{
      id: 'c1',
      patternId: 'p1',
      startBar: 0,
      lengthBars: 2,
      warpMode: 'beats',
      sourceBpm: 100,
      slip: 0.25,
      locked: true,
      muted: true,
      pitchCorrection: { enabled: true, semitone: 2, snapToScale: true }
    }] }]
  }, tracks);
  const clip = playlist.tracks.find(t => t.id === 'sampler-1').clips[0];
  assert.equal(clip.warpMode, 'beats');
  assert.equal(clip.locked, true);
  assert.equal(clip.pitchCorrection.semitone, 2);
});

test('loop region wraps playback steps', () => {
  const next = nextPlaybackStep(31, {
    loopSteps: 64,
    songMode: true,
    loopEnabled: true,
    loopStartBar: 1,
    loopEndBar: 2,
    meter: '4/4'
  });
  assert.equal(next, 16);
});

test('export range clamp', () => {
  assert.deepEqual(clampExportRange(0, 4, 8), { fromBar: 0, toBar: 4 });
  assert.deepEqual(clampExportRange(2, null, 8), { fromBar: 2, toBar: 8 });
  assert.equal(barToStep(2, '4/4'), 32);
  const transport = normalizeTransport({ loopEnabled: true, snap: 'beat' }, 8);
  assert.equal(transport.snap, 'beat');
  assert.equal(transport.loopEnabled, true);
});
