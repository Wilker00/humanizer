import {
  ensurePatternBank,
  migratePatternsFromV1,
  cloneNotes,
  serializeDrums,
  DRUM_LANES
} from './patterns.js';
import {
  normalizePlaylist,
  rebuildPlaylistFromSections,
  emptyPlaylist,
  PLAYLIST_TRACKS,
  normalizeTrackList,
  mixMapFromTracks,
  emptyTrackList
} from './playlist.js';
import { normalizeTransport, defaultTransport } from './transport.js';
import { normalizeProSession, normalizeGroupBuses } from './pro-features.js';

const lanes = DRUM_LANES;
const tracks = ['keys', 'drums', 'chords', 'vocals'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = field => { throw new Error(`Invalid project: check ${field}.`); };
const number = (value, min, max, field, integer = false) => {
  if(typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) fail(field);
};

function validateNotes(list, maxStep, field = 'notes') {
  if(!Array.isArray(list) || list.length > 4096) fail(field);
  for(const note of list) {
    if(!object(note) || !/^[A-G]#?[0-8]$/.test(note.n)) fail('note pitch');
    number(note.x, 0, maxStep - 1, 'note position', true);
    number(note.w, 0.25, maxStep, 'note length');
    if(note.x + note.w > maxStep) fail('note end');
    if(note.v !== undefined) number(note.v, 0, 1, 'note velocity');
  }
}

function stepsPerBar(meter) {
  return meter === '3/4' || meter === '6/8' ? 12 : 16;
}

function validateDrumSteps(steps, maxStep, rolls, velocity, nudge) {
  if(!object(steps)) fail('drum steps');
  for(const [lane, list] of Object.entries(steps)) {
    if(typeof lane !== 'string' || !lane) fail('drum lane');
    if(!Array.isArray(list) || list.length > maxStep) fail('drum steps');
    list.forEach(step => number(step, 0, maxStep - 1, 'drum position', true));
  }
  if(rolls !== undefined) {
    if(!object(rolls)) fail('drum rolls');
    for(const [lane, laneRolls] of Object.entries(rolls)) {
      if(!object(laneRolls)) fail('drum rolls');
      for(const [step, count] of Object.entries(laneRolls)) {
        number(Number(step), 0, maxStep - 1, 'roll position', true);
        number(count, 1, 16, 'roll count', true);
      }
    }
  }
  if(velocity !== undefined && velocity !== null) {
    if(!object(velocity)) fail('drum velocity');
    for(const [lane, laneVels] of Object.entries(velocity)) {
      if(!object(laneVels)) fail('drum velocity');
      for(const [step, val] of Object.entries(laneVels)) {
        number(Number(step), 0, maxStep - 1, 'velocity position', true);
        number(Number(val), 0, 1.5, 'drum velocity value');
      }
    }
  }
  if(nudge !== undefined && nudge !== null) {
    if(!object(nudge)) fail('drum nudge');
    for(const [lane, laneNudges] of Object.entries(nudge)) {
      if(!object(laneNudges)) fail('drum nudge');
      for(const [step, val] of Object.entries(laneNudges)) {
        number(Number(step), 0, maxStep - 1, 'nudge position', true);
        number(Number(val), -1, 1, 'drum nudge value');
      }
    }
  }
}

/** Upgrade any stored snapshot to schema v2 (patterns + playlist). */
export function migrateProjectToV2(project) {
  if(!object(project)) fail('project structure');
  const next = structuredClone(project);
  if(!Array.isArray(next.pattern)) next.pattern = [];
  if(!object(next.drums)) next.drums = Object.fromEntries(lanes.map(lane => [lane, []]));
  if(next.schemaVersion === 2 && object(next.patterns) && object(next.playlist)) {
    next.patterns = ensurePatternBank(next.patterns);
    next.playlist = normalizePlaylist(next.playlist);
    next.activePatternIds = {
      melody: next.activePatternIds?.melody || next.patterns.melody[0]?.id || null,
      bass: next.activePatternIds?.bass || next.patterns.bass?.[0]?.id || null,
      drums: next.activePatternIds?.drums || next.patterns.drums[0]?.id || null,
      chords: next.activePatternIds?.chords || next.patterns.chords[0]?.id || null
    };
    if(Array.isArray(next.sections)) {
      next.sections = next.sections.map(section => ({
        ...section,
        patterns: {
          keys: section.patterns?.keys || next.activePatternIds.melody,
          drums: section.patterns?.drums || next.activePatternIds.drums,
          chords: section.patterns?.chords || next.activePatternIds.chords
        },
        vocalTakeId: section.vocalTakeId ?? null
      }));
    }
    next.schemaVersion = 2;
    return next;
  }

  const migrated = migratePatternsFromV1(next);
  next.patterns = migrated.patterns;
  next.activePatternIds = {
    ...migrated.activePatternIds,
    bass: migrated.activePatternIds?.bass || next.patterns?.bass?.[0]?.id || null
  };
  next.sections = migrated.sections;
  const vocalTakeId = Array.isArray(next.vocalTakes) && next.vocalTakes[0]?.id
    ? next.vocalTakes[0].id
    : (next.vocals?.url ? 'legacy-vocal' : null);
  if(vocalTakeId === 'legacy-vocal' && next.vocals?.url) {
    next.vocalTakes = Array.isArray(next.vocalTakes) ? next.vocalTakes : [];
    if(!next.vocalTakes.some(take => take.id === 'legacy-vocal')) {
      next.vocalTakes.unshift({
        id: 'legacy-vocal',
        title: next.vocals.title || 'Vocal',
        url: next.vocals.url,
        start: 0,
        end: 1,
        gain: 1
      });
    }
  }
  next.playlist = rebuildPlaylistFromSections(next.sections, {
    vocalTakeId: next.vocalAdded ? vocalTakeId : null,
    melodyAdded: next.melodyAdded,
    drumsAdded: next.drumsAdded,
    chordAdded: next.chordAdded,
    vocalAdded: next.vocalAdded
  });
  // Keep legacy working fields in sync with active patterns
  const mel = next.patterns.melody.find(p => p.id === next.activePatternIds.melody) || next.patterns.melody[0];
  const drm = next.patterns.drums.find(p => p.id === next.activePatternIds.drums) || next.patterns.drums[0];
  const chd = next.patterns.chords.find(p => p.id === next.activePatternIds.chords) || next.patterns.chords[0];
  if(mel) next.pattern = cloneNotes(mel.notes);
  if(drm) {
    next.drums = drm.steps;
    next.drumRolls = drm.rolls || {};
  }
  if(chd) next.chords = chd.progression;
  delete next.sectionPatterns;
  next.schemaVersion = 2;
  return next;
}

/** Upgrade to schema v3: independent track list + transport + flexible playlist. */
export function migrateProjectToV3(project) {
  if(object(project) && project.schemaVersion === 3 && object(project.patterns) && object(project.playlist)) {
    const next = structuredClone(project);
    next.tracks = normalizeTrackList(next.tracks, next.mix);
    next.mix = { ...mixMapFromTracks(next.tracks), ...(next.mix || {}) };
    for (const track of next.tracks) {
      if (!next.mix[track.id]) next.mix[track.id] = { ...track.mix };
      else track.mix = { ...track.mix, ...next.mix[track.id] };
    }
    next.playlist = normalizePlaylist(next.playlist, next.tracks);
    const totalBars = Array.isArray(next.sections)
      ? next.sections.reduce((sum, section) => sum + Math.max(1, Number(section.bars) || 1), 0)
      : 1;
    next.transport = normalizeTransport(next.transport, totalBars);
    next.patterns = ensurePatternBank(next.patterns);
    next.schemaVersion = 3;
    return next;
  }
  const next = migrateProjectToV2(project);
  next.tracks = normalizeTrackList(next.tracks, next.mix);
  next.mix = { ...mixMapFromTracks(next.tracks), ...(next.mix || {}) };
  for (const track of next.tracks) {
    if (!next.mix[track.id]) next.mix[track.id] = { ...track.mix };
    else track.mix = { ...track.mix, ...next.mix[track.id] };
  }
  next.playlist = normalizePlaylist(next.playlist, next.tracks);
  const totalBars = Array.isArray(next.sections)
    ? next.sections.reduce((sum, section) => sum + Math.max(1, Number(section.bars) || 1), 0)
    : 1;
  next.transport = normalizeTransport(next.transport, totalBars);
  next.selectedNotes = Array.isArray(next.selectedNotes) ? next.selectedNotes.filter(n => Number.isInteger(n)) : [];
  next.schemaVersion = 3;
  return next;
}

/** Always migrate to latest schema. */
export function migrateProject(project) {
  return migrateProjectToV3(project);
}

// Validate the whole document before replacing the current project. Older
// snapshots may omit optional fields; applySnapshot supplies their defaults.
export function validateProject(project, { keys = [], kits = [] } = {}) {
  if(!object(project) || !Array.isArray(project.pattern) || !object(project.drums)) fail('project structure');
  const version = project.schemaVersion === undefined ? 1 : project.schemaVersion;
  if(version !== 1 && version !== 2 && version !== 3) fail('schema version');
  for(const field of ['name', 'description', 'prompt', 'instrument', 'chordInstrument']) {
    if(project[field] !== undefined && typeof project[field] !== 'string') fail(field);
  }
  if(project.key !== undefined && (typeof project.key !== 'string' || (keys.length && !keys.includes(project.key)))) fail('key');
  if(project.kit !== undefined && (typeof project.kit !== 'string' || (kits.length && !kits.includes(project.kit)))) fail('kit');
  if(project.meter !== undefined && project.meter !== '4/4' && project.meter !== '3/4' && project.meter !== '6/8') fail('meter');
  for(const [field, min, max, integer] of [['bpm',40,240], ['swing',0,60], ['idea',0,3,true], ['songSection',0,127,true]]) {
    if(project[field] !== undefined) number(project[field], min, max, field, integer);
  }

  const meter = project.meter || '4/4';
  const legacyMax = stepsPerBar(meter);
  validateNotes(project.pattern, legacyMax * 8);
  if(project.sectionPatterns !== undefined) {
    if(!object(project.sectionPatterns)) fail('section patterns');
    for(const [index, list] of Object.entries(project.sectionPatterns)) {
      if(!/^\d+$/.test(index) || Number(index) > 127) fail('section pattern index');
      validateNotes(list, legacyMax * 8);
    }
  }
  if(project.melodyDrafts !== undefined) {
    if(!Array.isArray(project.melodyDrafts) || project.melodyDrafts.length !== 4) fail('melody drafts');
    project.melodyDrafts.forEach(list => validateNotes(list, legacyMax * 8));
  }
  for(const [lane, steps] of Object.entries(project.drums || {})) {
    if(!Array.isArray(steps) || steps.length > legacyMax * 8) fail('drum steps');
    steps.forEach(step => number(step, 0, legacyMax * 8 - 1, 'drum position', true));
  }
  for(const field of ['drumMix','drumTrim','drumRolls','drumVelocity','drumNudge','customSamples','customSampleAssets','mix','fx','eq','vocals','vocalRec','proSession','groupBuses']) {
    if(project[field] !== undefined && !object(project[field])) fail(field);
  }
  for(const field of ['customSamples','customSampleAssets']) {
    for(const [lane, value] of Object.entries(project[field] || {})) {
      if(typeof lane !== 'string' || !lane || typeof value !== 'string') fail(field);
    }
  }
  for(const [lane, value] of Object.entries(project.drumTrim || {})) {
    if(typeof lane !== 'string' || !lane) fail('drum trim lane');
    number(value, 0, 120, 'drum trim');
  }
  for(const [lane, rolls] of Object.entries(project.drumRolls || {})) {
    if(typeof lane !== 'string' || !lane || !object(rolls)) fail('drum rolls');
    for(const [step, count] of Object.entries(rolls)) {
      number(Number(step), 0, legacyMax * 8 - 1, 'roll position', true);
      number(count, 1, 16, 'roll count', true);
    }
  }
  for(const [id, value] of Object.entries(project.mix || {})) {
    if(version < 3 && !tracks.includes(id)) fail('mix');
    if(version >= 3 && (typeof id !== 'string' || !id)) fail('mix');
    if(!object(value)) fail('mix');
    if(value.vol !== undefined) number(value.vol, 0, 1.5, 'mix volume');
    if(value.pan !== undefined) number(value.pan, -1, 1, 'mix pan');
    if(value.mute !== undefined && typeof value.mute !== 'boolean') fail('mix mute');
    if(value.solo !== undefined && typeof value.solo !== 'boolean') fail('mix solo');
    if(value.send !== undefined) number(value.send, 0, 1.5, 'mix send');
    if(value.delaySend !== undefined) number(value.delaySend, 0, 1.5, 'mix delay send');
    if(value.cue !== undefined) number(value.cue, 0, 1, 'mix cue');
    if(value.delayPre !== undefined && typeof value.delayPre !== 'boolean') fail('mix delay pre');
  }
  for(const [lane, value] of Object.entries(project.drumMix || {})) {
    if(typeof lane !== 'string' || !lane || !object(value)) fail('drumMix');
    if(value.vol !== undefined) number(value.vol, 0, 2, 'drumMix volume');
    if(value.pan !== undefined) number(value.pan, -1, 1, 'drumMix pan');
    if(value.mute !== undefined && typeof value.mute !== 'boolean') fail('drumMix mute');
    if(value.solo !== undefined && typeof value.solo !== 'boolean') fail('drumMix solo');
  }
  for(const [field, min, max] of [['eq',-24,24]]) {
    for(const value of Object.values(project[field] || {})) number(value, min, max, field);
  }
  for(const [name, value] of Object.entries(project.fx || {})) number(value, name === 'filter' ? -100 : 0, name === 'filter' ? 100 : 1, 'effects');
  if(project.chips !== undefined && (!Array.isArray(project.chips) || project.chips.some(chip => typeof chip !== 'string'))) fail('chips');
  if(project.chords !== undefined) {
    if(!object(project.chords) || !Array.isArray(project.chords.bars) || !project.chords.bars.length || project.chords.bars.length > 64 || project.chords.bars.some(chord => typeof chord !== 'string' || !/^[A-G][b#]?[a-zA-Z0-9+#()-]*$/.test(chord))) fail('chords');
  }
  if(project.chordVoice !== undefined){
    if(!object(project.chordVoice)) fail('chord voice');
    if(project.chordVoice.inversion !== undefined) number(project.chordVoice.inversion, 0, 2, 'chord inversion', true);
    if(project.chordVoice.octave !== undefined) number(project.chordVoice.octave, -1, 1, 'chord octave', true);
  }
  if(project.sections !== undefined) {
    if(!Array.isArray(project.sections) || project.sections.length > 128) fail('sections');
    let total = 0;
    for(const section of project.sections) {
      if(!object(section) || typeof section.name !== 'string' || !object(section.active)) fail('section');
      number(section.bars, 1, 64, 'section length', true);
      total += section.bars;
      if(Object.values(section.active).some(value => typeof value !== 'boolean')) fail('section tracks');
      if(section.patterns !== undefined) {
        if(!object(section.patterns)) fail('section patterns');
        for(const key of ['keys', 'drums', 'chords']) {
          if(section.patterns[key] !== undefined && section.patterns[key] !== null && typeof section.patterns[key] !== 'string') fail('section pattern id');
        }
      }
      if(section.vocalTakeId !== undefined && section.vocalTakeId !== null && typeof section.vocalTakeId !== 'string') fail('section vocal');
    }
    if(total > 256) fail('song length (maximum 256 bars)');
  }
  if(project.vocals?.url !== undefined && typeof project.vocals.url !== 'string') fail('vocal source');
  if(project.vocalTakes !== undefined) {
    if(!Array.isArray(project.vocalTakes) || project.vocalTakes.length > 64) fail('vocal takes');
    for(const take of project.vocalTakes) {
      if(!object(take) || typeof take.id !== 'string' || typeof take.title !== 'string' || typeof take.url !== 'string') fail('vocal take');
      number(take.start ?? 0, 0, 1, 'vocal take start');
      number(take.end ?? 1, 0, 1, 'vocal take end');
      if((take.end ?? 1) <= (take.start ?? 0)) fail('vocal take range');
      number(take.gain ?? 1, 0, 1.5, 'vocal take gain');
    }
  }

  if(version === 2 || version === 3) {
    if(!object(project.patterns)) fail('patterns');
    const bank = ensurePatternBank(project.patterns);
    for(const kind of ['melody', 'bass', 'drums', 'chords']) {
      if(bank[kind].length > 128) fail('pattern bank size');
      for(const pattern of bank[kind]) {
        if(typeof pattern.id !== 'string' || typeof pattern.name !== 'string') fail('pattern');
        number(pattern.bars, 1, 8, 'pattern bars', true);
        if(pattern.bars !== 1 && pattern.bars !== 2 && pattern.bars !== 4 && pattern.bars !== 8) fail('pattern bars');
        const maxStep = stepsPerBar(meter) * pattern.bars;
        if(kind === 'melody' || kind === 'bass') validateNotes(pattern.notes, maxStep);
        if(kind === 'drums') validateDrumSteps(pattern.steps, maxStep, pattern.rolls, pattern.velocity, pattern.nudge);
        if(kind === 'chords') {
          if(!object(pattern.progression) || !Array.isArray(pattern.progression.bars) || !pattern.progression.bars.length) fail('chord pattern');
        }
      }
    }
    if(project.activePatternIds !== undefined) {
      if(!object(project.activePatternIds)) fail('active patterns');
      for(const kind of ['melody', 'bass', 'drums', 'chords']) {
        const id = project.activePatternIds[kind];
        if(id !== undefined && id !== null && typeof id !== 'string') fail('active pattern id');
      }
    }
    if(project.playlist !== undefined) {
      const trackList = version === 3 ? normalizeTrackList(project.tracks, project.mix) : null;
      const playlist = normalizePlaylist(project.playlist, trackList);
      for(const track of playlist.tracks) {
        if(version === 2 && !PLAYLIST_TRACKS.includes(track.id)) fail('playlist track');
        if(typeof track.id !== 'string' || !track.id) fail('playlist track');
        if(track.clips.length > 512) fail('playlist clips');
        if(track.automation) {
          for(const point of track.automation) {
            number(point.bar, 0, 255, 'track automation bar');
            number(point.gain, 0, 1.5, 'track automation gain');
          }
        }
        for(const clip of track.clips) {
          number(clip.startBar, 0, 255, 'clip start');
          number(clip.lengthBars, 1 / 16, 64, 'clip length');
          number(clip.gain ?? 1, 0, 1.5, 'clip gain');
          if(clip.patternId !== undefined && typeof clip.patternId !== 'string') fail('clip pattern');
          if(clip.audioTakeId !== undefined && typeof clip.audioTakeId !== 'string') fail('clip audio');
          if(clip.slip !== undefined) number(clip.slip, 0, 1, 'clip slip');
          if(clip.locked !== undefined && typeof clip.locked !== 'boolean') fail('clip locked');
          if(clip.muted !== undefined && typeof clip.muted !== 'boolean') fail('clip muted');
          if(clip.warpMode !== undefined && !['off','beats','tones'].includes(clip.warpMode)) fail('clip warp');
          if(clip.sourceBpm !== undefined) number(clip.sourceBpm, 40, 240, 'clip source bpm');
          if(clip.takeLaneId !== undefined && typeof clip.takeLaneId !== 'string') fail('clip take lane');
          if(clip.compSourceId !== undefined && typeof clip.compSourceId !== 'string') fail('clip comp source');
          if(clip.pitchCorrection !== undefined) {
            if(!object(clip.pitchCorrection)) fail('clip pitch correction');
            if(clip.pitchCorrection.enabled !== undefined && typeof clip.pitchCorrection.enabled !== 'boolean') fail('clip pitch correction');
            if(clip.pitchCorrection.semitone !== undefined) number(clip.pitchCorrection.semitone, -12, 12, 'clip pitch semitone', true);
            if(clip.pitchCorrection.snapToScale !== undefined && typeof clip.pitchCorrection.snapToScale !== 'boolean') fail('clip pitch snap');
          }
          if(clip.automation) {
            for(const point of clip.automation) {
              number(point.bar, 0, 64, 'automation bar');
              number(point.gain, 0, 1.5, 'automation gain');
            }
          }
        }
      }
    }
  }
  if(version === 3) {
    const trackList = normalizeTrackList(project.tracks, project.mix);
    if(trackList.length > 64) fail('track list');
    for(const track of trackList) {
      if(typeof track.id !== 'string' || typeof track.name !== 'string') fail('track');
    }
    if(project.transport !== undefined && !object(project.transport)) fail('transport');
    if(project.proSession !== undefined) normalizeProSession(project.proSession);
    if(project.groupBuses !== undefined) normalizeGroupBuses(project.groupBuses);
  }
  return project;
}

export { ensurePatternBank, emptyPlaylist, serializeDrums, migratePatternsFromV1, emptyTrackList, normalizeTrackList };
