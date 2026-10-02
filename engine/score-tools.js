// FL Studio Score Tools (Zero Emojis)
// Features Piano Roll Strummer (Alt+S), Chopper (Alt+U), Randomizer (Alt+R), and Flam (Alt+F).

const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function parsePitchToMidi(pitch) {
  if (typeof pitch !== 'string') return 60;
  const match = pitch.trim().match(/^([A-Ga-g])([#b]?)(-?\d+)$/);
  if (!match) return 60;
  let [, letter, accidental, octaveStr] = match;
  letter = letter.toUpperCase();
  const octave = parseInt(octaveStr, 10);
  let semitone = PITCH_CLASSES.indexOf(letter);
  if (accidental === '#') semitone = (semitone + 1) % 12;
  else if (accidental === 'b') semitone = (semitone + 11) % 12;
  return (octave + 1) * 12 + semitone;
}

export function midiToPitch(midi) {
  const safeMidi = Math.max(0, Math.min(127, Math.round(midi)));
  const octave = Math.floor(safeMidi / 12) - 1;
  const semitone = safeMidi % 12;
  return `${PITCH_CLASSES[semitone]}${octave}`;
}

export function flStrumNotes(notes = [], { startOffset = 0.1, stroke = 'up', tension = 0, preserveEnd = false } = {}) {
  if (!Array.isArray(notes) || notes.length <= 1) return notes.map(n => ({ ...n }));

  // Sort notes by pitch
  const sorted = [...notes].sort((a, b) => {
    const midiA = parsePitchToMidi(a.n);
    const midiB = parsePitchToMidi(b.n);
    return stroke === 'down' ? midiB - midiA : midiA - midiB;
  });

  const baseStart = Math.min(...notes.map(n => n.x ?? 0));
  const baseEnd = Math.max(...notes.map(n => (n.x ?? 0) + (n.w ?? 1)));
  const count = sorted.length;

  return sorted.map((note, index) => {
    let t = count > 1 ? index / (count - 1) : 0;
    if (tension !== 0) {
      t = tension > 0 ? Math.pow(t, 1 + tension * 2) : 1 - Math.pow(1 - t, 1 - tension * 2);
    }
    const offset = index * startOffset;
    const newX = baseStart + offset;
    let newW = note.w ?? 1;
    if (preserveEnd) {
      newW = Math.max(0.125, baseEnd - newX);
    }
    return {
      ...note,
      x: Math.round(newX * 1000) / 1000,
      w: Math.round(newW * 1000) / 1000
    };
  });
}

export function flChopNotes(notes = [], { division = '1/16', pattern = 'straight', gate = 0.85, divisions = null } = {}) {
  if (!Array.isArray(notes)) return [];

  // Determine slice step width in 16th grid units
  let stepWidth = 1.0;
  if (divisions) {
    // If explicit division count passed
    stepWidth = null;
  } else if (division === '1/32') {
    stepWidth = 0.5;
  } else if (division === '1/16') {
    stepWidth = 1.0;
  } else if (division === '1/8') {
    stepWidth = 2.0;
  } else if (division === '1/4') {
    stepWidth = 4.0;
  }

  const result = [];

  for (const note of notes) {
    const origW = note.w ?? 1;
    const origX = note.x ?? 0;
    const count = stepWidth ? Math.max(1, Math.round(origW / stepWidth)) : Math.max(1, Math.round(divisions || 4));
    const sliceLen = stepWidth ? stepWidth : origW / count;
    const activeW = Math.round(sliceLen * (gate ?? 1.0) * 1000) / 1000;

    for (let i = 0; i < count; i++) {
      let pitch = note.n;
      if (pattern === 'arpeggio-up') {
        const rootMidi = parsePitchToMidi(note.n);
        const arpIntervals = [0, 3, 7, 10, 12, 15, 19, 22];
        pitch = midiToPitch(rootMidi + arpIntervals[i % arpIntervals.length]);
      } else if (pattern === 'arpeggio-down') {
        const rootMidi = parsePitchToMidi(note.n);
        const arpIntervals = [12, 10, 7, 3, 0];
        pitch = midiToPitch(rootMidi + arpIntervals[i % arpIntervals.length]);
      }

      result.push({
        ...note,
        id: `${note.id || 'chop'}-${i}-${Math.random().toString(36).slice(2, 5)}`,
        n: pitch,
        x: Math.round((origX + i * sliceLen) * 1000) / 1000,
        w: activeW
      });
    }
  }

  return result;
}

export function flRandomizeNotes(notes = [], { velAmount = 0.2, timeNudge = 0.05, pitchAmount = 0, velRange = null, timeRange = null, pitchRange = null } = {}) {
  if (!Array.isArray(notes)) return [];
  const vAmt = velRange !== null ? velRange : velAmount;
  const tAmt = timeRange !== null ? timeRange : timeNudge;
  const pAmt = pitchRange !== null ? pitchRange : pitchAmount;

  return notes.map(note => {
    let newV = note.v ?? 0.8;
    if (vAmt > 0) {
      newV = Math.max(0.1, Math.min(1.0, newV + (Math.random() * 2 - 1) * vAmt));
    }
    let newX = note.x ?? 0;
    if (tAmt > 0) {
      newX = Math.max(0, newX + (Math.random() * 2 - 1) * tAmt);
    }
    let newN = note.n;
    if (pAmt > 0) {
      const shift = Math.round((Math.random() * 2 - 1) * pAmt);
      const midi = parsePitchToMidi(note.n);
      newN = midiToPitch(midi + shift);
    }
    return {
      ...note,
      n: newN,
      v: Math.round(newV * 100) / 100,
      x: Math.round(newX * 1000) / 1000
    };
  });
}

export function flFlamNotes(notes = [], { count = 3, flamTime = 0.05, decay = 0.6, timeGap = null, velocityMult = null } = {}) {
  if (!Array.isArray(notes)) return [];
  const totalHits = Math.max(2, Math.round(count || 3));
  const tGap = timeGap !== null ? timeGap : flamTime;
  const decayRate = velocityMult !== null ? velocityMult : decay;
  const result = [];

  for (const note of notes) {
    const origX = note.x ?? 0;
    const origV = note.v ?? 0.8;

    // Grace hits occurring prior to the main hit
    for (let i = 0; i < totalHits - 1; i++) {
      const stepsBefore = totalHits - 1 - i;
      const graceX = Math.max(0, origX - stepsBefore * tGap);
      const graceV = Math.max(0.05, origV * Math.pow(decayRate, stepsBefore));
      result.push({
        ...note,
        id: `${note.id || 'note'}-grace-${i}-${Math.random().toString(36).slice(2, 5)}`,
        x: Math.round(graceX * 1000) / 1000,
        v: Math.round(graceV * 100) / 100,
        w: Math.min(note.w ?? 0.5, Math.max(0.125, tGap))
      });
    }

    // Primary hit
    result.push({
      ...note
    });
  }

  return result;
}

export function flFlipNotes(notes = [], { direction = 'horizontal', anchorPitch = null } = {}) {
  if (!Array.isArray(notes) || notes.length === 0) return [];

  if (direction === 'horizontal') {
    const minX = Math.min(...notes.map(n => n.x ?? 0));
    const maxX = Math.max(...notes.map(n => (n.x ?? 0) + (n.w ?? 1)));
    return notes.map(n => {
      const origX = n.x ?? 0;
      const origW = n.w ?? 1;
      const newX = minX + (maxX - (origX + origW));
      return {
        ...n,
        x: Math.round(newX * 1000) / 1000
      };
    });
  }

  // Vertical Pitch Inversion
  const midis = notes.map(n => parsePitchToMidi(n.n));
  const pivotMidi = anchorPitch ? parsePitchToMidi(anchorPitch) : Math.round((Math.min(...midis) + Math.max(...midis)) / 2);

  return notes.map(n => {
    const origMidi = parsePitchToMidi(n.n);
    const invertedMidi = pivotMidi - (origMidi - pivotMidi);
    return {
      ...n,
      n: midiToPitch(invertedMidi)
    };
  });
}

// LFO Modulation Tool across notes
export function flLfoNotes(notes = [], { target = 'velocity', shape = 'sine', frequency = 1.0, depth = 0.3 } = {}) {
  if (!Array.isArray(notes) || notes.length === 0) return [];
  const minX = Math.min(...notes.map(n => n.x ?? 0));
  const span = Math.max(1, Math.max(...notes.map(n => (n.x ?? 0) + (n.w ?? 1))) - minX);

  return notes.map(n => {
    const progress = ((n.x ?? 0) - minX) / span;
    const phase = progress * frequency * 2 * Math.PI;
    let lfoVal = 0;

    if (shape === 'triangle') {
      lfoVal = 2 * Math.abs(2 * ((progress * frequency) % 1) - 1) - 1;
    } else if (shape === 'square') {
      lfoVal = Math.sin(phase) >= 0 ? 1 : -1;
    } else {
      lfoVal = Math.sin(phase); // default sine
    }

    if (target === 'pitch') {
      const origMidi = parsePitchToMidi(n.n);
      const shiftSemis = Math.round(lfoVal * depth * 12);
      return {
        ...n,
        n: midiToPitch(origMidi + shiftSemis)
      };
    }

    // Velocity target
    const origV = n.v ?? 0.8;
    const newV = Math.max(0.1, Math.min(1.0, origV + lfoVal * depth));
    return {
      ...n,
      v: Math.round(newV * 100) / 100
    };
  });
}

// Claw Machine Tool: Slice long chords into rhythmic groove steps
export function flClawNotes(notes = [], { stepLength = 1.0, gate = 0.75 } = {}) {
  if (!Array.isArray(notes)) return [];
  const result = [];

  for (const note of notes) {
    const origW = note.w ?? 1;
    const origX = note.x ?? 0;
    const count = Math.max(1, Math.floor(origW / stepLength));

    for (let i = 0; i < count; i++) {
      result.push({
        ...note,
        id: `${note.id || 'claw'}-${i}-${Math.random().toString(36).slice(2, 5)}`,
        x: Math.round((origX + i * stepLength) * 1000) / 1000,
        w: Math.round(stepLength * gate * 1000) / 1000
      });
    }
  }
  return result;
}
