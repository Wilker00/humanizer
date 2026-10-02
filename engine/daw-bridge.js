/**
 * Bridge between live app state and the pattern/playlist model.
 * Keeps working editor fields (pattern, drums, chords) synced with the bank.
 */
import {
  ensurePatternBank,
  emptyMelodyPattern,
  emptyBassPattern,
  emptyDrumPattern,
  emptyChordPattern,
  findPattern,
  duplicatePatternInBank,
  writeWorkingToPattern,
  readPatternToWorking,
  cloneNotes,
  serializeDrums,
  createPatternId
} from './patterns.js';
import {
  normalizePlaylist,
  rebuildPlaylistFromSections,
  emptyPlaylist,
  sectionStartBars,
  totalSongBars,
  sectionIndexAtBar,
  resolvePatternAtBar,
  clipAtBar,
  automationGainAt,
  moveClip,
  resizeClip,
  createClipId,
  normalizeTrackList,
  mixMapFromTracks,
  emptyTrackList,
  addTrack,
  duplicateTrack,
  deleteTrack,
  renameTrack,
  reorderTracks,
  deleteClips,
  duplicateClip,
  cloneClips,
  pasteClips,
  splitClip,
  joinClips,
  snapValue,
  setTrackAutomation
} from './playlist.js';
import { migrateProjectToV3 } from './project-format.js';
import { mergePlaylistPreservingEdits } from './arrangement-engine.js';
import { normalizeTransport, defaultTransport } from './transport.js';

export function ensureDawState(state, defaults = {}) {
  if (!state.patterns || !state.patterns.melody) {
    const seed = {
      pattern: state.pattern || [],
      drums: serializeWorkingDrums(state.drums),
      drumRolls: state.drumRolls || {},
      chords: state.chords || defaults.chords,
      sections: state.sections,
      sectionPatterns: state.sectionPatterns,
      melodyAdded: state.melodyAdded,
      drumsAdded: state.drumsAdded,
      chordAdded: state.chordAdded,
      vocalAdded: state.vocalAdded,
      vocals: state.vocals,
      vocalTakes: state.vocalTakes,
      mix: state.mix,
      tracks: state.tracks,
      transport: state.transport
    };
    const migrated = migrateProjectToV3(seed);
    state.patterns = migrated.patterns;
    state.activePatternIds = migrated.activePatternIds;
    state.sections = migrated.sections;
    state.playlist = migrated.playlist;
    state.tracks = migrated.tracks;
    state.mix = migrated.mix;
    state.transport = migrated.transport;
  } else {
    state.patterns = ensurePatternBank(state.patterns);
    state.tracks = normalizeTrackList(state.tracks, state.mix);
    state.mix = { ...mixMapFromTracks(state.tracks), ...(state.mix || {}) };
    for (const track of state.tracks) {
      if (!state.mix[track.id]) state.mix[track.id] = { ...track.mix };
      else track.mix = { ...track.mix, ...state.mix[track.id] };
    }
    state.playlist = normalizePlaylist(state.playlist || emptyPlaylist(), state.tracks);
    state.transport = normalizeTransport(state.transport, totalSongBars(state.sections));
    state.activePatternIds = {
      melody: state.activePatternIds?.melody || state.patterns.melody[0]?.id || null,
      bass: state.activePatternIds?.bass || state.patterns.bass?.[0]?.id || null,
      drums: state.activePatternIds?.drums || state.patterns.drums[0]?.id || null,
      chords: state.activePatternIds?.chords || state.patterns.chords[0]?.id || null
    };
    state.sections = (state.sections || []).map(section => ({
      ...section,
      patterns: {
        keys: section.patterns?.keys || state.activePatternIds.melody,
        bass: section.patterns?.bass || state.activePatternIds.bass,
        drums: section.patterns?.drums || state.activePatternIds.drums,
        chords: section.patterns?.chords || state.activePatternIds.chords
      },
      vocalTakeId: section.vocalTakeId ?? null
    }));
  }
  if (!state.patternBars) {
    const mel = findPattern(state.patterns, 'melody', state.activePatternIds.melody);
    state.patternBars = mel?.bars || 1;
  }
  if (!state.drumPatternBars) {
    const drm = findPattern(state.patterns, 'drums', state.activePatternIds.drums);
    state.drumPatternBars = drm?.bars || 1;
  }
  if (!state.bassPatternBars) {
    const bss = findPattern(state.patterns, 'bass', state.activePatternIds.bass);
    state.bassPatternBars = bss?.bars || 1;
  }
  if (!Array.isArray(state.selectedNotes)) state.selectedNotes = [];
  if (!Array.isArray(state.selectedPlaylistClips)) state.selectedPlaylistClips = [];
  if (!state.clipClipboard) state.clipClipboard = [];
  if (!state.noteClipboard) state.noteClipboard = [];
  return state;
}

function serializeWorkingDrums(drums) {
  if (!drums) return {};
  const out = {};
  for (const [lane, value] of Object.entries(drums)) {
    out[lane] = value instanceof Set ? [...value] : [...(value || [])];
  }
  return out;
}

export function syncWorkingToActivePatterns(state) {
  ensureDawState(state);
  writeWorkingToPattern(state.patterns, 'melody', state.activePatternIds.melody, {
    notes: state.pattern,
    bars: state.patternBars || 1
  });
  if (state.activePatternIds.bass && state.bassPattern) {
    writeWorkingToPattern(state.patterns, 'bass', state.activePatternIds.bass, {
      notes: state.bassPattern,
      bars: state.bassPatternBars || 1
    });
  }
  writeWorkingToPattern(state.patterns, 'drums', state.activePatternIds.drums, {
    drums: state.drums,
    rolls: state.drumRolls,
    velocity: state.drumVelocity,
    nudge: state.drumNudge,
    chokeGroups: state.chokeGroups,
    kit: state.kit || '',
    bars: state.drumPatternBars || findPattern(state.patterns, 'drums', state.activePatternIds.drums)?.bars || 1
  });
  writeWorkingToPattern(state.patterns, 'chords', state.activePatternIds.chords, {
    chords: state.chords,
    bars: findPattern(state.patterns, 'chords', state.activePatternIds.chords)?.bars || 1
  });
  // Keep current section pointing at active patterns while editing
  const section = state.sections?.[state.songSection];
  if (section) {
    section.patterns = section.patterns || {};
    section.patterns.keys = state.activePatternIds.melody;
    section.patterns.bass = state.activePatternIds.bass;
    section.patterns.drums = state.activePatternIds.drums;
    section.patterns.chords = state.activePatternIds.chords;
  }
}

export function loadActivePatternsIntoWorking(state) {
  ensureDawState(state);
  const mel = readPatternToWorking(state.patterns, 'melody', state.activePatternIds.melody);
  const drm = readPatternToWorking(state.patterns, 'drums', state.activePatternIds.drums);
  const chd = readPatternToWorking(state.patterns, 'chords', state.activePatternIds.chords);
  state.pattern = mel.notes;
  state.patternBars = mel.bars || 1;
  state.drums = drm.drums;
  state.drumRolls = drm.rolls || {};
  state.drumVelocity = drm.velocity || {};
  state.drumNudge = drm.nudge || {};
  state.chokeGroups = drm.chokeGroups || { openhat: 1, hat: 1 };
  state.drumPatternBars = drm.bars || 1;
  if (drm.kit) state.kit = drm.kit;
  state.chords = chd.chords;
  if (state.activePatternIds.bass) {
    const bss = readPatternToWorking(state.patterns, 'bass', state.activePatternIds.bass);
    if (bss) {
      state.bassPattern = bss.notes;
      state.bassPatternBars = bss.bars || 1;
    }
  }
}

export function selectPattern(state, kind, id) {
  ensureDawState(state);
  syncWorkingToActivePatterns(state);
  if (!findPattern(state.patterns, kind, id)) return false;
  state.activePatternIds[kind] = id;
  const section = state.sections?.[state.songSection];
  if (section) {
    const trackKey = kind === 'melody' ? 'keys' : kind;
    section.patterns = section.patterns || {};
    section.patterns[trackKey] = id;
  }
  loadActivePatternsIntoWorking(state);
  rebuildPlaylist(state);
  return true;
}

export function createPattern(state, kind, name) {
  ensureDawState(state);
  syncWorkingToActivePatterns(state);
  let pattern;
  if (kind === 'melody') pattern = emptyMelodyPattern(name || `Melody ${state.patterns.melody.length + 1}`, state.patternBars || 1, []);
  else if (kind === 'bass') pattern = emptyBassPattern(name || `Bass ${(state.patterns.bass?.length || 0) + 1}`, state.bassPatternBars || 1, []);
  else if (kind === 'drums') pattern = emptyDrumPattern(name || `Drums ${state.patterns.drums.length + 1}`, state.drumPatternBars || 1, {}, {}, {}, {}, state.chokeGroups);
  else pattern = emptyChordPattern(name || `Chords ${state.patterns.chords.length + 1}`, 1, state.chords);
  if (!state.patterns[kind]) state.patterns[kind] = [];
  state.patterns[kind].push(pattern);
  selectPattern(state, kind, pattern.id);
  return pattern;
}

export function duplicateActivePattern(state, kind) {
  ensureDawState(state);
  syncWorkingToActivePatterns(state);
  const id = state.activePatternIds[kind];
  const copy = duplicatePatternInBank(state.patterns, kind, id);
  if (!copy) return null;
  selectPattern(state, kind, copy.id);
  return copy;
}

/** Fork the active pattern for the current section so edits stay local. */
export function uniquePatternForSection(state, kind) {
  ensureDawState(state);
  syncWorkingToActivePatterns(state);
  const section = state.sections?.[state.songSection];
  if (!section) return null;
  const trackKey = kind === 'melody' ? 'keys' : kind;
  const currentId = section.patterns?.[trackKey] || state.activePatternIds[kind];
  const shared = (state.sections || []).filter(sec => sec.patterns?.[trackKey] === currentId).length > 1;
  if (!shared) {
    selectPattern(state, kind, currentId);
    return findPattern(state.patterns, kind, currentId);
  }
  const sectionName = section.name || 'Section';
  const copy = duplicatePatternInBank(state.patterns, kind, currentId, `${sectionName} ${kind}`);
  if (!copy) return null;
  section.patterns[trackKey] = copy.id;
  state.activePatternIds[kind] = copy.id;
  loadActivePatternsIntoWorking(state);
  rebuildPlaylist(state);
  return copy;
}

export function rebuildPlaylist(state) {
  ensureDawState(state);
  syncWorkingToActivePatterns(state);
  const vocalTakeId = state.vocalTakes?.find(take => take.url === state.vocals?.url)?.id
    || state.vocalTakes?.[0]?.id
    || null;
  for (const section of state.sections || []) {
    if (section.active?.vocals && vocalTakeId) section.vocalTakeId = section.vocalTakeId || vocalTakeId;
  }
  const next = rebuildPlaylistFromSections(state.sections, {
    vocalTakeId,
    melodyAdded: state.melodyAdded,
    drumsAdded: state.drumsAdded,
    chordAdded: state.chordAdded,
    vocalAdded: state.vocalAdded,
    trackList: state.tracks
  });
  // Preserve clips on user-added tracks that section rebuild does not touch
  const preservedExtras = (state.playlist?.tracks || []).filter(
    track => !['keys', 'drums', 'chords', 'vocals'].includes(track.id)
  );
  state.playlist = mergePlaylistPreservingEdits(state.playlist, next);
  for (const extra of preservedExtras) {
    if (!state.playlist.tracks.some(t => t.id === extra.id)) {
      state.playlist.tracks.push(extra);
    }
  }
}

/** Place or refresh playlist after committing a part from the guided flow. */
export function commitPartGuided(state, kind) {
  ensureDawState(state);
  if (kind === 'melody' && !findPattern(state.patterns, 'melody', state.activePatternIds.melody)) {
    const pattern = emptyMelodyPattern('Melody 1', state.patternBars || 1, state.pattern);
    state.patterns.melody.push(pattern);
    state.activePatternIds.melody = pattern.id;
  }
  if (kind === 'drums' && !findPattern(state.patterns, 'drums', state.activePatternIds.drums)) {
    const pattern = emptyDrumPattern('Drums 1', 1, serializeWorkingDrums(state.drums), state.drumRolls);
    state.patterns.drums.push(pattern);
    state.activePatternIds.drums = pattern.id;
  }
  if (kind === 'chords' && !findPattern(state.patterns, 'chords', state.activePatternIds.chords)) {
    const pattern = emptyChordPattern(state.chords?.name || 'Chords 1', 1, state.chords);
    state.patterns.chords.push(pattern);
    state.activePatternIds.chords = pattern.id;
  }
  syncWorkingToActivePatterns(state);

  const trackKey = kind === 'melody' ? 'keys' : kind === 'drums' ? 'drums' : kind === 'chords' ? 'chords' : null;
  if (trackKey) {
    if (state.songMode) {
      // Only update the section being edited so verse/hook stay independent
      const current = state.sections?.[state.songSection];
      if (current) {
        current.patterns = current.patterns || {};
        current.patterns[trackKey] = state.activePatternIds[kind === 'melody' ? 'melody' : kind];
      }
    } else {
      // Loop / first commit: every section shares this pattern until Unique is used
      for (const section of state.sections || []) {
        section.patterns = section.patterns || {};
        section.patterns[trackKey] = state.activePatternIds[kind === 'melody' ? 'melody' : kind];
      }
    }
  }

  if (kind === 'vocals') {
    const takeId = ensureVocalTake(state);
    if (state.songMode) {
      const current = state.sections?.[state.songSection];
      if (current) {
        current.active = current.active || {};
        current.active.vocals = true;
        current.vocalTakeId = takeId;
      }
    } else {
      for (const section of state.sections || []) {
        if (section.active?.vocals) section.vocalTakeId = section.vocalTakeId || takeId;
      }
    }
  }
  rebuildPlaylist(state);
}

export function ensureVocalTake(state) {
  if (!state.vocals?.url) return null;
  state.vocalTakes = Array.isArray(state.vocalTakes) ? state.vocalTakes : [];
  let take = state.vocalTakes.find(item => item.url === state.vocals.url);
  if (!take) {
    take = {
      id: createPatternId(),
      title: state.vocals.title || 'Vocal',
      url: state.vocals.url,
      start: 0,
      end: 1,
      gain: 1
    };
    state.vocalTakes.push(take);
  }
  return take.id;
}

export function placeVocalOnSection(state, sectionIndex, takeId) {
  ensureDawState(state);
  const section = state.sections?.[sectionIndex];
  if (!section) return false;
  section.vocalTakeId = takeId;
  section.active = section.active || {};
  section.active.vocals = true;
  state.vocalAdded = true;
  rebuildPlaylist(state);
  return true;
}

export function selectSongSectionDaw(state, index) {
  ensureDawState(state);
  syncWorkingToActivePatterns(state);
  const next = Number(index);
  if (!Number.isInteger(next) || !state.sections[next]) return false;
  state.songSection = next;
  const section = state.sections[next];
  if (section.patterns?.keys) state.activePatternIds.melody = section.patterns.keys;
  if (section.patterns?.drums) state.activePatternIds.drums = section.patterns.drums;
  if (section.patterns?.chords) state.activePatternIds.chords = section.patterns.chords;
  loadActivePatternsIntoWorking(state);
  return true;
}

export function duplicateSection(state, index) {
  ensureDawState(state);
  syncWorkingToActivePatterns(state);
  const source = state.sections[index];
  if (!source) return false;
  const copy = structuredClone(source);
  copy.name = `${source.name} copy`;
  // Independent pattern copies for the duplicate
  for (const [trackKey, kind] of [['keys', 'melody'], ['drums', 'drums'], ['chords', 'chords']]) {
    const id = source.patterns?.[trackKey];
    if (!id) continue;
    const dup = duplicatePatternInBank(state.patterns, kind, id, `${copy.name} ${kind}`);
    if (dup) copy.patterns[trackKey] = dup.id;
  }
  state.sections.splice(index + 1, 0, copy);
  rebuildPlaylist(state);
  return true;
}

export function addSection(state, name = 'Section') {
  ensureDawState(state);
  syncWorkingToActivePatterns(state);
  state.sections.push({
    name,
    bars: 2,
    active: { keys: true, drums: true, chords: true, vocals: false },
    patterns: {
      keys: state.activePatternIds.melody,
      drums: state.activePatternIds.drums,
      chords: state.activePatternIds.chords
    },
    vocalTakeId: null
  });
  rebuildPlaylist(state);
}

export function removeSection(state, index) {
  if (!state.sections || state.sections.length <= 1) return false;
  state.sections.splice(index, 1);
  if (state.songSection >= state.sections.length) state.songSection = state.sections.length - 1;
  rebuildPlaylist(state);
  return true;
}

export function reorderSection(state, from, to) {
  if (from === to || from < 0 || to < 0 || from >= state.sections.length || to >= state.sections.length) return false;
  const [item] = state.sections.splice(from, 1);
  state.sections.splice(to, 0, item);
  rebuildPlaylist(state);
  return true;
}

export function dawSnapshotFields(state) {
  ensureDawState(state);
  syncWorkingToActivePatterns(state);
  return {
    schemaVersion: 3,
    patterns: structuredClone(state.patterns),
    activePatternIds: { ...state.activePatternIds },
    playlist: structuredClone(state.playlist || emptyPlaylist()),
    tracks: structuredClone(state.tracks || emptyTrackList()),
    transport: structuredClone(state.transport || defaultTransport()),
    patternBars: state.patternBars || 1
  };
}

export function applyDawSnapshotFields(state, project) {
  const migrated = migrateProjectToV3(project);
  state.patterns = ensurePatternBank(migrated.patterns);
  state.activePatternIds = { ...migrated.activePatternIds };
  state.sections = migrated.sections;
  state.tracks = normalizeTrackList(migrated.tracks, migrated.mix);
  state.mix = { ...mixMapFromTracks(state.tracks), ...(migrated.mix || {}) };
  state.playlist = normalizePlaylist(migrated.playlist, state.tracks);
  state.transport = normalizeTransport(migrated.transport, totalSongBars(state.sections));
  state.patternBars = migrated.patternBars || findPattern(state.patterns, 'melody', state.activePatternIds.melody)?.bars || 1;
  loadActivePatternsIntoWorking(state);
}

export function makeClipUnique(state, trackId, clipId) {
  ensureDawState(state);
  const trackClips = state.playlist?.[trackId];
  if (!Array.isArray(trackClips)) return null;
  const clip = trackClips.find(c => c.id === clipId);
  if (!clip || !clip.patternId) return null;

  // Determine kind of pattern (melody, drums, bass, chords, custom)
  let foundKind = null;
  let sourcePat = null;
  for (const [kind, list] of Object.entries(state.patterns || {})) {
    if (Array.isArray(list)) {
      const match = list.find(p => p.id === clip.patternId);
      if (match) {
        foundKind = kind;
        sourcePat = match;
        break;
      }
    }
  }

  if (!foundKind || !sourcePat) return null;

  const newName = `${sourcePat.name} #2`;
  const newPat = duplicatePatternInBank(state.patterns, foundKind, sourcePat.id, newName);
  if (!newPat) return null;

  clip.patternId = newPat.id;
  clip.id = createClipId();
  return { clip, newPattern: newPat };
}

export {
  resolvePatternAtBar,
  clipAtBar,
  automationGainAt,
  sectionStartBars,
  totalSongBars,
  sectionIndexAtBar,
  moveClip,
  resizeClip,
  createClipId,
  findPattern,
  cloneNotes,
  migrateProjectToV3,
  addTrack,
  duplicateTrack,
  deleteTrack,
  renameTrack,
  reorderTracks,
  deleteClips,
  duplicateClip,
  cloneClips,
  pasteClips,
  splitClip,
  joinClips,
  snapValue,
  normalizeTrackList,
  mixMapFromTracks,
  setTrackAutomation,
  emptyBassPattern
};
