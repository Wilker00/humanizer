import { connectFxChain, channelAudibleGain } from './track-fx-graph.js';
import { GROUP_FOR, clipGainAt, automationGain } from './song-session.js';
import { swingOffsetSeconds } from './transport.js';
import { synthesize3xOscNote } from './synth-patch.js';

function noiseBuffer(ctx, seconds) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function envGain(ctx, when, peak, attack, decay) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.linearRampToValueAtTime(peak, when + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
  return gain;
}

export async function renderSong(song, { bpm = 100, only = null, vocalBuffer = null, swing = 0, humanize = true } = {}) {
  const bars = song.bars || 8;
  const steps = Math.max(16, bars * 16);
  const stepSeconds = 15 / bpm;
  const duration = steps * stepSeconds + 1.2;
  const sampleRate = 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
  const master = ctx.createGain();
  master.gain.value = song.masterVolume == null ? 0.92 : Math.max(0, Math.min(1.25, Number(song.masterVolume) || 0));
  master.connect(ctx.destination);
  const groups = {};
  for (const id of ['drums', 'music', 'vocals']) {
    const gain = ctx.createGain();
    const bus = song.groups?.[id];
    gain.gain.value = !bus || bus.mute ? (bus ? 0 : 1) : bus.vol;
    gain.connect(master);
    groups[id] = gain;
  }
  const anySolo = (song.tracks || []).some(track => track.solo);
  const inputs = {};
  for (const track of song.tracks || []) {
    if (only && track.type !== only) continue;
    const input = ctx.createGain();
    const audible = channelAudibleGain({
      vol: track.volume,
      mute: track.mute,
      solo: track.solo,
      anySolo,
      automation: 1
    });
    input.gain.value = audible;
    const fx = connectFxChain(ctx, input, track.fx || []);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, Number(track.pan) || 0));
    fx.output.connect(pan);
    pan.connect(groups[track.group || GROUP_FOR[track.type] || 'music']);
    inputs[track.type] = input;
  }
  const kickNoise = noiseBuffer(ctx, 0.2);
  const slotAt = step => {
    const bar = Math.floor(step / 16);
    return song.slots?.[bar] || 'off';
  };
  for (let step = 0; step < steps; step++) {
    const slot = slotAt(step);
    const playMel = slot === 'melody' || slot === 'both';
    const playDrums = slot === 'drums' || slot === 'both';
    const when = step * stepSeconds + (humanize ? swingOffsetSeconds(step, bpm, swing) : 0);
    const bar = Math.floor(step / 16);
    if (playDrums && inputs.drums) {
      const loop = Math.max(16, (song.drumBars || 1) * 16);
      const hits = (song.track('drums')?.notes || []).filter(note => (note.fill || note.once) ? note.step === step : note.step === (step % loop));
      const kept = chokeHits(hits, song.choke || {});
      const drumScale = clipGainAt(song.clips, 'drums', bar) * automationGain(song.automation?.drums, bar, bars);
      kept.forEach(note => hitDrum(ctx, inputs.drums, kickNoise, note, when + (note.nudge || 0) * stepSeconds * 0.5, drumScale));
    }
    if (playMel) {
      const melScale = clipGainAt(song.clips, 'melody', bar) * automationGain(song.automation?.melody, bar, bars);
      (song.track('melody')?.notes || []).forEach(note => {
        if (note.step !== step || !inputs.melody) return;
        const freq = 440 * 2 ** (((note.midi || 60) + (song.trans || 0) - 69) / 12);
        const dur = Math.max(0.05, (note.len || 1) * stepSeconds);
        if (song.useLayer) synthesize3xOscNote(ctx, freq, dur, song.patch, when, inputs.melody);
        else tone(ctx, inputs.melody, freq, when, dur, (note.vel || 0.7) * 0.2 * melScale, 'triangle');
      });
    }
    if ((inputs.vocal || inputs.vocals) && vocalBuffer) {
      (song.track('melody')?.notes || []).forEach(note => {
        if (note.step !== step || note.audioStart == null) return;
        playSlice(ctx, inputs.vocal || inputs.vocals, vocalBuffer, note, when, stepSeconds);
      });
    }
    (song.track('chords')?.notes || []).filter(note => note.step === step).forEach(note => {
      if (!inputs.chords) return;
      const freq = 440 * 2 ** (((note.midi || 60) - 69) / 12);
      tone(ctx, inputs.chords, freq, when, (note.len || 1) * stepSeconds, (note.vel || 0.4) * 0.12, 'triangle');
    });
    (song.track('bass')?.notes || []).forEach(note => {
      if (note.step !== step || !inputs.bass) return;
      const freq = 440 * 2 ** (((note.midi || 48) - 69) / 12);
      tone(ctx, inputs.bass, freq, when, (note.len || 1) * stepSeconds, (note.vel || 0.7) * 0.25, 'sine');
    });
  }
  const rendered = await ctx.startRendering();
  return {
    sampleRate,
    left: rendered.getChannelData(0).slice(),
    right: rendered.numberOfChannels > 1 ? rendered.getChannelData(1).slice() : rendered.getChannelData(0).slice()
  };
}

function chokeHits(hits, choke) {
  const plain = [];
  const grouped = {};
  hits.forEach(note => {
    const group = choke[note.lane];
    if (group == null) plain.push(note);
    else if (!grouped[group] || note.lane > grouped[group].lane) grouped[group] = note;
  });
  return plain.concat(Object.values(grouped));
}

function hitDrum(ctx, dest, noise, note, when, scale) {
  const vel = Math.max(0.05, (note.vel || 0.8) * scale);
  if ((note.lane | 0) === 0) {
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(140, when);
    osc.frequency.exponentialRampToValueAtTime(45, when + 0.12);
    const gain = envGain(ctx, when, vel * 0.8, 0.002, 0.16);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(when);
    osc.stop(when + 0.2);
    return;
  }
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = (note.lane | 0) === 1 ? 'bandpass' : 'highpass';
  filter.frequency.value = (note.lane | 0) === 1 ? 1800 : 7000;
  const gain = envGain(ctx, when, vel * ((note.lane | 0) === 1 ? 0.45 : 0.22), 0.001, (note.lane | 0) === 1 ? 0.14 : 0.04);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  src.start(when);
  src.stop(when + 0.2);
}

function tone(ctx, dest, freq, when, dur, peak, type) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = Math.max(20, freq);
  const gain = envGain(ctx, when, peak, 0.01, Math.max(0.05, dur));
  osc.connect(gain);
  gain.connect(dest);
  osc.start(when);
  osc.stop(when + dur + 0.05);
}

function playSlice(ctx, dest, buffer, note, when, stepSeconds) {
  const start = note.audioStart;
  const avail = Math.max(0.03, (note.audioEnd || start) - start);
  const dur = Math.min(avail, Math.max(0.05, (note.len || 1) * stepSeconds), Math.max(0.03, buffer.duration - start));
  if (!(dur > 0)) return;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = note.vel == null ? 0.8 : note.vel;
  src.connect(gain);
  gain.connect(dest);
  src.start(when, start, dur);
}
