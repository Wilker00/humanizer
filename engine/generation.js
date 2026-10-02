/**
 * Procedural phrase and groove tools. Not a prompt model.
 * Locked notes and lanes are kept; everything else can be rewritten.
 */

const PITCHES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };

/**
 * Map a short music brief onto the controls this local phrase generator has.
 * This is transparent keyword matching, not natural-language AI.
 */
export function interpretMusicPrompt(input = '') {
  const text = String(input || '').toLowerCase();
  const result = {
    kit: 'rnb', key: null, bpm: null, chips: ['R&B'],
    density: 0.55, register: 0.5, variation: 0.45, matched: []
  };
  const add = value => { if (!result.matched.includes(value)) result.matched.push(value); };

  const bpm = text.match(/\b(\d{2,3})\s*(?:bpm|beats per minute)\b/);
  if (bpm) {
    result.bpm = Math.max(40, Math.min(240, Number(bpm[1])));
    add(`${result.bpm} BPM`);
  }
  const key = text.match(/\b(?:key\s+of|in)\s+([a-g](?:#|b)?)\s*(major|minor|maj|min|m)\b/);
  if (key) {
    const root = key[1][0].toUpperCase() + key[1].slice(1);
    result.key = `${root} ${/^(minor|min|m)$/.test(key[2]) ? 'minor' : 'major'}`;
    add(result.key);
  }

  const kits = [
    ['dnb', /\b(drum\s*(?:&|and)\s*bass|dnb|jungle)\b/],
    ['house', /\b(house|deep house|four on the floor)\b/],
    ['trap', /\b(trap|drill|808|hip[- ]?hop|rap)\b/],
    ['acoustic', /\b(acoustic|live drums|organic)\b/],
    ['dj', /\b(dj set|club mix)\b/],
    ['rnb', /\b(r&b|rnb|soul|pop|lo[- ]?fi|ambient)\b/]
  ];
  const kit = kits.find(([, pattern]) => pattern.test(text));
  if (kit) {
    result.kit = kit[0];
    add(({ dnb: 'Drum & bass', rnb: 'R&B', dj: 'DJ set' })[kit[0]] || kit[0][0].toUpperCase() + kit[0].slice(1));
  }
  const chips = [];
  if (/\b(r&b|rnb|soul|pop|hip[- ]?hop|rap|trap)\b/.test(text)) chips.push('R&B');
  if (/\b(dark|moody|minor|late[- ]?night|brooding)\b/.test(text)) chips.push('Dark');
  if (/\b(smooth|warm|soft|dreamy|silky)\b/.test(text)) chips.push('Smooth');
  if (/\b(simple|sparse|minimal|few notes|laid[- ]?back)\b/.test(text)) chips.push('Simple');
  if (chips.length) result.chips = chips;

  if (/\b(sparse|minimal|simple|few notes|spacious)\b/.test(text)) { result.density = 0.3; add('sparse'); }
  else if (/\b(busy|dense|energetic|driving|lots of notes)\b/.test(text)) { result.density = 0.8; add('dense'); }
  if (/\b(low|deep|dark bass|subby|lower register)\b/.test(text)) { result.register = 0.25; add('low register'); }
  else if (/\b(dark|moody|brooding)\b/.test(text)) { result.register = 0.28; add('low register'); }
  else if (/\b(high|bright|soaring|upper register)\b/.test(text)) { result.register = 0.78; add('high register'); }
  if (/\b(subtle|steady|consistent|restrained)\b/.test(text)) { result.variation = 0.2; add('subtle variation'); }
  else if (/\b(smooth|warm|soft|dreamy|silky)\b/.test(text)) { result.variation = 0.25; add('subtle variation'); }
  else if (/\b(unpredictable|surprising|loose|varied|experimental)\b/.test(text)) { result.variation = 0.75; add('loose variation'); }
  return result;
}

function clamp01(value, fallback = 0.5) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

export function pitchClassOf(note) {
  const match = String(note || '').match(/^([A-G](?:#|b)?)/);
  if (!match) return 'C';
  return FLATS[match[1]] || match[1];
}

export function keyRootName(key) {
  const match = String(key || '').match(/^([A-G][b#]?)/);
  return match ? match[1] : 'A';
}

export function parseChordClasses(symbol) {
  const match = String(symbol || '').match(/^([A-G][b#]?)(.*)$/);
  if (!match) return [];
  const root = pitchClassOf(match[1]);
  const rest = match[2] || '';
  const rootIdx = PITCHES.indexOf(root);
  if (rootIdx < 0) return [root];
  const minor = /^m(?!aj)/i.test(rest);
  const third = minor ? 3 : 4;
  const classes = [root, PITCHES[(rootIdx + third) % 12], PITCHES[(rootIdx + 7) % 12]];
  if (/7|9|13/.test(rest)) {
    const seventh = /maj7|maj9/i.test(rest) ? 11 : (minor ? 10 : 10);
    classes.push(PITCHES[(rootIdx + seventh) % 12]);
  }
  return classes;
}

export function chordPitchClasses(symbols = []) {
  const set = [];
  for (const symbol of symbols || []) {
    for (const pc of parseChordClasses(symbol)) {
      if (!set.includes(pc)) set.push(pc);
    }
  }
  return set;
}

function snapToChord(note, scale, classes) {
  if (!classes?.length) return note;
  if (classes.includes(pitchClassOf(note))) return note;
  const oct = (String(note).match(/(\d)/) || [null, '4'])[1];
  const sameOctave = scale.find(item => String(item).endsWith(oct) && classes.includes(pitchClassOf(item)));
  if (sameOctave) return sameOctave;
  return scale.find(item => classes.includes(pitchClassOf(item))) || note;
}

export function mergeLockedNotes(generated = [], locked = []) {
  const kept = (locked || []).filter(note => note && note.n != null && note.x != null);
  const blocked = new Set();
  for (const note of kept) {
    const width = Math.max(1, Number(note.w) || 1);
    for (let i = 0; i < width; i++) blocked.add(Number(note.x) + i);
  }
  const rest = (generated || []).filter(note => !blocked.has(note.x));
  return [...kept.map(note => ({ ...note, locked: true })), ...rest]
    .sort((a, b) => a.x - b.x || String(a.n).localeCompare(String(b.n)));
}

/**
 * Scale-aware phrase. `chordClasses` pulls notes onto the harmony when set.
 * Locked notes replace anything generated on the same steps.
 */
export function buildConstrainedPhrase(scale, style = 0, options = {}) {
  const tones = Array.isArray(scale) && scale.length ? scale : ['A3', 'C4', 'E4', 'G4'];
  const rng = options.rng || Math.random;
  const density = clamp01(options.density, 0.55);
  const register = clamp01(options.register, 0.5);
  const classes = options.chordClasses || [];
  const count = Math.max(2, Math.min(12, Math.round(2 + density * (style === 2 ? 3 : 8))));
  const center = Math.floor((1 - register) * Math.max(0, tones.length - 1) * 0.25 + register * (tones.length - 1) * 0.8);
  const notes = [];
  for (let i = 0; i < count; i++) {
    const span = Math.max(1, 16 / count);
    const x = Math.min(15, Math.round(i * span));
    const wander = style === 2 ? 1 : 4;
    let degree = center + Math.floor((rng() - 0.5) * wander);
    degree = ((degree % tones.length) + tones.length) % tones.length;
    const width = rng() > (style === 1 ? 0.45 : 0.72) ? 2 : 1;
    let note = tones[degree];
    if (classes.length && rng() > 0.2) note = snapToChord(note, tones, classes);
    notes.push({ n: note, x, w: Math.min(width, 16 - x) });
  }
  return mergeLockedNotes(notes, options.locked || []);
}

export function rewriteDrumLanes(current = {}, kitSteps = {}, { lockedLanes = [], lanes = [], rng = Math.random, variation = 0.45 } = {}) {
  const locked = new Set(lockedLanes || []);
  const vary = clamp01(variation, 0.45);
  const next = {};
  const laneList = lanes.length ? lanes : Object.keys({ ...kitSteps, ...current });
  for (const lane of laneList) {
    const existing = current[lane] instanceof Set ? [...current[lane]] : [...(current[lane] || [])];
    if (locked.has(lane)) {
      next[lane] = existing;
      continue;
    }
    const base = [...(kitSteps[lane] || existing)];
    if (lane === 'hat' || lane === 'openhat') {
      for (const step of [1, 3, 7, 9, 11, 15]) {
        if (rng() < vary) {
          const index = base.indexOf(step);
          if (index >= 0) base.splice(index, 1);
          else base.push(step);
        }
      }
    }
    if (lane === 'kick') {
      for (const step of [5, 9, 13]) {
        if (rng() < vary * 0.45 && !base.includes(step)) base.push(step);
      }
    }
    if (lane === 'snare' && ['rnb', 'acoustic', 'trap'].includes(kitSteps._kit)) {
      if (!base.includes(10)) base.push(10);
    }
    next[lane] = [...new Set(base)].sort((a, b) => a - b);
  }
  return next;
}

/** Recording is late by (peak - click) ms, so the clip offset is the negative of that. */
export function suggestLatencyOffsetMs(clickAtMs, peakAtMs) {
  const late = Number(peakAtMs) - Number(clickAtMs);
  if (!Number.isFinite(late)) return 0;
  return Math.max(-200, Math.min(200, Math.round(-late)));
}

export function libraryPreviewRate({
  bpm = 92,
  fitTempo = true,
  fitKey = false,
  keyRoot = 'A',
  referenceBpm = 92
} = {}) {
  let rate = 1;
  if (fitTempo) {
    const tempo = Math.max(40, Math.min(240, Number(bpm) || referenceBpm));
    rate *= tempo / referenceBpm;
  }
  if (fitKey) {
    const root = pitchClassOf(keyRootName(keyRoot));
    const semis = PITCHES.indexOf(root) - PITCHES.indexOf('A');
    if (semis) rate *= 2 ** (semis / 12);
  }
  return Math.max(0.5, Math.min(2, rate));
}
