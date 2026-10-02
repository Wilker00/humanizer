/** Playlist / arrangement — clips on tracks over a bar timeline. */

import { findPattern, createPatternId } from './patterns.js';

/** Legacy four-part IDs kept for section rebuild + migration. */
export const PLAYLIST_TRACKS = ['keys', 'drums', 'chords', 'vocals'];

export const TRACK_KINDS = ['keys', 'drums', 'chords', 'vocals', 'bass', 'lead', 'pad', 'audio', 'midi'];

const TRACK_DEFAULTS = {
  keys: { name: 'Keys', kind: 'keys', color: '#7dd3fc' },
  drums: { name: 'Drums', kind: 'drums', color: '#fbbf24' },
  chords: { name: 'Chords', kind: 'chords', color: '#c4b5fd' },
  vocals: { name: 'Vocals', kind: 'vocals', color: '#fb7185' },
  bass: { name: 'Bass', kind: 'bass', color: '#34d399' },
  lead: { name: 'Lead', kind: 'lead', color: '#f472b6' },
  pad: { name: 'Pad', kind: 'pad', color: '#a78bfa' },
  audio: { name: 'Audio', kind: 'audio', color: '#94a3b8' },
  midi: { name: 'MIDI', kind: 'midi', color: '#38bdf8' }
};

export function createClipId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `clip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createTrackId(prefix = 'track') {
  if (typeof globalThis.crypto?.randomUUID === 'function') return `${prefix}-${globalThis.crypto.randomUUID().slice(0, 8)}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function defaultTrackMeta(id) {
  const base = TRACK_DEFAULTS[id] || { name: id, kind: 'midi', color: '#94a3b8' };
  return {
    id,
    name: base.name,
    kind: base.kind,
    color: base.color,
    patch: defaultPatchForKind(base.kind),
    mix: { mute: false, solo: false, vol: defaultVolForKind(base.kind), pan: 0, send: 0 },
    fx: [],
    automation: [],
    armed: false
  };
}

function defaultVolForKind(kind) {
  if (kind === 'drums') return 0.75;
  if (kind === 'chords' || kind === 'pad') return 0.5;
  if (kind === 'vocals' || kind === 'audio') return 0.7;
  return 0.8;
}

function defaultPatchForKind(kind) {
  if (kind === 'drums') return { kit: 'rnb' };
  if (kind === 'vocals' || kind === 'audio') return { chain: 'Modern R&B' };
  if (kind === 'chords' || kind === 'pad') return { instrument: 'rhodes' };
  if (kind === 'bass') return { instrument: 'bass' };
  return { instrument: 'rhodes' };
}

export function emptyTrackList() {
  return PLAYLIST_TRACKS.map(id => defaultTrackMeta(id));
}

export function normalizeTrackList(raw, mix = null) {
  if (!Array.isArray(raw) || !raw.length) {
    const list = emptyTrackList();
    if (mix && typeof mix === 'object') {
      for (const track of list) {
        if (mix[track.id]) track.mix = { ...track.mix, ...sanitizeMix(mix[track.id]) };
      }
    }
    return list;
  }
  const seen = new Set();
  const list = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string') continue;
    if (seen.has(item.id) || list.length >= 64) continue;
    seen.add(item.id);
    const defaults = defaultTrackMeta(item.id);
    const kind = TRACK_KINDS.includes(item.kind) ? item.kind : defaults.kind;
    list.push({
      id: item.id,
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 48) : defaults.name,
      kind,
      color: typeof item.color === 'string' ? item.color : defaults.color,
      patch: normalizePatch(item.patch, kind),
      mix: sanitizeMix({ ...defaults.mix, ...(mix?.[item.id] || {}), ...(item.mix || {}) }),
      fx: normalizeFxChain(item.fx),
      automation: normalizeAutomation(item.automation),
      armed: !!item.armed
    });
  }
  for (const id of PLAYLIST_TRACKS) {
    if (!seen.has(id)) {
      const track = defaultTrackMeta(id);
      if (mix?.[id]) track.mix = { ...track.mix, ...sanitizeMix(mix[id]) };
      list.push(track);
    }
  }
  return list;
}

function sanitizeMix(raw) {
  return {
    mute: !!raw?.mute,
    solo: !!raw?.solo,
    vol: clampGain(raw?.vol ?? 0.8),
    pan: Math.max(-1, Math.min(1, Number(raw?.pan) || 0)),
    send: Math.max(0, Math.min(1.5, Number(raw?.send) || 0)),
    delaySend: Math.max(0, Math.min(1.5, Number(raw?.delaySend) || 0)),
    delayPre: !!raw?.delayPre,
    cue: Math.max(0, Math.min(1, Number(raw?.cue) || 0))
  };
}

function normalizePatch(raw, kind) {
  const base = defaultPatchForKind(kind);
  const synth = normalizeSynthPatch(raw, kind);
  const sampler = normalizeSamplerPatch(raw?.sampler);
  if (!raw || typeof raw !== 'object') return { ...base, ...synth, sampler };
  return {
    instrument: typeof raw.instrument === 'string' ? raw.instrument : base.instrument,
    kit: typeof raw.kit === 'string' ? raw.kit : base.kit,
    chain: typeof raw.chain === 'string' ? raw.chain : base.chain,
    ...synth,
    sampler
  };
}

function normalizeSynthPatch(raw, kind) {
  const bass = kind === 'bass';
  return {
    attack: clampNumber(raw?.attack, 0.001, 2, 0.01),
    decay: clampNumber(raw?.decay, 0.01, 2, 0.2),
    sustain: clampNumber(raw?.sustain, 0, 1, 0.7),
    release: clampNumber(raw?.release, 0.01, 4, 0.35),
    filterHz: clampNumber(raw?.filterHz, 120, 12000, bass ? 800 : 2400),
    drive: clampNumber(raw?.drive, 0, 1, 0),
    unison: Math.max(1, Math.min(3, Math.round(Number(raw?.unison) || 1)))
  };
}

function normalizeSamplerPatch(raw) {
  if (!raw || typeof raw !== 'object') {
    return { url: null, name: '', rootKey: 'C4', lowKey: 'C2', highKey: 'C6', loopStart: 0, loopEnd: 1, gain: 1 };
  }
  return {
    url: typeof raw.url === 'string' ? raw.url : null,
    name: typeof raw.name === 'string' ? raw.name.slice(0, 80) : '',
    rootKey: /^[A-G]#?[0-8]$/.test(raw.rootKey || '') ? raw.rootKey : 'C4',
    lowKey: /^[A-G]#?[0-8]$/.test(raw.lowKey || '') ? raw.lowKey : 'C2',
    highKey: /^[A-G]#?[0-8]$/.test(raw.highKey || '') ? raw.highKey : 'C6',
    loopStart: clamp01(raw.loopStart),
    loopEnd: Math.max(0.01, Math.min(1, Number(raw.loopEnd) || 1)),
    gain: clampGain(raw.gain)
  };
}

function normalizeFxChain(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(fx => fx && typeof fx === 'object' && typeof fx.type === 'string')
    .slice(0, 8)
    .map(fx => ({
      id: typeof fx.id === 'string' ? fx.id : createClipId(),
      type: ['eq', 'compress', 'saturator', 'chorus', 'filter', 'utility'].includes(fx.type) ? fx.type : 'eq',
      bypass: !!fx.bypass,
      params: objectParams(fx.params)
    }));
}

function objectParams(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const n = Number(value);
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
}

export function mixMapFromTracks(tracks) {
  const mix = {};
  for (const track of tracks || []) {
    mix[track.id] = { ...sanitizeMix(track.mix) };
  }
  return mix;
}

export function emptyPlaylist(trackIds = PLAYLIST_TRACKS) {
  const ids = Array.isArray(trackIds) && trackIds.length ? trackIds : PLAYLIST_TRACKS;
  return {
    tracks: ids.map(id => ({ id, clips: [] }))
  };
}

export function normalizePlaylist(raw, trackList = null) {
  const ids = Array.isArray(trackList) && trackList.length
    ? trackList.map(t => t.id)
    : (Array.isArray(raw?.tracks) ? raw.tracks.map(t => t?.id).filter(Boolean) : PLAYLIST_TRACKS);
  const unique = [...new Set([...ids, ...PLAYLIST_TRACKS])];
  const playlist = emptyPlaylist(unique);
  if (!raw || typeof raw !== 'object') return playlist;
  for (const track of playlist.tracks) {
    const source = Array.isArray(raw.tracks) ? raw.tracks.find(item => item?.id === track.id) : null;
    const clips = Array.isArray(source?.clips) ? source.clips : [];
    track.clips = clips.map(normalizeClip).filter(Boolean);
    if (typeof source?.name === 'string') track.name = source.name;
  }
  return playlist;
}

function normalizeClip(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const startBar = clampBar(raw.startBar, 0, 255);
  const lengthBars = clampLength(raw.lengthBars);
  const clip = {
    id: typeof raw.id === 'string' ? raw.id : createClipId(),
    startBar,
    lengthBars,
    gain: clampGain(raw.gain),
    automation: normalizeAutomation(raw.automation),
    mode: ['trim', 'repeat', 'stretch'].includes(raw.mode) ? raw.mode : 'repeat'
  };
  if (typeof raw.patternId === 'string') clip.patternId = raw.patternId;
  if (typeof raw.audioTakeId === 'string') clip.audioTakeId = raw.audioTakeId;
  if (raw.takeStart !== undefined) clip.takeStart = clamp01(raw.takeStart);
  if (raw.takeEnd !== undefined) clip.takeEnd = clamp01(raw.takeEnd);
  if (raw.fadeIn !== undefined) clip.fadeIn = clamp01(raw.fadeIn);
  if (raw.fadeOut !== undefined) clip.fadeOut = clamp01(raw.fadeOut);
  if (raw.slip !== undefined) clip.slip = Math.max(0, Math.min(1, Number(raw.slip) || 0));
  if (raw.locked !== undefined) clip.locked = !!raw.locked;
  if (raw.muted !== undefined) clip.muted = !!raw.muted;
  if (raw.warpMode !== undefined) clip.warpMode = ['off', 'beats', 'tones'].includes(raw.warpMode) ? raw.warpMode : 'off';
  if (raw.sourceBpm !== undefined) clip.sourceBpm = Math.max(40, Math.min(240, Number(raw.sourceBpm) || 120));
  if (raw.takeLaneId !== undefined && typeof raw.takeLaneId === 'string') clip.takeLaneId = raw.takeLaneId;
  if (raw.compSourceId !== undefined && typeof raw.compSourceId === 'string') clip.compSourceId = raw.compSourceId;
  if (raw.pitchCorrection !== undefined && raw.pitchCorrection && typeof raw.pitchCorrection === 'object') {
    clip.pitchCorrection = {
      enabled: !!raw.pitchCorrection.enabled,
      semitone: Math.max(-12, Math.min(12, Math.round(Number(raw.pitchCorrection.semitone) || 0))),
      snapToScale: !!raw.pitchCorrection.snapToScale
    };
  }
  if (!clip.patternId && !clip.audioTakeId) return null;
  return clip;
}

function clampBar(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  // Allow fractional bars (sub-beat positioning) with 1/16 bar resolution
  const snapped = Math.round(number * 16) / 16;
  return Math.max(min, Math.min(max, snapped));
}

function clampLength(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  const snapped = Math.round(number * 16) / 16;
  return Math.max(1 / 16, Math.min(64, snapped));
}

function clampGain(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1.5, number)) : 1;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function clamp01(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

function normalizeAutomation(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(point => point && typeof point === 'object')
    .map(point => ({
      bar: Math.max(0, Number(point.bar) || 0),
      gain: clampGain(point.gain)
    }))
    .slice(0, 64);
}

export function snapValue(value, snap = 'bar') {
  const n = Number(value) || 0;
  if (snap === 'off') return Math.max(0, n);
  if (snap === 'beat') return Math.max(0, Math.round(n * 4) / 4);
  if (snap === '1/2') return Math.max(0, Math.round(n * 2) / 2);
  if (snap === '1/16') return Math.max(0, Math.round(n * 16) / 16);
  return Math.max(0, Math.round(n));
}

export function sectionStartBars(sections) {
  const starts = [];
  let cursor = 0;
  for (const section of sections || []) {
    starts.push(cursor);
    cursor += Math.max(1, Number(section.bars) || 1);
  }
  return starts;
}

export function totalSongBars(sections) {
  return (sections || []).reduce((sum, section) => sum + Math.max(1, Number(section.bars) || 1), 0);
}

export function sectionIndexAtBar(sections, songBar) {
  let cursor = 0;
  for (let index = 0; index < (sections || []).length; index++) {
    const length = Math.max(1, Number(sections[index].bars) || 1);
    if (songBar >= cursor && songBar < cursor + length) return index;
    cursor += length;
  }
  return -1;
}

/**
 * Rebuild playlist clips from section pattern assignments.
 * Vocals: one clip per section that has vocals active, using vocalTakeId or default take.
 * Extra user tracks are preserved (clips cleared only for legacy four).
 */
export function rebuildPlaylistFromSections(sections, { vocalTakeId = null, melodyAdded, drumsAdded, chordAdded, vocalAdded, trackList = null } = {}) {
  const ids = Array.isArray(trackList) && trackList.length
    ? trackList.map(t => t.id)
    : PLAYLIST_TRACKS;
  const playlist = emptyPlaylist(ids);
  const starts = sectionStartBars(sections);
  (sections || []).forEach((section, index) => {
    const startBar = starts[index] ?? 0;
    const lengthBars = Math.max(1, Number(section.bars) || 1);
    const place = (trackId, patternId, enabled) => {
      if (!enabled || !patternId) return;
      const track = playlist.tracks.find(item => item.id === trackId);
      if (!track) return;
      track.clips.push({
        id: createClipId(),
        patternId,
        startBar,
        lengthBars,
        gain: 1,
        automation: [],
        mode: 'repeat'
      });
    };
    if (melodyAdded !== false) place('keys', section.patterns?.keys, section.active?.keys !== false);
    if (drumsAdded !== false) place('drums', section.patterns?.drums, section.active?.drums !== false);
    if (chordAdded !== false) place('chords', section.patterns?.chords, section.active?.chords !== false);
    if (vocalAdded !== false && section.active?.vocals !== false) {
      const takeId = section.vocalTakeId || vocalTakeId;
      if (takeId) {
        const track = playlist.tracks.find(item => item.id === 'vocals');
        if (track) {
          track.clips.push({
            id: createClipId(),
            audioTakeId: takeId,
            startBar,
            lengthBars,
            gain: 1,
            automation: [],
            takeStart: 0,
            takeEnd: 1,
            mode: 'trim'
          });
        }
      }
    }
  });
  return playlist;
}

export function trackClips(playlist, trackId) {
  return playlist?.tracks?.find(track => track.id === trackId)?.clips || [];
}

export function findTrack(playlist, trackId) {
  return playlist?.tracks?.find(track => track.id === trackId) || null;
}

/** Find the clip covering a song bar on a track (latest start wins on overlap). */
export function clipAtBar(playlist, trackId, songBar) {
  const clips = trackClips(playlist, trackId)
    .filter(clip => songBar >= clip.startBar && songBar < clip.startBar + clip.lengthBars)
    .sort((a, b) => a.startBar - b.startBar);
  return clips.length ? clips[clips.length - 1] : null;
}

export function automationGainAt(clip, songBar) {
  const base = clip?.gain ?? 1;
  const points = clip?.automation;
  if (!Array.isArray(points) || !points.length) return base;
  const local = Math.max(0, songBar - (clip.startBar || 0));
  const sorted = [...points].sort((a, b) => a.bar - b.bar);
  if (local <= sorted[0].bar) return sorted[0].gain * base;
  for (let i = 1; i < sorted.length; i++) {
    if (local <= sorted[i].bar) {
      const a = sorted[i - 1];
      const b = sorted[i];
      const t = (local - a.bar) / Math.max(0.0001, b.bar - a.bar);
      return (a.gain + (b.gain - a.gain) * t) * base;
    }
  }
  return sorted[sorted.length - 1].gain * base;
}

export function moveClip(playlist, trackId, clipId, startBar, snap = 'bar') {
  const clip = trackClips(playlist, trackId).find(item => item.id === clipId);
  if (!clip) return false;
  clip.startBar = snapValue(Math.max(0, Math.min(255, Number(startBar) || 0)), snap);
  return true;
}

export function resizeClip(playlist, trackId, clipId, lengthBars, snap = 'bar') {
  const clip = trackClips(playlist, trackId).find(item => item.id === clipId);
  if (!clip) return false;
  clip.lengthBars = Math.max(snap === 'off' ? 1 / 16 : snapValue(1 / 16, snap) || 1 / 16, Math.min(64, snapValue(Number(lengthBars) || 1, snap) || 1));
  return true;
}

export function setClipAutomation(playlist, trackId, clipId, points) {
  const clip = trackClips(playlist, trackId).find(item => item.id === clipId);
  if (!clip) return false;
  clip.automation = normalizeAutomation(points);
  return true;
}

export function setTrackAutomation(trackList, trackId, points) {
  const track = (trackList || []).find(item => item.id === trackId);
  if (!track) return false;
  track.automation = normalizeAutomation(points);
  return true;
}

export function deleteClips(playlist, selections) {
  let removed = 0;
  for (const sel of selections || []) {
    const track = findTrack(playlist, sel.trackId);
    if (!track) continue;
    const before = track.clips.length;
    track.clips = track.clips.filter(c => c.id !== sel.clipId);
    removed += before - track.clips.length;
  }
  return removed;
}

export function duplicateClip(playlist, trackId, clipId, offsetBars = null) {
  const track = findTrack(playlist, trackId);
  const clip = track?.clips?.find(c => c.id === clipId);
  if (!clip) return null;
  const copy = structuredClone(clip);
  copy.id = createClipId();
  const gap = offsetBars != null ? Number(offsetBars) : clip.lengthBars;
  copy.startBar = Math.min(255, clip.startBar + Math.max(0, gap));
  track.clips.push(copy);
  return copy;
}

export function cloneClips(playlist, selections) {
  return (selections || []).map(sel => {
    const clip = trackClips(playlist, sel.trackId).find(c => c.id === sel.clipId);
    if (!clip) return null;
    return { trackId: sel.trackId, clip: structuredClone(clip) };
  }).filter(Boolean);
}

export function pasteClips(playlist, clipboard, atBar, snap = 'bar') {
  if (!clipboard?.length) return [];
  const minStart = Math.min(...clipboard.map(item => item.clip.startBar));
  const created = [];
  for (const item of clipboard) {
    let track = findTrack(playlist, item.trackId);
    if (!track) {
      playlist.tracks.push({ id: item.trackId, clips: [] });
      track = findTrack(playlist, item.trackId);
    }
    const copy = structuredClone(item.clip);
    copy.id = createClipId();
    copy.startBar = snapValue(atBar + (item.clip.startBar - minStart), snap);
    track.clips.push(copy);
    created.push({ trackId: item.trackId, clipId: copy.id });
  }
  return created;
}

export function splitClip(playlist, trackId, clipId, atBar, snap = '1/16') {
  const track = findTrack(playlist, trackId);
  const clip = track?.clips?.find(c => c.id === clipId);
  if (!clip) return null;
  const splitAt = snapValue(atBar, snap);
  if (splitAt <= clip.startBar || splitAt >= clip.startBar + clip.lengthBars) return null;
  const leftLen = splitAt - clip.startBar;
  const rightLen = clip.lengthBars - leftLen;
  const right = structuredClone(clip);
  right.id = createClipId();
  right.startBar = splitAt;
  right.lengthBars = rightLen;
  if (clip.audioTakeId != null) {
    const span = (clip.takeEnd ?? 1) - (clip.takeStart ?? 0);
    const ratio = leftLen / clip.lengthBars;
    const mid = (clip.takeStart ?? 0) + span * ratio;
    clip.takeEnd = mid;
    right.takeStart = mid;
  }
  clip.lengthBars = leftLen;
  track.clips.push(right);
  return right;
}

export function joinClips(playlist, trackId, clipIdA, clipIdB) {
  const track = findTrack(playlist, trackId);
  if (!track) return null;
  const a = track.clips.find(c => c.id === clipIdA);
  const b = track.clips.find(c => c.id === clipIdB);
  if (!a || !b) return null;
  const [left, right] = a.startBar <= b.startBar ? [a, b] : [b, a];
  const samePattern = left.patternId && left.patternId === right.patternId;
  const sameAudio = left.audioTakeId && left.audioTakeId === right.audioTakeId;
  if (!samePattern && !sameAudio) return null;
  const gap = right.startBar - (left.startBar + left.lengthBars);
  if (Math.abs(gap) > 0.01) return null;
  left.lengthBars += right.lengthBars;
  if (sameAudio) left.takeEnd = right.takeEnd ?? left.takeEnd;
  track.clips = track.clips.filter(c => c.id !== right.id);
  return left;
}

export function addTrack(trackList, playlist, { kind = 'midi', name = null, afterId = null } = {}) {
  const meta = defaultTrackMeta(createTrackId(kind));
  meta.kind = TRACK_KINDS.includes(kind) ? kind : 'midi';
  meta.name = name || TRACK_DEFAULTS[kind]?.name || `Track ${trackList.length + 1}`;
  meta.patch = defaultPatchForKind(meta.kind);
  meta.mix = sanitizeMix({ mute: false, solo: false, vol: defaultVolForKind(meta.kind), pan: 0 });
  const insertAt = afterId ? trackList.findIndex(t => t.id === afterId) + 1 : trackList.length;
  trackList.splice(Math.max(0, insertAt), 0, meta);
  if (playlist && !findTrack(playlist, meta.id)) {
    playlist.tracks.push({ id: meta.id, clips: [] });
  }
  return meta;
}

export function duplicateTrack(trackList, playlist, trackId) {
  const index = trackList.findIndex(t => t.id === trackId);
  if (index < 0) return null;
  const source = trackList[index];
  const copy = structuredClone(source);
  copy.id = createTrackId(source.kind);
  copy.name = `${source.name} copy`;
  trackList.splice(index + 1, 0, copy);
  const sourceClips = trackClips(playlist, trackId).map(c => {
    const clip = structuredClone(c);
    clip.id = createClipId();
    return clip;
  });
  playlist.tracks.splice(index + 1, 0, { id: copy.id, clips: sourceClips });
  return copy;
}

export function deleteTrack(trackList, playlist, trackId, mix = null) {
  if (PLAYLIST_TRACKS.includes(trackId)) return false;
  const index = trackList.findIndex(t => t.id === trackId);
  if (index < 0) return false;
  trackList.splice(index, 1);
  if (playlist) playlist.tracks = playlist.tracks.filter(t => t.id !== trackId);
  if (mix && mix[trackId]) delete mix[trackId];
  return true;
}

export function renameTrack(trackList, trackId, name) {
  const track = trackList.find(t => t.id === trackId);
  if (!track) return false;
  track.name = String(name || track.name).trim().slice(0, 48) || track.name;
  return true;
}

export function reorderTracks(trackList, playlist, fromId, toId) {
  const from = trackList.findIndex(t => t.id === fromId);
  const to = trackList.findIndex(t => t.id === toId);
  if (from < 0 || to < 0 || from === to) return false;
  const [item] = trackList.splice(from, 1);
  trackList.splice(to, 0, item);
  if (playlist?.tracks) {
    const order = trackList.map(t => t.id);
    playlist.tracks.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }
  return true;
}

/**
 * Resolve which pattern content plays at a song bar for a MIDI track.
 * Returns { pattern, localBar, clip, gain } or null.
 */
export function resolvePatternAtBar(playlist, patterns, trackId, kind, songBar) {
  const clip = clipAtBar(playlist, trackId, songBar);
  if (!clip?.patternId) return null;
  const pattern = findPattern(patterns, kind, clip.patternId);
  if (!pattern) return null;
  const localBar = (songBar - clip.startBar) % Math.max(1, pattern.bars || 1);
  return {
    pattern,
    localBar,
    clip,
    gain: automationGainAt(clip, songBar)
  };
}

export function ensureSectionPatterns(section, defaults) {
  section.patterns = section.patterns || {};
  section.patterns.keys = section.patterns.keys || defaults.melody;
  section.patterns.drums = section.patterns.drums || defaults.drums;
  section.patterns.chords = section.patterns.chords || defaults.chords;
  if (section.vocalTakeId === undefined) section.vocalTakeId = null;
  return section;
}

export { createPatternId };
