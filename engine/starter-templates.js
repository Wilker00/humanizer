/**
 * Starter Template Gallery for BMAI
 * Pre-configured, high-energy musical templates that let any cold visitor or
 * presenter experience audible, playable music in < 5 seconds.
 */

import { normalizeTrackList } from './playlist.js';
import { defaultTransport } from './transport.js';

export const STARTER_TEMPLATES = [
  {
    id: 'rnb-latenight',
    name: 'Late-Night R&B',
    subtitle: 'Silky Rhodes & 909 pocket',
    genre: 'R&B / Soul',
    bpm: 92,
    key: 'A minor',
    meter: '4/4',
    kit: 'rnb',
    instrument: 'rhodes',
    chords: ['Am7', 'Dm7', 'Em7', 'Am7'],
    description: 'Silky Rhodes chords, 909 pocket, and a syncopated nocturnal bounce.',
    melody: [
      { n: 'E4', x: 0, w: 2, v: 0.9 },
      { n: 'G4', x: 2, w: 2, v: 0.85 },
      { n: 'A4', x: 4, w: 3, v: 1.0 },
      { n: 'C5', x: 8, w: 2, v: 0.9 },
      { n: 'B4', x: 10, w: 2, v: 0.8 },
      { n: 'G4', x: 12, w: 4, v: 0.75 }
    ],
    bass: [
      { n: 'A3', x: 0, w: 4, v: 0.95 },
      { n: 'D3', x: 4, w: 4, v: 0.9 },
      { n: 'E3', x: 8, w: 4, v: 0.9 },
      { n: 'A3', x: 12, w: 4, v: 0.95 }
    ],
    drums: {
      kick: [0, 6, 10, 14],
      snare: [4, 12],
      clap: [4, 12],
      hat: [0, 2, 4, 6, 8, 10, 12, 14],
      openhat: [2, 10],
      bass: [0, 10]
    },
    drumRolls: {},
    drumVelocity: { hat: { 2: 0.7, 6: 0.7, 10: 0.75, 14: 0.7 } },
    drumNudge: {},
    sections: [
      { name: 'Intro', bars: 2, active: { keys: true, drums: false, chords: true, vocals: false } },
      { name: 'Verse', bars: 4, active: { keys: true, drums: true, chords: true, vocals: false } },
      { name: 'Chorus', bars: 4, active: { keys: true, drums: true, chords: true, vocals: true } },
      { name: 'Outro', bars: 2, active: { keys: true, drums: false, chords: true, vocals: false } }
    ]
  },
  {
    id: 'trap-hook',
    name: 'Trap Anthem',
    subtitle: 'Rolling hats & heavy 808s',
    genre: 'Trap / Drill',
    bpm: 140,
    key: 'C minor',
    meter: '4/4',
    kit: 'trap',
    instrument: 'analog',
    chords: ['Cm', 'Ab', 'Fm', 'G7'],
    description: 'Rolling hi-hats, earth-shaking 808 sub, and aggressive analog stabs.',
    melody: [
      { n: 'C5', x: 0, w: 1, v: 1.0 },
      { n: 'D#5', x: 2, w: 1, v: 0.9 },
      { n: 'D5', x: 4, w: 2, v: 0.85 },
      { n: 'C5', x: 7, w: 1, v: 0.95 },
      { n: 'G4', x: 8, w: 2, v: 0.8 },
      { n: 'A#4', x: 12, w: 2, v: 0.9 }
    ],
    bass: [
      { n: 'C3', x: 0, w: 4, v: 1.0 },
      { n: 'G#3', x: 4, w: 4, v: 0.95 },
      { n: 'F3', x: 8, w: 4, v: 0.95 },
      { n: 'G3', x: 12, w: 4, v: 1.0 }
    ],
    drums: {
      kick: [0, 6, 11, 14],
      snare: [4, 12],
      clap: [12],
      hat: [0, 2, 4, 6, 7, 8, 10, 12, 14, 15],
      openhat: [6, 14],
      bass: [0, 8, 14]
    },
    drumRolls: { hat: { 7: 2, 15: 3 } },
    drumVelocity: { hat: { 7: 0.8, 15: 0.9 } },
    drumNudge: {},
    sections: [
      { name: 'Intro', bars: 2, active: { keys: true, drums: false, chords: true, vocals: false } },
      { name: 'Drop', bars: 4, active: { keys: true, drums: true, chords: true, vocals: true } },
      { name: 'Hook', bars: 4, active: { keys: true, drums: true, chords: true, vocals: true } },
      { name: 'Outro', bars: 2, active: { keys: true, drums: false, chords: true, vocals: false } }
    ]
  },
  {
    id: 'house-8bar',
    name: 'Deep House 8-Bar',
    subtitle: '4-on-the-floor & soulful organ',
    genre: 'House / Dance',
    bpm: 124,
    key: 'F minor',
    meter: '4/4',
    kit: 'house',
    instrument: 'organ',
    chords: ['Fm7', 'Bbm7', 'Eb7', 'Abmaj7'],
    description: 'Driving 4-on-the-floor kick, offbeat open hat, and soulful house organ stabs.',
    melody: [
      { n: 'F4', x: 2, w: 1, v: 0.9 },
      { n: 'G#4', x: 3, w: 1, v: 0.85 },
      { n: 'C5', x: 6, w: 2, v: 0.95 },
      { n: 'A#4', x: 10, w: 2, v: 0.9 },
      { n: 'D#5', x: 14, w: 2, v: 1.0 }
    ],
    bass: [
      { n: 'F3', x: 0, w: 2, v: 1.0 },
      { n: 'F3', x: 6, w: 2, v: 0.9 },
      { n: 'A#3', x: 8, w: 2, v: 0.95 },
      { n: 'D#3', x: 12, w: 2, v: 1.0 }
    ],
    drums: {
      kick: [0, 4, 8, 12],
      snare: [4, 12],
      clap: [4, 12],
      hat: [2, 6, 10, 14],
      openhat: [2, 6, 10, 14],
      bass: [0, 6, 8, 14]
    },
    drumRolls: {},
    drumVelocity: {},
    drumNudge: {},
    sections: [
      { name: 'Intro', bars: 2, active: { keys: false, drums: true, chords: false, vocals: false } },
      { name: 'Build', bars: 2, active: { keys: true, drums: true, chords: true, vocals: false } },
      { name: 'Drop', bars: 4, active: { keys: true, drums: true, chords: true, vocals: true } },
      { name: 'Outro', bars: 2, active: { keys: true, drums: true, chords: false, vocals: false } }
    ]
  },
  {
    id: 'lofi-sketch',
    name: 'Lo-Fi Coffee Sketch',
    subtitle: 'Warm nylon guitar & jazz chords',
    genre: 'Lo-Fi / Chill',
    bpm: 82,
    key: 'E minor',
    meter: '4/4',
    kit: 'rnb',
    instrument: 'guitar',
    chords: ['Em9', 'Am9', 'D9', 'Gmaj7'],
    description: 'Dusty swinging beat, warm nylon guitar, and nostalgic jazz chords.',
    melody: [
      { n: 'B4', x: 0, w: 3, v: 0.8 },
      { n: 'G4', x: 4, w: 2, v: 0.75 },
      { n: 'F#4', x: 7, w: 2, v: 0.7 },
      { n: 'E4', x: 10, w: 4, v: 0.85 }
    ],
    bass: [
      { n: 'E3', x: 0, w: 4, v: 0.9 },
      { n: 'A3', x: 4, w: 4, v: 0.85 },
      { n: 'D3', x: 8, w: 4, v: 0.85 },
      { n: 'G3', x: 12, w: 4, v: 0.9 }
    ],
    drums: {
      kick: [0, 7, 10],
      snare: [4, 12],
      hat: [0, 2, 4, 6, 8, 10, 12, 14],
      openhat: [10],
      bass: [0, 10]
    },
    drumRolls: {},
    drumVelocity: { hat: { 2: 0.6, 6: 0.65, 10: 0.7, 14: 0.6 } },
    drumNudge: { snare: { 4: 1, 12: 1 } },
    sections: [
      { name: 'Intro', bars: 2, active: { keys: true, drums: false, chords: true, vocals: false } },
      { name: 'Chill Loop', bars: 4, active: { keys: true, drums: true, chords: true, vocals: false } },
      { name: 'Solo', bars: 4, active: { keys: true, drums: true, chords: true, vocals: true } },
      { name: 'Outro', bars: 2, active: { keys: true, drums: false, chords: true, vocals: false } }
    ]
  },
  {
    id: 'acoustic-ballad',
    name: 'Acoustic Sunset',
    subtitle: 'Grand piano & organic groove',
    genre: 'Acoustic / Pop',
    bpm: 76,
    key: 'G major',
    meter: '4/4',
    kit: 'acoustic',
    instrument: 'piano',
    chords: ['G', 'D', 'Em', 'C'],
    description: 'Warm grand piano chords, organic recorded drums, and an uplifting vocal pocket.',
    melody: [
      { n: 'D4', x: 0, w: 2, v: 0.85 },
      { n: 'G4', x: 2, w: 2, v: 0.9 },
      { n: 'B4', x: 4, w: 3, v: 0.95 },
      { n: 'A4', x: 8, w: 3, v: 0.9 },
      { n: 'G4', x: 12, w: 4, v: 0.85 }
    ],
    bass: [
      { n: 'G3', x: 0, w: 4, v: 0.9 },
      { n: 'D3', x: 4, w: 4, v: 0.9 },
      { n: 'E3', x: 8, w: 4, v: 0.85 },
      { n: 'C3', x: 12, w: 4, v: 0.95 }
    ],
    drums: {
      kick: [0, 8, 10],
      snare: [4, 12],
      clap: [4, 12],
      hat: [0, 2, 4, 6, 8, 10, 12, 14],
      openhat: [10],
      bass: [0, 8]
    },
    drumRolls: {},
    drumVelocity: {},
    drumNudge: {},
    sections: [
      { name: 'Intro', bars: 2, active: { keys: true, drums: false, chords: true, vocals: false } },
      { name: 'Verse', bars: 4, active: { keys: true, drums: true, chords: true, vocals: false } },
      { name: 'Chorus', bars: 4, active: { keys: true, drums: true, chords: true, vocals: true } },
      { name: 'Outro', bars: 2, active: { keys: true, drums: false, chords: true, vocals: false } }
    ]
  },
  {
    id: 'dj-set-loop',
    name: 'DJ Club Drop',
    subtitle: 'Driving tech drums & sharp pluck',
    genre: 'Tech / DJ Set',
    bpm: 128,
    key: 'D minor',
    meter: '4/4',
    kit: 'dj',
    instrument: 'pluck',
    chords: ['Dm', 'Bb', 'C', 'Am'],
    description: 'Punchy kick, energetic percussion, vinyl accents, and sharp melodic plucks.',
    melody: [
      { n: 'D4', x: 0, w: 1, v: 0.95 },
      { n: 'F4', x: 2, w: 1, v: 0.9 },
      { n: 'A4', x: 4, w: 2, v: 1.0 },
      { n: 'G4', x: 8, w: 2, v: 0.85 },
      { n: 'F4', x: 12, w: 1, v: 0.9 },
      { n: 'E4', x: 14, w: 1, v: 0.85 }
    ],
    bass: [
      { n: 'D3', x: 0, w: 4, v: 1.0 },
      { n: 'A#3', x: 4, w: 4, v: 0.95 },
      { n: 'C3', x: 8, w: 4, v: 0.95 },
      { n: 'A3', x: 12, w: 4, v: 0.9 }
    ],
    drums: {
      kick: [0, 6, 10],
      snare: [4, 12],
      clap: [4, 12],
      hat: [2, 6, 10, 14],
      openhat: [10],
      bass: [0, 8, 14]
    },
    drumRolls: {},
    drumVelocity: {},
    drumNudge: {},
    sections: [
      { name: 'Build', bars: 2, active: { keys: true, drums: true, chords: false, vocals: false } },
      { name: 'Drop', bars: 4, active: { keys: true, drums: true, chords: true, vocals: true } },
      { name: 'Break', bars: 2, active: { keys: true, drums: false, chords: true, vocals: false } },
      { name: 'Outro', bars: 2, active: { keys: false, drums: true, chords: false, vocals: false } }
    ]
  },
  {
    id: 'synthwave-drive',
    name: 'Synthwave Sunset Drive',
    subtitle: 'Analog lead & retro gated snare',
    genre: 'Synthwave / Retro',
    bpm: 110,
    key: 'B minor',
    meter: '4/4',
    kit: 'trap',
    instrument: 'analog',
    chords: ['Bm', 'G', 'A', 'F#m'],
    description: 'Retro 80s arpeggios, gated snare, pumping sidechain, and cyber-neon chords.',
    melody: [
      { n: 'F#4', x: 0, w: 2, v: 0.9 },
      { n: 'B4', x: 2, w: 2, v: 0.95 },
      { n: 'D5', x: 4, w: 2, v: 1.0 },
      { n: 'C#5', x: 6, w: 2, v: 0.85 },
      { n: 'A4', x: 8, w: 4, v: 0.9 },
      { n: 'F#4', x: 12, w: 4, v: 0.85 }
    ],
    bass: [
      { n: 'B3', x: 0, w: 4, v: 1.0 },
      { n: 'G3', x: 4, w: 4, v: 0.95 },
      { n: 'A3', x: 8, w: 4, v: 0.95 },
      { n: 'F#3', x: 12, w: 4, v: 0.9 }
    ],
    drums: {
      kick: [0, 4, 8, 12],
      snare: [4, 12],
      hat: [0, 2, 4, 6, 8, 10, 12, 14],
      openhat: [2, 10],
      bass: [0, 8, 14]
    },
    drumRolls: {},
    drumVelocity: {},
    drumNudge: {},
    sections: [
      { name: 'Intro', bars: 2, active: { keys: true, drums: false, chords: true, vocals: false } },
      { name: 'Verse', bars: 4, active: { keys: true, drums: true, chords: true, vocals: false } },
      { name: 'Chorus', bars: 4, active: { keys: true, drums: true, chords: true, vocals: true } },
      { name: 'Outro', bars: 2, active: { keys: true, drums: false, chords: true, vocals: false } }
    ]
  },
  {
    id: 'afrobeat-pocket',
    name: 'Afrobeat Groove',
    subtitle: 'Syncopated shaker & flute hook',
    genre: 'Afrobeat / Tropical',
    bpm: 104,
    key: 'G minor',
    meter: '4/4',
    kit: 'rnb',
    instrument: 'flute',
    chords: ['Gm7', 'Cm7', 'Dm7', 'Gm7'],
    description: 'Syncopated shaker rhythm, melodic flute hook, and an infectious dancefloor groove.',
    melody: [
      { n: 'G4', x: 0, w: 2, v: 0.9 },
      { n: 'A#4', x: 3, w: 2, v: 0.95 },
      { n: 'D5', x: 6, w: 2, v: 1.0 },
      { n: 'C5', x: 9, w: 2, v: 0.85 },
      { n: 'A#4', x: 12, w: 2, v: 0.9 },
      { n: 'G4', x: 14, w: 2, v: 0.8 }
    ],
    bass: [
      { n: 'G3', x: 0, w: 3, v: 0.95 },
      { n: 'C3', x: 4, w: 3, v: 0.9 },
      { n: 'D3', x: 8, w: 3, v: 0.9 },
      { n: 'G3', x: 12, w: 3, v: 0.95 }
    ],
    drums: {
      kick: [0, 6, 10, 14],
      snare: [4, 12],
      clap: [4, 12],
      hat: [0, 2, 3, 6, 8, 10, 11, 14],
      openhat: [2, 10],
      bass: [0, 10]
    },
    drumRolls: {},
    drumVelocity: {},
    drumNudge: {},
    sections: [
      { name: 'Intro', bars: 2, active: { keys: true, drums: false, chords: true, vocals: false } },
      { name: 'Groove', bars: 4, active: { keys: true, drums: true, chords: true, vocals: false } },
      { name: 'Hook', bars: 4, active: { keys: true, drums: true, chords: true, vocals: true } },
      { name: 'Outro', bars: 2, active: { keys: true, drums: false, chords: true, vocals: false } }
    ]
  }
];

/**
 * Creates a fully validated Schema v3 BMAI project from a starter template definition.
 *
 * @param {Object} template
 * @returns {Object} Valid BMAI schema v3 project snapshot
 */
export function createProjectFromTemplate(template) {
  const id = crypto.randomUUID();
  const melodyPatternId = crypto.randomUUID();
  const bassPatternId = crypto.randomUUID();
  const drumPatternId = crypto.randomUUID();
  const chordPatternId = crypto.randomUUID();

  const melodyNotes = (template.melody || []).map(n => ({ ...n }));
  const bassNotes = (template.bass || []).map(n => ({ ...n }));
  const drumHits = {};
  for (const [lane, hits] of Object.entries(template.drums || {})) {
    drumHits[lane] = Array.isArray(hits) ? [...hits] : Array.from(hits);
  }

  const defaultMix = {
    keys: { mute: false, solo: false, vol: 0.8, pan: 0, send: 0.15 },
    drums: { mute: false, solo: false, vol: 0.8, pan: 0, send: 0.05 },
    chords: { mute: false, solo: false, vol: 0.55, pan: 0, send: 0.2 },
    vocals: { mute: false, solo: false, vol: 0.75, pan: 0, send: 0.25 },
    bass: { mute: false, solo: false, vol: 0.85, pan: 0, send: 0 }
  };

  const tracks = [
    { id: 'keys', name: 'Lead / Melody', kind: 'melody', color: '#38bdf8', mix: { ...defaultMix.keys }, patch: { instrument: template.instrument || 'rhodes' } },
    { id: 'drums', name: 'Drums', kind: 'drums', color: '#f59e0b', mix: { ...defaultMix.drums }, patch: { kit: template.kit || 'rnb' } },
    { id: 'chords', name: 'Chords', kind: 'chords', color: '#a855f7', mix: { ...defaultMix.chords }, patch: { instrument: template.instrument || 'rhodes' } },
    { id: 'bass', name: 'Bass Track', kind: 'bass', color: '#10b981', mix: { ...defaultMix.bass }, patch: { instrument: 'bass' } },
    { id: 'vocals', name: 'Vocals', kind: 'audio', color: '#ec4899', mix: { ...defaultMix.vocals }, patch: {} }
  ];

  const sections = (template.sections || []).map((sec, idx) => ({
    name: sec.name,
    bars: sec.bars || 2,
    active: { ...sec.active, bass: sec.active?.drums ?? true },
    patterns: {
      keys: melodyPatternId,
      bass: bassPatternId,
      drums: drumPatternId,
      chords: chordPatternId
    }
  }));

  // Build playlist clips following section layout
  let currentBar = 0;
  const playlistTracks = tracks.map(trk => ({ id: trk.id, clips: [] }));

  sections.forEach((sec, sIdx) => {
    const start = currentBar;
    const len = sec.bars;
    if (sec.active.keys) {
      playlistTracks.find(t => t.id === 'keys')?.clips.push({ id: `c-keys-${sIdx}`, patternId: melodyPatternId, startBar: start, lengthBars: len });
    }
    if (sec.active.drums) {
      playlistTracks.find(t => t.id === 'drums')?.clips.push({ id: `c-drums-${sIdx}`, patternId: drumPatternId, startBar: start, lengthBars: len });
    }
    if (sec.active.chords) {
      playlistTracks.find(t => t.id === 'chords')?.clips.push({ id: `c-chords-${sIdx}`, patternId: chordPatternId, startBar: start, lengthBars: len });
    }
    if (sec.active.bass) {
      playlistTracks.find(t => t.id === 'bass')?.clips.push({ id: `c-bass-${sIdx}`, patternId: bassPatternId, startBar: start, lengthBars: len });
    }
    currentBar += len;
  });

  return {
    schemaVersion: 3,
    id,
    name: template.name,
    description: template.description || '',
    updated: Date.now(),
    bpm: template.bpm || 92,
    key: template.key || 'A minor',
    prompt: template.description || template.name,
    chips: [template.genre || 'R&B'],
    pattern: melodyNotes,
    idea: 0,
    melodyDrafts: [melodyNotes, [], [], []],
    instrument: template.instrument || 'rhodes',
    chordInstrument: template.instrument || 'rhodes',
    swing: template.kit === 'rnb' ? 18 : template.kit === 'trap' ? 12 : 8,
    meter: template.meter || '4/4',
    kit: template.kit || 'rnb',
    drums: drumHits,
    drumRolls: template.drumRolls || {},
    drumVelocity: template.drumVelocity || {},
    drumNudge: template.drumNudge || {},
    drumChokeGroups: { hat: 1, openhat: 1 },
    drumLanes: Object.keys(drumHits),
    drumPatternBars: 1,
    bassPattern: bassNotes,
    bassPatternBars: 1,
    activeTrackId: 'keys',
    drumMix: {},
    chords: { name: `${template.name} Chords`, bars: [...(template.chords || ['Am7', 'Dm7', 'Em7', 'Am7'])] },
    chordVoice: { inversion: 0, octave: 0 },
    chordAdded: true,
    drumsAdded: true,
    melodyAdded: true,
    vocals: { title: 'Soft hook', line: 'Ready for vocals', chain: 'Modern R&B' },
    vocalAdded: false,
    vocalTakes: [],
    vocalRec: { inputId: 'default', monitor: false, countIn: 4 },
    mix: defaultMix,
    tracks,
    transport: { ...defaultTransport(), exportToBar: currentBar },
    drumPunch: true,
    customSamples: {},
    customSampleAssets: {},
    fx: { reverb: 0.25, delay: 0.15, filter: 0 },
    eq: { low: 0, mid: 0, high: 0 },
    masterLimiter: true,
    sidechain: true,
    bassTuned: true,
    drumTrim: {},
    songMode: false,
    songSection: 0,
    sections,
    patterns: {
      melody: [{ id: melodyPatternId, name: `${template.name} Lead`, bars: 1, notes: melodyNotes }],
      bass: [{ id: bassPatternId, name: `${template.name} Bass`, bars: 1, notes: bassNotes }],
      drums: [{ id: drumPatternId, name: `${template.name} Beat`, bars: 1, steps: drumHits, rolls: template.drumRolls || {}, velocity: template.drumVelocity || {}, nudge: template.drumNudge || {}, chokeGroups: { hat: 1, openhat: 1 } }],
      chords: [{ id: chordPatternId, name: `${template.name} Chords`, bars: 1, progression: { name: `${template.name} Chords`, bars: [...(template.chords || [])] } }]
    },
    activePatternIds: {
      melody: melodyPatternId,
      bass: bassPatternId,
      drums: drumPatternId,
      chords: chordPatternId
    },
    playlist: { tracks: playlistTracks }
  };
}

