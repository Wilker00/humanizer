import { parsePitchToMidi, midiToPitch } from './score-tools.js';

export const CHORD_STAMPS = {
  maj: { name: 'Major', intervals: [0, 4, 7] },
  min: { name: 'Minor', intervals: [0, 3, 7] },
  dom7: { name: '7th (Dominant)', intervals: [0, 4, 7, 10] },
  maj7: { name: 'Major 7th', intervals: [0, 4, 7, 11] },
  min7: { name: 'Minor 7th', intervals: [0, 3, 7, 10] },
  min9: { name: 'Minor 9th', intervals: [0, 3, 7, 10, 14] },
  maj9: { name: 'Major 9th', intervals: [0, 4, 7, 11, 14] },
  sus2: { name: 'Sus2', intervals: [0, 2, 7] },
  sus4: { name: 'Sus4', intervals: [0, 5, 7] },
  dim: { name: 'Diminished', intervals: [0, 3, 6] },
  aug: { name: 'Augmented', intervals: [0, 4, 8] }
};

export function expandChordStamp(rootPitch, stampType) {
  const stamp = CHORD_STAMPS[stampType];
  if (!stamp) return [rootPitch];
  const rootMidi = parsePitchToMidi(rootPitch);
  return stamp.intervals.map(interval => midiToPitch(rootMidi + interval));
}
