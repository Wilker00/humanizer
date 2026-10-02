/**
 * Shared arrangement / timing resolution for live playback, WAV render, and MIDI.
 * One code path prevents live vs export divergence.
 */
import { findPattern } from './patterns.js';
import {
  clipAtBar,
  automationGainAt,
  sectionIndexAtBar,
  totalSongBars,
  trackClips
} from './playlist.js';

export function stepsPerBar(meter = '4/4') {
  return meter === '3/4' || meter === '6/8' ? 12 : 16;
}

export function beatsPerBar(meter = '4/4') {
  if (meter === '3/4') return 3;
  if (meter === '6/8') return 6;
  return 4;
}

export function pulseSteps(meter = '4/4') {
  return meter === '6/8' ? 6 : 4;
}

/** Finite take gain; 0 stays 0 (never coerced to unity). */
export function takeGainValue(take, fallback = 1) {
  if (take == null || take.gain === undefined || take.gain === null) return fallback;
  const value = Number(take.gain);
  return Number.isFinite(value) ? Math.max(0, Math.min(1.5, value)) : fallback;
}

/**
 * Continuous automation along a clip (fractional bars).
 * Points use bar offsets relative to clip start.
 */
export function automationGainAtFractional(clip, songBarFloat) {
  const base = clip?.gain ?? 1;
  const points = clip?.automation;
  if (!Array.isArray(points) || !points.length) return base;
  const local = Math.max(0, Number(songBarFloat) - (clip.startBar || 0));
  const sorted = [...points].sort((a, b) => a.bar - b.bar);
  if (local <= sorted[0].bar) return sorted[0].gain * base;
  for (let i = 1; i < sorted.length; i++) {
    if (local <= sorted[i].bar) {
      const a = sorted[i - 1];
      const b = sorted[i];
      const span = Math.max(0.0001, b.bar - a.bar);
      const t = (local - a.bar) / span;
      return (a.gain + (b.gain - a.gain) * t) * base;
    }
  }
  return sorted[sorted.length - 1].gain * base;
}

/**
 * Overlap rule: among clips covering a bar, the one with the latest startBar wins
 * (and higher id as tie-break). Exposed for tests.
 */
export function pickTopClip(clips, songBar) {
  const covering = (clips || [])
    .filter(clip => songBar >= clip.startBar && songBar < clip.startBar + clip.lengthBars)
    .sort((a, b) => a.startBar - b.startBar || String(a.id).localeCompare(String(b.id)));
  return covering.length ? covering[covering.length - 1] : null;
}

function patternNotesForBar(pattern, localBar, meter) {
  if (!pattern) return [];
  const perBar = stepsPerBar(meter);
  const offset = localBar * perBar;
  return (pattern.notes || [])
    .filter(note => note.x >= offset && note.x < offset + perBar)
    .map(note => ({ ...note, x: note.x - offset }));
}

export function trackAutomationGainAt(track, songBarFloat) {
  const points = track?.automation;
  if (!Array.isArray(points) || !points.length) return 1;
  const pos = Math.max(0, Number(songBarFloat) || 0);
  const sorted = [...points].sort((a, b) => a.bar - b.bar);
  if (pos <= sorted[0].bar) return sorted[0].gain;
  for (let i = 1; i < sorted.length; i++) {
    if (pos <= sorted[i].bar) {
      const a = sorted[i - 1];
      const b = sorted[i];
      const span = Math.max(0.0001, b.bar - a.bar);
      const t = (pos - a.bar) / span;
      return a.gain + (b.gain - a.gain) * t;
    }
  }
  return sorted[sorted.length - 1].gain;
}

export function drumHitsForBar(pattern, localBar, meter) {
  const defaultLanes = ['kick', 'snare', 'clap', 'hat', 'openhat', 'bass'];
  const allLanes = [...new Set([...defaultLanes, ...Object.keys(pattern?.steps || {}), ...Object.keys(pattern?.velocity || {})])];
  if (!pattern) {
    return {
      steps: Object.fromEntries(allLanes.map(lane => [lane, []])),
      rolls: {},
      velocity: {},
      nudge: {},
      chokeGroups: { openhat: 1, hat: 1 }
    };
  }
  const perBar = stepsPerBar(meter);
  const offset = localBar * perBar;
  const steps = {};
  const velocity = {};
  const nudge = {};
  for (const lane of allLanes) {
    steps[lane] = (pattern.steps?.[lane] || [])
      .filter(step => step >= offset && step < offset + perBar)
      .map(step => step - offset);
    velocity[lane] = {};
    if (pattern.velocity?.[lane]) {
      for (const [step, val] of Object.entries(pattern.velocity[lane])) {
        const s = Number(step);
        if (s >= offset && s < offset + perBar) velocity[lane][s - offset] = Number(val);
      }
    }
    nudge[lane] = {};
    if (pattern.nudge?.[lane]) {
      for (const [step, val] of Object.entries(pattern.nudge[lane])) {
        const s = Number(step);
        if (s >= offset && s < offset + perBar) nudge[lane][s - offset] = Number(val);
      }
    }
  }
  const rolls = {};
  for (const [lane, laneRolls] of Object.entries(pattern.rolls || {})) {
    rolls[lane] = {};
    for (const [step, count] of Object.entries(laneRolls)) {
      const s = Number(step);
      if (s >= offset && s < offset + perBar) rolls[lane][s - offset] = count;
    }
  }
  return {
    steps,
    rolls,
    velocity,
    nudge,
    chokeGroups: pattern.chokeGroups || { openhat: 1, hat: 1 }
  };
}

function chordAtLocal(progression, localBar, localStep, meter) {
  const bars = Array.isArray(progression?.bars) && progression.bars.length
    ? progression.bars
    : ['Am7'];
  const perBar = stepsPerBar(meter);
  // Absolute step within the multi-bar chord pattern
  const absStep = localBar * perBar + localStep;
  // Each chord symbol covers one pulse (4 sixteenths in 4/4, 6 in 6/8)
  const pulse = pulseSteps(meter);
  return bars[Math.floor(absStep / pulse) % bars.length];
}

/**
 * Resolve everything sounding at an integer song bar (and optional local step for chords).
 * When songMode is false, callers should pass working-state fields instead.
 *
 * Gap rule: if a track has no covering clip in song mode, that track is silent (empty).
 * Overlap rule: topmost clip (latest start) wins via clipAtBar / pickTopClip.
 */
export function resolveArrangementAtBar({
  songMode,
  playlist,
  patterns,
  sections,
  songBar,
  localStep = 0,
  meter = '4/4',
  // Working fallbacks for loop mode
  working = {}
}) {
  const sectionIndex = songMode ? sectionIndexAtBar(sections, songBar) : -1;
  const section = sectionIndex >= 0 ? sections[sectionIndex] : null;
  const active = {
    keys: !songMode || section?.active?.keys !== false,
    drums: !songMode || section?.active?.drums !== false,
    chords: !songMode || section?.active?.chords !== false,
    vocals: !songMode || section?.active?.vocals !== false
  };

  const defaultDrums = ['kick', 'snare', 'clap', 'hat', 'openhat', 'bass'];
  const workingLanes = [...new Set([...defaultDrums, ...Object.keys(working.drums || {}), ...Object.keys(working.drumVelocity || {})])];

  const result = {
    sectionIndex,
    section,
    active,
    melodyNotes: [],
    drums: Object.fromEntries(workingLanes.map(l => [l, []])),
    drumRolls: {},
    drumVelocity: structuredClone(working.drumVelocity || working.velocity || {}),
    drumNudge: structuredClone(working.drumNudge || working.nudge || {}),
    chokeGroups: structuredClone(working.chokeGroups || { openhat: 1, hat: 1 }),
    chordSymbol: 'Am7',
    chordProgression: working.chords || { bars: ['Am7'] },
    vocalClip: null,
    gain: { keys: 1, drums: 1, chords: 1, vocals: 1 },
    // true when song-mode gap (no clip) - must stay silent
    gap: { keys: false, drums: false, chords: false, vocals: false },
    extraTrackNotes: {}
  };

  if (!songMode || !playlist) {
    result.melodyNotes = working.pattern || [];
    result.drums = Object.fromEntries(
      workingLanes.map(lane => [
        lane,
        [...(working.drums?.[lane] instanceof Set ? working.drums[lane] : working.drums?.[lane] || [])]
      ])
    );
    result.drumRolls = working.drumRolls || {};
    result.chordProgression = working.chords || { bars: ['Am7'] };
    result.chordSymbol = chordAtLocal(result.chordProgression, 0, localStep, meter);
    result.extraTrackNotes = {
      bass: working.bassPattern || []
    };
    return result;
  }

  const keyRes = resolveTrackPattern(playlist, patterns, 'keys', 'melody', songBar);
  const drumRes = resolveTrackPattern(playlist, patterns, 'drums', 'drums', songBar);
  const chordRes = resolveTrackPattern(playlist, patterns, 'chords', 'chords', songBar);
  const vocalClip = pickTopClip(trackClips(playlist, 'vocals'), songBar);

  if (keyRes) {
    result.melodyNotes = patternNotesForBar(keyRes.pattern, keyRes.localBar, meter);
    result.gain.keys = keyRes.gain;
  } else {
    result.gap.keys = true;
    result.melodyNotes = [];
  }

  if (drumRes) {
    const hits = drumHitsForBar(drumRes.pattern, drumRes.localBar, meter);
    result.drums = hits.steps;
    result.drumRolls = hits.rolls;
    result.drumVelocity = hits.velocity;
    result.drumNudge = hits.nudge;
    result.chokeGroups = hits.chokeGroups;
    result.gain.drums = drumRes.gain;
  } else {
    result.gap.drums = true;
  }

  if (chordRes) {
    result.chordProgression = chordRes.pattern.progression;
    result.chordSymbol = chordAtLocal(chordRes.pattern.progression, chordRes.localBar, localStep, meter);
    result.gain.chords = chordRes.gain;
  } else {
    result.gap.chords = true;
    result.chordSymbol = null;
  }

  if (vocalClip) {
    result.vocalClip = vocalClip;
    result.gain.vocals = automationGainAtFractional(vocalClip, songBar);
  } else {
    result.gap.vocals = true;
  }

  if (playlist?.tracks) {
    for (const track of playlist.tracks) {
      if (['keys', 'drums', 'chords', 'vocals'].includes(track.id)) continue;
      const kind = track.kind === 'bass' ? 'bass' : (track.kind === 'drums' ? 'drums' : 'melody');
      const trkRes = resolveTrackPattern(playlist, patterns, track.id, kind, songBar);
      if (trkRes) {
        result.extraTrackNotes[track.id] = patternNotesForBar(trkRes.pattern, trkRes.localBar, meter);
        result.gain[track.id] = trkRes.gain;
      }
    }
  }

  return result;
}

export function resolveTrackPattern(playlist, patterns, trackId, kind, songBar) {
  const clip = pickTopClip(trackClips(playlist, trackId), songBar);
  if (!clip?.patternId) return null;
  const pattern = findPattern(patterns, kind, clip.patternId);
  if (!pattern) return null;
  const localBar = (songBar - clip.startBar) % Math.max(1, pattern.bars || 1);
  return {
    pattern,
    localBar,
    clip,
    gain: automationGainAtFractional(clip, songBar)
  };
}

/**
 * Merge a freshly rebuilt section playlist with the previous one so that
 * intentional clip positions, trims, gain, and automation survive section edits
 * when the same pattern/take still occupies the same section span.
 */
export function mergePlaylistPreservingEdits(previous, next) {
  if (!previous?.tracks) return next;
  const merged = structuredClone(next);
  for (const track of merged.tracks) {
    const prevTrack = previous.tracks.find(item => item.id === track.id);
    if (!prevTrack?.clips?.length) continue;
    track.clips = track.clips.map(clip => {
      const match = prevTrack.clips.find(old =>
        clipIdentity(old) === clipIdentity(clip)
        && old.startBar === clip.startBar
        && old.lengthBars === clip.lengthBars
      ) || prevTrack.clips.find(old =>
        clipIdentity(old) === clipIdentity(clip)
        && rangesOverlap(old, clip)
      );
      if (!match) return clip;
      return {
        ...clip,
        id: match.id,
        // Keep intentional placement when the user moved the clip
        startBar: match.startBar,
        lengthBars: match.lengthBars,
        gain: match.gain,
        automation: match.automation ? structuredClone(match.automation) : [],
        takeStart: match.takeStart !== undefined ? match.takeStart : clip.takeStart,
        takeEnd: match.takeEnd !== undefined ? match.takeEnd : clip.takeEnd
      };
    });
    // Also keep orphaned manual clips that still reference valid pattern/takes
    // and aren't covered by a new section-built clip of the same identity+range
    for (const old of prevTrack.clips) {
      const covered = track.clips.some(clip =>
        clipIdentity(clip) === clipIdentity(old)
        && rangesOverlap(clip, old)
      );
      if (!covered && clipIdentity(old)) {
        track.clips.push(structuredClone(old));
      }
    }
  }
  return merged;
}

function clipIdentity(clip) {
  return clip?.patternId ? `p:${clip.patternId}` : clip?.audioTakeId ? `a:${clip.audioTakeId}` : '';
}

function rangesOverlap(a, b) {
  const aEnd = a.startBar + a.lengthBars;
  const bEnd = b.startBar + b.lengthBars;
  return a.startBar < bEnd && b.startBar < aEnd;
}

export function songLengthBars(sections, songMode, fallback = 4) {
  if (songMode && sections?.length) return Math.max(1, totalSongBars(sections));
  return fallback;
}

export { automationGainAt, clipAtBar, totalSongBars };
