/**
 * Mixing graph helpers: send buses, group buses, LUFS-ish metering,
 * cue/monitor, and reference blend state.
 */

export function defaultGroupBuses() {
  return {
    drums: { vol: 1, mute: false, fx: [] },
    music: { vol: 1, mute: false, fx: [] },
    vocals: { vol: 1, mute: false, fx: [] }
  };
}

export function normalizeGroupBuses(raw) {
  const base = defaultGroupBuses();
  if (!raw || typeof raw !== 'object') return base;
  for (const key of Object.keys(base)) {
    const src = raw[key] || {};
    base[key] = {
      mute: !!src.mute,
      vol: Math.max(0, Math.min(1.5, Number(src.vol) || 1)),
      fx: normalizePluginRack(src.fx)
    };
  }
  return base;
}

/** Map track id/kind → mix group. */
export function groupForTrack(trackId, trackMeta = null) {
  const kind = trackMeta?.kind || trackId;
  if (trackId === 'drums' || kind === 'drums') return 'drums';
  if (trackId === 'vocals' || kind === 'vocals' || kind === 'audio') return 'vocals';
  return 'music';
}

export function applyGroupVolume(baseVol, trackId, buses, trackMeta = null) {
  const group = groupForTrack(trackId, trackMeta);
  const bus = buses?.[group];
  if (!bus || bus.mute) return 0;
  return Math.max(0, Number(baseVol) || 0) * (Number(bus.vol) || 1);
}

export function defaultProSession() {
  return {
    latencyOffsetMs: 0,
    punchEnabled: false,
    punchInBar: 0,
    punchOutBar: null,
    cueMonitor: false,
    cueBlend: 0.5,
    cueMuteSpeakers: false,
    referenceUrl: null,
    referenceGain: 0.35,
    referenceMode: 'master',
    referenceDuck: 0.35,
    markers: [],
    lufsTarget: -14,
    delayReturn: 0.2,
    delayTime: 0.25,
    sidechains: [],
    midiLearn: [],
    scenes: [],
    publishChecklist: {
      masterNamed: false,
      stemsExported: false,
      sharePackTested: false,
      rightsChecked: false,
      browserLimitsRead: false
    }
  };
}

export function normalizeProSession(raw) {
  const base = defaultProSession();
  if (!raw || typeof raw !== 'object') return base;
  return {
    latencyOffsetMs: Math.max(-200, Math.min(200, Number(raw.latencyOffsetMs) || 0)),
    punchEnabled: !!raw.punchEnabled,
    punchInBar: Math.max(0, Number(raw.punchInBar) || 0),
    punchOutBar: raw.punchOutBar == null ? null : Math.max(0, Number(raw.punchOutBar)),
    cueMonitor: !!raw.cueMonitor,
    cueBlend: Math.max(0, Math.min(1, Number(raw.cueBlend) || 0.5)),
    cueMuteSpeakers: !!raw.cueMuteSpeakers,
    referenceUrl: typeof raw.referenceUrl === 'string' ? raw.referenceUrl : null,
    referenceGain: Math.max(0, Math.min(1, Number(raw.referenceGain) || 0.35)),
    referenceMode: raw.referenceMode === 'reference' ? 'reference' : raw.referenceMode === 'blend' ? 'blend' : 'master',
    referenceDuck: Math.max(0, Math.min(1, Number(raw.referenceDuck) || 0.35)),
    markers: Array.isArray(raw.markers)
      ? raw.markers
          .filter(m => m && typeof m === 'object')
          .slice(0, 64)
          .map(m => ({
            id: typeof m.id === 'string' ? m.id : `mk-${Math.random().toString(36).slice(2, 8)}`,
            bar: Math.max(0, Number(m.bar) || 0),
            name: String(m.name || 'Marker').slice(0, 32),
            color: typeof m.color === 'string' ? m.color : '#7dd3fc'
          }))
      : [],
    lufsTarget: Number(raw.lufsTarget) === -16 || Number(raw.lufsTarget) === -9 ? Number(raw.lufsTarget) : -14,
    delayReturn: Math.max(0, Math.min(1, Number(raw.delayReturn) || 0.2)),
    delayTime: Math.max(0.05, Math.min(1, Number(raw.delayTime) || 0.25)),
    sidechains: normalizeSidechains(raw.sidechains),
    midiLearn: normalizeMidiLearn(raw.midiLearn),
    scenes: normalizeScenes(raw.scenes),
    publishChecklist: normalizePublishChecklist(raw.publishChecklist)
  };
}

export function normalizePluginRack(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(fx => fx && typeof fx === 'object')
    .slice(0, 8)
    .map(fx => ({
      id: typeof fx.id === 'string' ? fx.id : `fx-${Math.random().toString(36).slice(2, 8)}`,
      type: ['eq', 'compress', 'saturator', 'chorus', 'filter', 'utility'].includes(fx.type) ? fx.type : 'eq',
      bypass: !!fx.bypass,
      preset: typeof fx.preset === 'string' ? fx.preset.slice(0, 32) : 'Default',
      params: objectParams(fx.params)
    }));
}

function normalizeSidechains(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(item => item && typeof item === 'object' && typeof item.sourceTrackId === 'string' && typeof item.targetTrackId === 'string')
    .slice(0, 64)
    .map(item => ({
      id: typeof item.id === 'string' ? item.id : `sc-${Math.random().toString(36).slice(2, 8)}`,
      sourceTrackId: item.sourceTrackId,
      targetTrackId: item.targetTrackId,
      amount: Math.max(0, Math.min(1, Number(item.amount) || 0.5)),
      attackMs: Math.max(1, Math.min(200, Number(item.attackMs) || 10)),
      releaseMs: Math.max(10, Math.min(1000, Number(item.releaseMs) || 180)),
      enabled: item.enabled !== false
    }));
}

function normalizeMidiLearn(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(item => item && typeof item === 'object' && typeof item.trackId === 'string')
    .slice(0, 128)
    .map(item => ({
      id: typeof item.id === 'string' ? item.id : `ml-${Math.random().toString(36).slice(2, 8)}`,
      trackId: item.trackId,
      target: ['vol', 'pan', 'send', 'delaySend', 'mute'].includes(item.target) ? item.target : 'vol',
      cc: item.cc == null ? null : Math.max(0, Math.min(127, Math.round(Number(item.cc) || 0))),
      note: item.note == null ? null : Math.max(0, Math.min(127, Math.round(Number(item.note) || 0))),
      channel: Math.max(1, Math.min(16, Math.round(Number(item.channel) || 1)))
    }));
}

function normalizeScenes(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(scene => scene && typeof scene === 'object')
    .slice(0, 32)
    .map((scene, index) => ({
      id: typeof scene.id === 'string' ? scene.id : `scene-${index + 1}`,
      name: String(scene.name || `Scene ${index + 1}`).slice(0, 32),
      sectionIndex: Math.max(0, Math.min(127, Math.round(Number(scene.sectionIndex) || 0)))
    }));
}

function normalizePublishChecklist(raw) {
  const base = defaultProSession().publishChecklist;
  if (!raw || typeof raw !== 'object') return base;
  return Object.fromEntries(Object.keys(base).map(key => [key, !!raw[key]]));
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

export function markerMetadata(markers = []) {
  return normalizeProSession({ markers }).markers.map(marker => ({
    bar: marker.bar,
    name: marker.name,
    color: marker.color
  }));
}

/**
 * Approximate integrated loudness (LUFS) using a simplified K-weighting
 * (high shelf + high-pass) + mean-square. Good enough for export feedback;
 * not a certified meter.
 */
export function estimateIntegratedLufs(left, right = null, sampleRate = 44100) {
  if (!left?.length) return { lufs: -70, suggestedGainDb: 0 };
  const channels = right ? [left, right] : [left];
  // Simplified K-weighting approximation: mild high-shelf emphasis + mean square
  let sum = 0;
  let count = 0;
  for (const data of channels) {
    let z1 = 0;
    for (let i = 0; i < data.length; i++) {
      const x = data[i];
      // one-pole high shelf-ish
      const y = x + 0.5 * (x - z1);
      z1 = x;
      sum += y * y;
      count += 1;
    }
  }
  const mean = count ? sum / count : 0;
  const lufs = mean > 1e-12 ? -0.691 + 10 * Math.log10(mean) : -70;
  const calibrated = Math.max(-70, Math.min(0, lufs));
  const target = -14;
  const suggestedGainDb = Math.max(-24, Math.min(24, target - calibrated));
  return {
    lufs: Number(calibrated.toFixed(1)),
    suggestedGainDb: Number(suggestedGainDb.toFixed(1)),
    sampleRate
  };
}

export function defaultInstrumentPatch(kind = 'keys') {
  return {
    attack: 0.01,
    decay: 0.2,
    sustain: 0.7,
    release: 0.35,
    filterHz: kind === 'bass' ? 800 : 2400,
    drive: 0,
    unison: 1
  };
}

export function normalizeInstrumentPatch(raw, kind = 'keys') {
  const base = defaultInstrumentPatch(kind);
  if (!raw || typeof raw !== 'object') return base;
  return {
    attack: Math.max(0.001, Math.min(2, Number(raw.attack) ?? base.attack)),
    decay: Math.max(0.01, Math.min(2, Number(raw.decay) ?? base.decay)),
    sustain: Math.max(0, Math.min(1, Number(raw.sustain) ?? base.sustain)),
    release: Math.max(0.01, Math.min(4, Number(raw.release) ?? base.release)),
    filterHz: Math.max(120, Math.min(12000, Number(raw.filterHz) ?? base.filterHz)),
    drive: Math.max(0, Math.min(1, Number(raw.drive) ?? base.drive)),
    unison: Math.max(1, Math.min(3, Math.round(Number(raw.unison) || 1)))
  };
}
