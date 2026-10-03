import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureMix, freshSessionFields } from '../engine/song-session.js';

test('producer mix defaults include centered pan and preserve master silence', () => {
  const track = ensureMix({ type: 'melody' });
  assert.equal(track.pan, 0);
  assert.equal(track.send, 0);
  assert.equal(track.delaySend, 0);

  const session = freshSessionFields({ bars: 8, tracks: [track], masterVolume: 0 });
  assert.equal(session.masterVolume, 0);
  assert.equal(session.transport.loopStartBar, 0);
  assert.equal(session.transport.loopEndBar, 8);
});

test('producer mix clamps imported pan and master gain to safe UI ranges', () => {
  const session = freshSessionFields({
    bars: 4,
    tracks: [{ type: 'bass', pan: 5 }],
    masterVolume: 4,
    transport: { loopEnabled: true, loopStartBar: 2, loopEndBar: 99 }
  });
  assert.equal(session.tracks[0].pan, 1);
  assert.equal(session.masterVolume, 1.25);
  assert.equal(session.transport.loopEnabled, true);
  assert.equal(session.transport.loopEndBar, 4);
});
