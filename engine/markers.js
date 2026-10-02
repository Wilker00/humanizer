// FL Studio Time Markers System - Zero Emojis
// Supports timeline flags for Intro, Verse, Hook, Drop, Bridge, and Outro.
// Click flag to jump playhead; drag to reposition.

export function createTimelineMarker({ id = null, name = 'Marker', bar = 1, color = '#38bdf8' } = {}) {
  return {
    id: id || `tm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: String(name || 'Marker').trim(),
    bar: Math.max(1, Number(bar) || 1),
    color: color || '#38bdf8'
  };
}

export function defaultTimelineMarkers() {
  return [
    createTimelineMarker({ name: 'Intro', bar: 1, color: '#38bdf8' }),
    createTimelineMarker({ name: 'Drop', bar: 9, color: '#f43f5e' }),
    createTimelineMarker({ name: 'Outro', bar: 17, color: '#a855f7' })
  ];
}
