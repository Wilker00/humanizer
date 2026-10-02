// FL Studio Automation Clip Engine & Vector Spline Renderer
// Supports multi-point bezier/tension curves, tension handles,
// right-click/menu "Create Automation Clip", and audio parameter modulation.

export function createAutomationClip({
  id = null,
  target = 'master.vol',
  targetLabel = 'Master Volume Automation',
  startBar = 0,
  lengthBars = 4,
  points = null
} = {}) {
  return {
    id: id || `auto-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    target,
    targetLabel,
    startBar: Math.max(0, Number(startBar) || 0),
    lengthBars: Math.max(1, Number(lengthBars) || 4),
    // Normalized 0.0 to 1.0 points: { x: fractional position 0..1, y: normalized value 0..1, tension: -1..1 }
    points: points || [
      { x: 0, y: 0.2, tension: 0 },
      { x: 0.5, y: 0.8, tension: 0.5 },
      { x: 1, y: 1.0, tension: -0.3 }
    ]
  };
}

export function evaluateAutomationAt(clip, fraction) {
  if (!clip || !clip.points || !clip.points.length) return 1.0;
  const f = Math.max(0, Math.min(1, fraction));
  const pts = [...clip.points].sort((a, b) => a.x - b.x);
  if (f <= pts[0].x) return pts[0].y;
  if (f >= pts[pts.length - 1].x) return pts[pts.length - 1].y;

  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    if (f >= p0.x && f <= p1.x) {
      const span = p1.x - p0.x;
      if (span <= 0) return p0.y;
      const t = (f - p0.x) / span;
      const tension = p0.tension || 0;
      let curvedT = t;
      if (Math.abs(tension) > 0.01) {
        // FL Studio tension interpolation formula
        curvedT = (Math.exp(tension * 3 * t) - 1) / (Math.exp(tension * 3) - 1);
        if (!Number.isFinite(curvedT)) curvedT = t;
      }
      return p0.y + (p1.y - p0.y) * curvedT;
    }
  }
  return pts[pts.length - 1].y;
}

// Insert a new automation point at fractional position x with value y
export function insertAutomationPoint(clip, x, y, tension = 0) {
  if (!clip || !clip.points) return clip;
  const clampX = Math.max(0, Math.min(1, x));
  const clampY = Math.max(0, Math.min(1, y));
  const clampT = Math.max(-1, Math.min(1, tension));
  clip.points.push({ x: clampX, y: clampY, tension: clampT });
  clip.points.sort((a, b) => a.x - b.x);
  return clip;
}

// Remove an automation point by index (keeps at least 2 endpoints)
export function removeAutomationPoint(clip, pointIndex) {
  if (!clip || !clip.points || clip.points.length <= 2) return clip;
  if (pointIndex < 0 || pointIndex >= clip.points.length) return clip;
  clip.points.splice(pointIndex, 1);
  return clip;
}

// Update tension value on a specific point
export function setAutomationTension(clip, pointIndex, tension) {
  if (!clip || !clip.points || !clip.points[pointIndex]) return clip;
  clip.points[pointIndex].tension = Math.max(-1, Math.min(1, tension));
  return clip;
}

// Audio Clip Crossfade Calculator
// When two audio clips overlap on the same playlist track, compute gain envelopes
// for smooth de-click crossfading.
export function computeClipCrossfade(clipA, clipB, crossfadeLength = 0.25) {
  if (!clipA || !clipB) return { clipAFade: null, clipBFade: null };

  const aStart = clipA.startBar ?? 0;
  const aEnd = aStart + (clipA.lengthBars ?? 1);
  const bStart = clipB.startBar ?? 0;
  const bEnd = bStart + (clipB.lengthBars ?? 1);

  // Check for overlap
  const overlapStart = Math.max(aStart, bStart);
  const overlapEnd = Math.min(aEnd, bEnd);

  if (overlapStart >= overlapEnd) {
    return { clipAFade: null, clipBFade: null, overlapBars: 0 };
  }

  const overlapBars = overlapEnd - overlapStart;
  const fadeBars = Math.min(crossfadeLength, overlapBars);

  // Clip A fades out over the overlap region
  const clipAFade = {
    clipId: clipA.id,
    fadeOutStart: overlapStart,
    fadeOutEnd: overlapStart + fadeBars,
    type: 'fadeOut'
  };

  // Clip B fades in over the overlap region
  const clipBFade = {
    clipId: clipB.id,
    fadeInStart: overlapStart,
    fadeInEnd: overlapStart + fadeBars,
    type: 'fadeIn'
  };

  return { clipAFade, clipBFade, overlapBars };
}

// Evaluate crossfade gain at a given bar position
export function crossfadeGainAt(bar, fade) {
  if (!fade) return 1.0;
  if (fade.type === 'fadeOut') {
    if (bar <= fade.fadeOutStart) return 1.0;
    if (bar >= fade.fadeOutEnd) return 0.0;
    const t = (bar - fade.fadeOutStart) / (fade.fadeOutEnd - fade.fadeOutStart);
    // Equal-power crossfade curve
    return Math.cos(t * Math.PI * 0.5);
  }
  if (fade.type === 'fadeIn') {
    if (bar <= fade.fadeInStart) return 0.0;
    if (bar >= fade.fadeInEnd) return 1.0;
    const t = (bar - fade.fadeInStart) / (fade.fadeInEnd - fade.fadeInStart);
    return Math.sin(t * Math.PI * 0.5);
  }
  return 1.0;
}
