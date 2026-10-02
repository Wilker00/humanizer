/**
 * Export and Audio Analysis Tools
 * Handles stem resolution, true-peak calculation, MIDI track extraction,
 * chord editing, and selection helpers for BMAI music-making features.
 */

import { stepsPerBar, pulseSteps, beatsPerBar } from './arrangement-engine.js';
import { findPattern } from './daw-bridge.js';

/**
 * Calculates sample peak and 4x oversampled true-peak estimate using
 * cubic Hermite spline interpolation between samples (ITU-R BS.1770 / EBU R128 principle).
 *
 * @param {Float32Array} left
 * @param {Float32Array} [right]
 * @returns {{ samplePeakLinear: number, samplePeakDb: number, truePeakLinear: number, truePeakDb: number, isClipping: boolean }}
 */
export function calculateAudioPeaks(left, right = null) {
  if (!left || left.length === 0) {
    return { samplePeakLinear: 0, samplePeakDb: -Infinity, truePeakLinear: 0, truePeakDb: -Infinity, isClipping: false };
  }

  let samplePeak = 0;
  let truePeak = 0;

  const channels = right ? [left, right] : [left];

  for (const data of channels) {
    const len = data.length;
    for (let i = 0; i < len; i++) {
      const v = Math.abs(data[i]);
      if (v > samplePeak) samplePeak = v;

      // 4x oversample estimate via Hermite spline between samples
      if (i > 0 && i < len - 2) {
        const y0 = data[i - 1];
        const y1 = data[i];
        const y2 = data[i + 1];
        const y3 = data[i + 2];

        // Evaluate at 0.25, 0.5, 0.75 fractional points
        for (const t of [0.25, 0.5, 0.75]) {
          const c0 = y1;
          const c1 = 0.5 * (y2 - y0);
          const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
          const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
          const interp = Math.abs(((c3 * t + c2) * t + c1) * t + c0);
          if (interp > truePeak) truePeak = interp;
        }
      }
    }
  }

  if (samplePeak > truePeak) truePeak = samplePeak;

  const samplePeakDb = samplePeak > 0 ? 20 * Math.log10(samplePeak) : -120;
  const truePeakDb = truePeak > 0 ? 20 * Math.log10(truePeak) : -120;
  const isClipping = truePeakDb > -0.01;

  return {
    samplePeakLinear: Number(samplePeak.toFixed(5)),
    samplePeakDb: Number(samplePeakDb.toFixed(2)),
    truePeakLinear: Number(truePeak.toFixed(5)),
    truePeakDb: Number(truePeakDb.toFixed(2)),
    isClipping
  };
}

/**
 * Resolves all exportable stems for a project, covering both core tracks
 * and any user-created custom tracks (lead, bass, pad, audio).
 *
 * @param {Array<Object>} trackList
 * @param {Object} projectState
 * @returns {Array<{ id: string, name: string, kind: string }>}
 */
export function resolveStemTracks(trackList = [], projectState = {}) {
  const result = [];
  const tracks = trackList.length ? trackList : (projectState.tracks || []);
  const playlist = projectState.playlist;

  for (const track of tracks) {
    let hasAudio = false;
    if (track.id === 'drums' && (projectState.drumsAdded || Object.values(projectState.drums || {}).some(s => s && (s.size || s.length)))) {
      hasAudio = true;
    } else if (track.id === 'keys' && (projectState.melodyAdded || projectState.pattern?.length)) {
      hasAudio = true;
    } else if (track.id === 'chords' && projectState.chordAdded) {
      hasAudio = true;
    } else if (track.id === 'vocals' && (projectState.vocalAdded || projectState.vocals?.url)) {
      hasAudio = true;
    } else {
      // Check playlist clips on this track
      const clips = playlist?.tracks?.find(t => t.id === track.id)?.clips;
      if (clips && clips.length > 0) {
        hasAudio = true;
      } else if (track.kind === 'bass' && (projectState.bassPattern?.length || projectState.patterns?.bass?.some(p => p.notes?.length))) {
        hasAudio = true;
      }
    }

    if (hasAudio) {
      result.push({
        id: track.id,
        name: track.name || track.id,
        kind: track.kind || 'melody'
      });
    }
  }

  return result;
}

/**
 * Box-selects notes intersecting a step and pitch coordinate range.
 *
 * @param {Array<{ n: string, x: number, w: number, v?: number }>} notes
 * @param {number} minStep
 * @param {number} maxStep
 * @param {Array<string>} allPitchNotes
 * @param {number} minPitchIndex
 * @param {number} maxPitchIndex
 * @returns {Array<number>} Note indices that intersect the box
 */
export function boxSelectNotes(notes = [], minStep, maxStep, allPitchNotes, minPitchIndex, maxPitchIndex) {
  const selected = [];
  const s0 = Math.min(minStep, maxStep);
  const s1 = Math.max(minStep, maxStep);
  const p0 = Math.min(minPitchIndex, maxPitchIndex);
  const p1 = Math.max(minPitchIndex, maxPitchIndex);

  notes.forEach((note, idx) => {
    const pitchIdx = allPitchNotes.indexOf(note.n);
    if (pitchIdx < 0) return;
    const noteStart = note.x;
    const noteEnd = note.x + (note.w || 1);

    const pitchInRange = pitchIdx >= p0 && pitchIdx <= p1;
    const timeOverlap = noteStart < s1 && noteEnd > s0;

    if (pitchInRange && timeOverlap) {
      selected.push(idx);
    }
  });

  return selected;
}

/**
 * Reorders chord progression symbols.
 *
 * @param {Object} chordObj - e.g. state.chords
 * @param {number} fromIndex
 * @param {number} toIndex
 * @returns {Object} cloned and reordered chord progression
 */
export function reorderChords(chordObj, fromIndex, toIndex) {
  if (!chordObj || !Array.isArray(chordObj.bars)) return chordObj;
  const bars = [...chordObj.bars];
  const durations = Array.isArray(chordObj.durations) ? [...chordObj.durations] : bars.map(() => 1);

  if (fromIndex < 0 || fromIndex >= bars.length || toIndex < 0 || toIndex >= bars.length) {
    return chordObj;
  }

  const [movedBar] = bars.splice(fromIndex, 1);
  const [movedDur] = durations.splice(fromIndex, 1);
  bars.splice(toIndex, 0, movedBar);
  durations.splice(toIndex, 0, movedDur);

  return {
    ...chordObj,
    bars,
    durations
  };
}

/**
 * Updates the duration (in bars or fractions) for a chord in a progression.
 *
 * @param {Object} chordObj
 * @param {number} index
 * @param {number} durationBars
 * @returns {Object} updated progression
 */
export function setChordDuration(chordObj, index, durationBars) {
  if (!chordObj || !Array.isArray(chordObj.bars)) return chordObj;
  const bars = [...chordObj.bars];
  const durations = Array.isArray(chordObj.durations) ? [...chordObj.durations] : bars.map(() => 1);

  if (index >= 0 && index < bars.length) {
    durations[index] = Math.max(0.25, Math.min(8, Number(durationBars) || 1));
  }

  return {
    ...chordObj,
    bars,
    durations
  };
}

/**
 * Arms a track for recording, optionally disarming others if exclusive.
 *
 * @param {Array<Object>} trackList
 * @param {string} trackId
 * @param {boolean} [exclusive=true]
 * @returns {Array<Object>}
 */
export function setTrackArmed(trackList = [], trackId, exclusive = true) {
  return trackList.map(track => ({
    ...track,
    armed: track.id === trackId ? !track.armed : (exclusive ? false : !!track.armed)
  }));
}

// ---------------------------------------------------------------------------
// Offline ZIP Archiver (Pure JavaScript, Zero External Dependencies)
// ---------------------------------------------------------------------------

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function computeCrc32(uint8Array) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < uint8Array.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ uint8Array[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Creates an uncompressed (Store method) ZIP archive from a list of files.
 * Compatible with Windows Explorer, macOS Archive Utility, 7-Zip, and Linux unzip.
 *
 * @param {Array<{ name: string, data: Uint8Array|ArrayBuffer|string }>} files
 * @returns {Uint8Array} Binary ZIP archive
 */
export function createZipArchive(files = []) {
  const encoder = new TextEncoder();
  const fileEntries = files.map(file => {
    let rawData;
    if (typeof file.data === 'string') {
      rawData = encoder.encode(file.data);
    } else if (file.data instanceof Uint8Array) {
      rawData = file.data;
    } else if (file.data instanceof ArrayBuffer) {
      rawData = new Uint8Array(file.data);
    } else {
      rawData = new Uint8Array(0);
    }
    const nameBytes = encoder.encode(file.name || 'file.txt');
    const crc = computeCrc32(rawData);
    return {
      nameBytes,
      data: rawData,
      crc,
      size: rawData.length
    };
  });

  // Calculate DOS time (fixed stable timestamp: 2026-09-24 12:00:00)
  const dosTime = (12 << 11) | (0 << 5) | (0 >> 1);
  const dosDate = ((2026 - 1980) << 9) | (9 << 5) | 24;

  let offset = 0;
  const localHeaders = [];
  const cdHeaders = [];

  for (const entry of fileEntries) {
    // Local File Header
    const localBuf = new Uint8Array(30 + entry.nameBytes.length);
    const lv = new DataView(localBuf.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // Version 2.0
    lv.setUint16(6, 0, true);  // Flags
    lv.setUint16(8, 0, true);  // Compression 0 = Store
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, entry.crc, true);
    lv.setUint32(18, entry.size, true); // Compressed size
    lv.setUint32(22, entry.size, true); // Uncompressed size
    lv.setUint16(26, entry.nameBytes.length, true);
    lv.setUint16(28, 0, true); // Extra length
    localBuf.set(entry.nameBytes, 30);

    localHeaders.push({ header: localBuf, data: entry.data });

    // Central Directory Header
    const cdBuf = new Uint8Array(46 + entry.nameBytes.length);
    const cdv = new DataView(cdBuf.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 0x0314, true); // Made by UNIX / DOS 2.0
    cdv.setUint16(6, 20, true);     // Version needed
    cdv.setUint16(8, 0, true);
    cdv.setUint16(10, 0, true);
    cdv.setUint16(12, dosTime, true);
    cdv.setUint16(14, dosDate, true);
    cdv.setUint32(16, entry.crc, true);
    cdv.setUint32(20, entry.size, true);
    cdv.setUint32(24, entry.size, true);
    cdv.setUint16(28, entry.nameBytes.length, true);
    cdv.setUint16(30, 0, true); // Extra
    cdv.setUint16(32, 0, true); // Comment
    cdv.setUint16(34, 0, true); // Disk start
    cdv.setUint16(36, 0, true); // Internal attr
    cdv.setUint32(38, 0x81a40000, true); // External attr (-rw-r--r--)
    cdv.setUint32(42, offset, true);     // Relative offset
    cdBuf.set(entry.nameBytes, 46);

    cdHeaders.push(cdBuf);

    offset += localBuf.length + entry.data.length;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const c of cdHeaders) cdSize += c.length;

  // End of Central Directory
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true); // Disk number
  ev.setUint16(6, 0, true); // Start disk
  ev.setUint16(8, fileEntries.length, true); // Records on disk
  ev.setUint16(10, fileEntries.length, true); // Total records
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdOffset, true);
  ev.setUint16(20, 0, true); // Comment length

  const totalLength = cdOffset + cdSize + 22;
  const result = new Uint8Array(totalLength);

  let pos = 0;
  for (const item of localHeaders) {
    result.set(item.header, pos);
    pos += item.header.length;
    result.set(item.data, pos);
    pos += item.data.length;
  }
  for (const cd of cdHeaders) {
    result.set(cd, pos);
    pos += cd.length;
  }
  result.set(eocd, pos);

  return result;
}

/**
 * Formats a pitch-deck / demo blurb for clipboard sharing.
 *
 * @param {Object} project
 * @returns {string}
 */
export function generateDemoBlurb(project = {}) {
  const name = project.name || 'Untitled Track';
  const bpm = project.bpm || 92;
  const key = project.key || 'A minor';
  const meter = project.meter || '4/4';
  const chords = Array.isArray(project.chords?.bars) ? project.chords.bars.join(' · ') : 'Am7 · Dm7';
  const sections = Array.isArray(project.sections) && project.sections.length
    ? project.sections.map(s => `${s.name} (${s.bars}b)`).join(' → ')
    : 'Loop (4b)';
  const tracks = (project.tracks || []).map(t => t.name || t.id).join(', ') || 'Lead, Drums, Chords, Bass';

  return `Project: ${name}\n` +
    `Tempo: ${bpm} BPM | ${key} | ${meter}\n` +
    `Chords: ${chords}\n` +
    `Tracks: ${tracks}\n` +
    `Arrangement: ${sections}\n` +
    `Created with BMAI Studio (https://bmai.app)`;
}

/**
 * Generates a clean text README for the exported offline share pack.
 *
 * @param {Object} project
 * @returns {string}
 */
export function sharePackStemName(projectName, trackId) {
  const safe = String(projectName || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
  const id = String(trackId || 'track').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'track';
  return `stems/${safe}-${id}.wav`;
}

export function generateSharePackReadme(project = {}, { stemNames = [] } = {}) {
  const name = project.name || 'BMAI Project';
  const bpm = project.bpm || 92;
  const key = project.key || 'A minor';
  const meter = project.meter || '4/4';
  const date = new Date().toISOString().slice(0, 10);
  const safe = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const sections = Array.isArray(project.sections) && project.sections.length
    ? project.sections.map((s, i) => `  ${i + 1}. ${s.name} — ${s.bars} bars (active: ${Object.entries(s.active || {}).filter(([, v]) => v).map(([k]) => k).join(', ')})`).join('\n')
    : '  1. Loop — 4 bars';
  const markers = Array.isArray(project.proSession?.markers) && project.proSession.markers.length
    ? project.proSession.markers.map(marker => `  bar ${Math.floor(Number(marker.bar) || 0) + 1}: ${marker.name || 'Marker'}`).join('\n')
    : '  (none)';
  const stemList = stemNames.length
    ? stemNames.map(file => `   ${file}`).join('\n')
    : '   (no separate stems in this pack)';

  return `======================================================================
BMAI Guided Studio — Audio & Project Share Pack
======================================================================
Project Title:   ${name}
Tempo:           ${bpm} BPM
Key Signature:   ${key}
Time Signature:  ${meter}
Export Date:     ${date}
Engine:          BMAI Schema v3 / Offline Web Audio

FILES INCLUDED IN THIS ARCHIVE:
----------------------------------------------------------------------
1. ${safe}-master.wav
   Stereo 16-bit 44.1 kHz WAV master mixdown.
   Insert EQ, filter, compression, saturation, chorus, and utility
   are printed into this file and into the stems.

2. ${safe}.json
   Portable BMAI project: tracks, patterns, notes, automation, mix.

3. metadata.json
   Tempo, key, meter, section lengths, and markers.

4. stems/
${stemList}
   Each stem is the same bar range and start point as the master.

5. README.txt
   This session documentation.

SONG ARRANGEMENT STRUCTURE:
----------------------------------------------------------------------
${sections}

MARKERS:
----------------------------------------------------------------------
${markers}

HOW TO REOPEN IN BMAI:
----------------------------------------------------------------------
1. Open BMAI in any modern browser (Chrome, Edge, Safari, Firefox).
2. Go to Studio Home > Saved Projects > Import (.json).
3. Select "${safe}.json".

OPEN IN ABLETON, FL STUDIO, OR LOGIC:
----------------------------------------------------------------------
1. Create a session at ${bpm} BPM, ${meter}, in ${key}.
2. Import every file in stems/ onto its own audio track.
3. Place every stem at bar 1 so they stay aligned with the master.
4. Markers above are 1-based bar positions from metadata.json.
5. Stems already follow the project tempo when a clip warp is beats or tones.
   Pitch correction and custom sidechain routes in the JSON are handoff
   notes only. The kick-duck sidechain is already in the audio.
======================================================================
`;
}

