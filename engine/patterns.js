/** Pattern bank helpers — reusable melody / drum / chord blocks (FL-style). */

const LANES = ['kick', 'snare', 'clap', 'hat', 'openhat', 'bass'];

export function createPatternId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `pat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function cloneNotes(list) {
  return (list || []).map(note => {
    const next = { n: note.n, x: note.x, w: note.w };
    if (note.v !== undefined) next.v = note.v;
    if (note.locked) next.locked = true;
    return next;
  });
}

export function serializeDrums(drums, customLanes = []) {
  const allLanes = [...new Set([...LANES, ...(customLanes || []), ...Object.keys(drums || {})])];
  const out = {};
  for (const lane of allLanes) out[lane] = [...(drums?.[lane] instanceof Set ? drums[lane] : drums?.[lane] || [])];
  return out;
}

export function deserializeDrums(steps, customLanes = []) {
  const allLanes = [...new Set([...LANES, ...(customLanes || []), ...Object.keys(steps || {})])];
  const out = {};
  for (const lane of allLanes) out[lane] = new Set(steps?.[lane] || []);
  return out;
}

export function emptyMelodyPattern(name = 'Pattern 1', bars = 1, notes = []) {
  return { id: createPatternId(), name, bars: clampBars(bars), notes: cloneNotes(notes) };
}

export function emptyDrumPattern(name = 'Pattern 1', bars = 1, steps = null, rolls = {}, velocity = {}, nudge = {}, chokeGroups = {}) {
  const allLanes = [...new Set([...LANES, ...Object.keys(steps || {}), ...Object.keys(velocity || {})])];
  const base = steps || Object.fromEntries(allLanes.map(lane => [lane, []]));
  return {
    id: createPatternId(),
    name,
    bars: clampBars(bars),
    steps: Object.fromEntries(allLanes.map(lane => [lane, [...(base[lane] || [])]])),
    rolls: structuredClone(rolls || {}),
    velocity: structuredClone(velocity || {}),
    nudge: structuredClone(nudge || {}),
    chokeGroups: { openhat: 1, hat: 1, ...(chokeGroups || {}) }
  };
}

export function emptyChordPattern(name = 'Pattern 1', bars = 1, progression = null) {
  return {
    id: createPatternId(),
    name,
    bars: clampBars(bars),
    progression: progression
      ? { name: progression.name, bars: [...(progression.bars || [])], feel: progression.feel || '' }
      : { name: 'Empty', bars: ['Am7'], feel: '' }
  };
}

export function emptyBassPattern(name = 'Bass 1', bars = 1, notes = []) {
  return { id: createPatternId(), name, bars: clampBars(bars), notes: cloneNotes(notes) };
}

function clampBars(bars) {
  const value = Number(bars);
  if (value === 2 || value === 4 || value === 8) return value;
  return 1;
}

export function patternStepCount(pattern, meter = '4/4') {
  const perBar = meter === '4/4' || !meter ? 16 : 12;
  return perBar * clampBars(pattern?.bars || 1);
}

export function findPattern(patterns, kind, id) {
  const list = patterns?.[kind];
  if (!Array.isArray(list) || !id) return null;
  return list.find(item => item.id === id) || null;
}

export function ensurePatternBank(patterns) {
  const bank = {
    melody: Array.isArray(patterns?.melody) ? patterns.melody.map(normalizeMelodyPattern) : [],
    bass: Array.isArray(patterns?.bass) ? patterns.bass.map(normalizeMelodyPattern) : [],
    drums: Array.isArray(patterns?.drums) ? patterns.drums.map(normalizeDrumPattern) : [],
    chords: Array.isArray(patterns?.chords) ? patterns.chords.map(normalizeChordPattern) : []
  };
  return bank;
}

function normalizeMelodyPattern(raw) {
  return {
    id: typeof raw?.id === 'string' ? raw.id : createPatternId(),
    name: typeof raw?.name === 'string' && raw.name ? raw.name : 'Pattern',
    bars: clampBars(raw?.bars),
    notes: cloneNotes(raw?.notes || raw?.pattern || [])
  };
}

function normalizeDrumPattern(raw) {
  const steps = raw?.steps || raw?.drums || {};
  const allLanes = [...new Set([...LANES, ...Object.keys(steps || {}), ...Object.keys(raw?.velocity || {})])];
  return {
    id: typeof raw?.id === 'string' ? raw.id : createPatternId(),
    name: typeof raw?.name === 'string' && raw.name ? raw.name : 'Pattern',
    bars: clampBars(raw?.bars),
    steps: Object.fromEntries(allLanes.map(lane => [lane, [...(steps[lane] || [])]])),
    rolls: raw?.rolls && typeof raw.rolls === 'object' ? structuredClone(raw.rolls) : {},
    velocity: raw?.velocity && typeof raw.velocity === 'object' ? structuredClone(raw.velocity) : {},
    nudge: raw?.nudge && typeof raw.nudge === 'object' ? structuredClone(raw.nudge) : {},
    chokeGroups: raw?.chokeGroups && typeof raw.chokeGroups === 'object' ? structuredClone(raw.chokeGroups) : { openhat: 1, hat: 1 },
    kit: typeof raw?.kit === 'string' ? raw.kit : ''
  };
}

function normalizeChordPattern(raw) {
  const progression = raw?.progression || raw?.chords || { name: 'Empty', bars: ['Am7'] };
  return {
    id: typeof raw?.id === 'string' ? raw.id : createPatternId(),
    name: typeof raw?.name === 'string' && raw.name ? raw.name : 'Pattern',
    bars: clampBars(raw?.bars),
    progression: {
      name: progression.name || 'Chords',
      bars: Array.isArray(progression.bars) && progression.bars.length ? [...progression.bars] : ['Am7'],
      feel: progression.feel || ''
    }
  };
}

/** Build a v2 pattern bank from a legacy v1 project snapshot. */
export function migratePatternsFromV1(project) {
  const melodyNotes = Array.isArray(project?.pattern) ? project.pattern : [];
  const melody = emptyMelodyPattern('Melody 1', 1, melodyNotes);
  const drums = emptyDrumPattern('Drums 1', 1, project?.drums || {}, project?.drumRolls || {});
  const chords = emptyChordPattern(
    project?.chords?.name || 'Chords 1',
    1,
    project?.chords || { name: 'Chords 1', bars: ['Am7'] }
  );

  const sectionPatterns = project?.sectionPatterns && typeof project.sectionPatterns === 'object'
    ? project.sectionPatterns
    : {};
  const sections = Array.isArray(project?.sections) ? project.sections : [];
  const melodyBySection = {};

  for (const [index, notes] of Object.entries(sectionPatterns)) {
    if (!Array.isArray(notes) || !notes.length) continue;
    const sameAsMain = JSON.stringify(notes) === JSON.stringify(melodyNotes);
    if (sameAsMain) {
      melodyBySection[index] = melody.id;
      continue;
    }
    const variation = emptyMelodyPattern(`Melody · ${sections[Number(index)]?.name || index}`, 1, notes);
    melodyBySection[index] = variation.id;
    // Collect after — handled below via list push
    melody._extras = melody._extras || [];
    melody._extras.push(variation);
  }

  const melodyList = [melody, ...(melody._extras || [])];
  delete melody._extras;

  const enrichedSections = (sections.length ? sections : defaultSections()).map((section, index) => ({
    name: section.name || `Section ${index + 1}`,
    bars: Math.max(1, Math.min(64, Number(section.bars) || 1)),
    active: {
      keys: section.active?.keys !== false,
      drums: section.active?.drums !== false,
      chords: section.active?.chords !== false,
      vocals: section.active?.vocals !== false
    },
    patterns: {
      keys: melodyBySection[String(index)] || melody.id,
      drums: drums.id,
      chords: chords.id
    },
    vocalTakeId: null
  }));

  return {
    patterns: { melody: melodyList, drums: [drums], chords: [chords] },
    activePatternIds: { melody: melody.id, drums: drums.id, chords: chords.id },
    sections: enrichedSections
  };
}

function defaultSections() {
  return [
    { name: 'Intro', bars: 1, active: { keys: true, drums: false, chords: true, vocals: false } },
    { name: 'Verse', bars: 2, active: { keys: true, drums: true, chords: true, vocals: false } },
    { name: 'Hook', bars: 2, active: { keys: true, drums: true, chords: true, vocals: true } },
    { name: 'Outro', bars: 1, active: { keys: true, drums: false, chords: true, vocals: false } }
  ];
}

export function duplicatePatternInBank(patterns, kind, id, name) {
  const source = findPattern(patterns, kind, id);
  if (!source) return null;
  let copy;
  if (kind === 'melody') copy = emptyMelodyPattern(name || `${source.name} copy`, source.bars, source.notes);
  else if (kind === 'bass') copy = emptyBassPattern(name || `${source.name} copy`, source.bars, source.notes);
  else if (kind === 'drums') copy = emptyDrumPattern(name || `${source.name} copy`, source.bars, source.steps, source.rolls, source.velocity, source.nudge, source.chokeGroups);
  else copy = emptyChordPattern(name || `${source.name} copy`, source.bars, source.progression);
  patterns[kind] = [...(patterns[kind] || []), copy];
  return copy;
}

export function renamePattern(patterns, kind, id, name) {
  const pattern = findPattern(patterns, kind, id);
  if (!pattern || typeof name !== 'string' || !name.trim()) return false;
  pattern.name = name.trim().slice(0, 64);
  return true;
}

export function setPatternBars(patterns, kind, id, bars) {
  const pattern = findPattern(patterns, kind, id);
  if (!pattern) return false;
  pattern.bars = clampBars(bars);
  return true;
}

/** Write working editor state into the active pattern in the bank. */
export function writeWorkingToPattern(patterns, kind, id, working) {
  const pattern = findPattern(patterns, kind, id);
  if (!pattern) return false;
  if (kind === 'melody' || kind === 'bass') {
    pattern.notes = cloneNotes(working.notes);
    if (working.bars) pattern.bars = clampBars(working.bars);
  } else if (kind === 'drums') {
    pattern.steps = serializeDrums(working.drums);
    pattern.rolls = structuredClone(working.rolls || {});
    pattern.velocity = structuredClone(working.velocity || working.drumVelocity || pattern.velocity || {});
    pattern.nudge = structuredClone(working.nudge || working.drumNudge || pattern.nudge || {});
    if (working.chokeGroups) pattern.chokeGroups = structuredClone(working.chokeGroups);
    if (typeof working.kit === 'string') pattern.kit = working.kit;
    if (working.bars) pattern.bars = clampBars(working.bars);
  } else if (kind === 'chords') {
    pattern.progression = {
      name: working.chords?.name || pattern.progression.name,
      bars: [...(working.chords?.bars || pattern.progression.bars)],
      feel: working.chords?.feel || ''
    };
    if (working.bars) pattern.bars = clampBars(working.bars);
  }
  return true;
}

/** Load a pattern from the bank into plain working fields. */
export function readPatternToWorking(patterns, kind, id) {
  const pattern = findPattern(patterns, kind, id);
  if (!kind) return null;
  if (!pattern) {
    if (kind === 'melody' || kind === 'bass') return { notes: [], bars: 1 };
    if (kind === 'drums') return { drums: deserializeDrums({}), rolls: {}, velocity: {}, nudge: {}, chokeGroups: { openhat: 1, hat: 1 }, bars: 1 };
    return { chords: { name: 'Empty', bars: ['Am7'] }, bars: 1 };
  }
  if (kind === 'melody' || kind === 'bass') return { notes: cloneNotes(pattern.notes), bars: pattern.bars, name: pattern.name, id: pattern.id };
  if (kind === 'drums') {
    return {
      drums: deserializeDrums(pattern.steps),
      rolls: structuredClone(pattern.rolls || {}),
      velocity: structuredClone(pattern.velocity || {}),
      nudge: structuredClone(pattern.nudge || {}),
      chokeGroups: structuredClone(pattern.chokeGroups || { openhat: 1, hat: 1 }),
      bars: pattern.bars,
      kit: pattern.kit || '',
      name: pattern.name,
      id: pattern.id
    };
  }
  return {
    chords: {
      name: pattern.progression.name,
      bars: [...pattern.progression.bars],
      feel: pattern.progression.feel || ''
    },
    bars: pattern.bars,
    name: pattern.name,
    id: pattern.id
  };
}

export { LANES as DRUM_LANES };
