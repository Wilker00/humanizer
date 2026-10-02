import { evaluateAutomationAt } from './automation.js';
import { midiToPitch } from './score-tools.js';
import { validateProject } from './project-format.js';
import { defaultGroupBuses } from './pro-features.js';

export const GROUP_FOR = { melody: 'music', drums: 'drums', chords: 'music', bass: 'music', vocal: 'vocals' };

export function ensureMix(track) {
  if (!track.fx) track.fx = [];
  if (track.send == null) track.send = 0;
  if (track.delaySend == null) track.delaySend = 0;
  if (!track.group) track.group = GROUP_FOR[track.type] || 'music';
  return track;
}

export function freshSessionFields(song) {
  if (!song.groups) song.groups = defaultGroupBuses();
  if (song.duck == null) song.duck = false;
  if (song.useLayer == null) song.useLayer = false;
  if (!song.laneNames) song.laneNames = ['Kick', 'Snare', 'Hat'];
  if (!song.drumBars) song.drumBars = 1;
  if (!song.choke) song.choke = { 2: 1 };
  if (!song.automation) song.automation = {};
  if (!Array.isArray(song.clips)) song.clips = [];
  if (song.latencyOffsetMs == null) song.latencyOffsetMs = 0;
  song.tracks.forEach(ensureMix);
  return song;
}

export function rebuildClips(slots) {
  const clips = [];
  for (const track of ['drums', 'melody']) {
    let start = -1;
    slots.forEach((slot, bar) => {
      const on = slot === 'both' || slot === track;
      if (on && start < 0) start = bar;
      if (!on && start >= 0) {
        clips.push({ id: `${track}-${start}`, track, startBar: start, lengthBars: bar - start, gain: 1 });
        start = -1;
      }
    });
    if (start >= 0) clips.push({ id: `${track}-${start}`, track, startBar: start, lengthBars: slots.length - start, gain: 1 });
  }
  return clips;
}

export function slotsFromClips(clips, bars) {
  const drums = Array(bars).fill(false);
  const melody = Array(bars).fill(false);
  for (const clip of clips || []) {
    if (clip.muted) continue;
    const lane = clip.track === 'drums' ? drums : clip.track === 'melody' ? melody : null;
    if (!lane) continue;
    const from = Math.max(0, clip.startBar | 0);
    const to = Math.min(bars, from + Math.max(1, clip.lengthBars | 0));
    for (let bar = from; bar < to; bar++) lane[bar] = true;
  }
  return drums.map((hasDrums, index) => {
    const hasMelody = melody[index];
    if (hasDrums && hasMelody) return 'both';
    if (hasDrums) return 'drums';
    if (hasMelody) return 'melody';
    return 'off';
  });
}

export function clipGainAt(clips, track, bar) {
  const clip = (clips || []).find(item => item.track === track && bar >= item.startBar && bar < item.startBar + item.lengthBars);
  if (!clip) return 1;
  if (clip.muted) return 0;
  return clip.gain == null ? 1 : clip.gain;
}

export function automationGain(points, barFloat, bars) {
  if (!points || !points.length) return 1;
  const fraction = Math.max(0, Math.min(1, barFloat / Math.max(1, bars)));
  return evaluateAutomationAt({ points }, fraction);
}

export function shiftSteps(notes, offsetMs, secondsPerStep) {
  if (!offsetMs || !secondsPerStep) return notes;
  const delta = Math.round((offsetMs / 1000) / secondsPerStep);
  if (!delta) return notes;
  notes.forEach(note => {
    note.step = Math.max(0, note.step + delta);
  });
  return notes;
}

export function mirrorProject(song, meta = {}) {
  const max = 128;
  const pattern = (song.track('melody')?.notes || [])
    .filter(note => note.step >= 0 && note.step < max && note.len > 0)
    .slice(0, 256)
    .map(note => ({
      n: midiToPitch(note.midi || 60),
      x: note.step | 0,
      w: Math.max(0.25, Math.min(max - (note.step | 0), note.len)),
      v: Math.max(0, Math.min(1, note.vel == null ? 0.7 : note.vel))
    }))
    .filter(note => note.x + note.w <= max);
  const drums = { kick: [], snare: [], hat: [] };
  const names = ['kick', 'snare', 'hat'];
  (song.track('drums')?.notes || []).forEach(note => {
    const lane = names[note.lane];
    if (!lane || note.fill || note.step < 0 || note.step >= max) return;
    drums[lane].push(note.step | 0);
  });
  return {
    schemaVersion: 1,
    name: meta.name || 'Untitled idea',
    bpm: meta.bpm || 100,
    pattern,
    drums
  };
}

export function checkProject(song, meta) {
  try {
    validateProject(mirrorProject(song, meta));
    return 'Project check passed';
  } catch (error) {
    return error.message || 'Project check failed';
  }
}
