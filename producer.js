import { WIRED_FX_TYPES, moveFxSlotUp, moveFxSlotDown } from './engine/track-fx-graph.js';
import { flStrumNotes, flChopNotes, flRandomizeNotes, flFlamNotes, flFlipNotes, flClawNotes, midiToPitch, parsePitchToMidi } from './engine/score-tools.js';
import { CHORD_STAMPS, expandChordStamp } from './engine/chords.js';
import { insertAutomationPoint } from './engine/automation.js';
import { slotsFromClips, checkProject } from './engine/song-session.js';
import { listProjectVersions, getProjectVersion } from './engine/project-versions.js';
import { detectAudioTransients } from './engine/transients.js';

let api = null;
let tab = 'mix';
let automationTrack = 'melody';

const FX_LABEL = { eq: 'EQ', compress: 'Compress', saturator: 'Saturate', chorus: 'Chorus', filter: 'Filter', utility: 'Utility' };

export function installProducer(next) {
  api = next;
  document.querySelectorAll('#prodTabs .tab').forEach(button => {
    button.onclick = () => {
      tab = button.dataset.p;
      renderProducer();
    };
  });
  const tabs = document.querySelector('#prodTabs');
  if (tabs) tabs.onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...tabs.querySelectorAll('[role="tab"]')];
    const current = Math.max(0, buttons.indexOf(document.activeElement));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 :
      (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[next].focus();
    buttons[next].click();
  };
  const back = document.querySelector('#prodBack');
  if (back) back.onclick = () => api.back();
  const play = document.querySelector('#prodPlay');
  if (play) play.onclick = () => api.togglePlay();
  const home = document.querySelector('#prodHome');
  if (home) home.onclick = () => api.seek(0);
  const seek = document.querySelector('#prodSeek');
  if (seek) seek.oninput = () => api.seek(+seek.value);
  const bpm = document.querySelector('#prodBpm');
  if (bpm) bpm.onchange = () => api.setBpm(+bpm.value);
  const loop = document.querySelector('#prodLoop');
  if (loop) loop.onclick = () => api.setLoopEnabled(loop.getAttribute('aria-pressed') !== 'true');
  const loopStart = document.querySelector('#prodLoopStart');
  const loopEnd = document.querySelector('#prodLoopEnd');
  const updateLoopRange = () => {
    const start = Math.max(0, (+loopStart.value || 1) - 1);
    const end = +loopEnd.value || 1;
    if (start < end) api.setLoopRange(start, end);
  };
  if (loopStart) loopStart.onchange = updateLoopRange;
  if (loopEnd) loopEnd.onchange = updateLoopRange;
  const save = document.querySelector('#prodSave');
  if (save) save.onclick = () => api.save();
}

export function renderProducer() {
  if (!api) return;
  const song = api.song();
  if (api.transport) updateProducerTransport(api.transport());
  const host = document.querySelector('#p-' + tab);
  document.querySelectorAll('#prodTabs .tab').forEach(item => {
    const active = item.dataset.p === tab;
    item.classList.toggle('on', active);
    item.setAttribute('aria-selected', String(active));
    item.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll('#v-producer .panel').forEach(panel => { panel.hidden = panel.id !== 'p-' + tab; });
  if (!host) return;
  if (tab === 'mix') paintMix(host, song);
  if (tab === 'beat') paintBeat(host, song);
  if (tab === 'sound') paintSound(host, song);
  if (tab === 'arrange') paintArrange(host, song);
  if (tab === 'deliver') paintDeliver(host, song);
  if (api.mountFaders) api.mountFaders(host);
}

function positionText(step) {
  const value = Math.max(0, Math.round(Number(step) || 0));
  const bar = Math.floor(value / 16) + 1;
  const inBar = value % 16;
  return `${bar}.${Math.floor(inBar / 4) + 1}.${(inBar % 4) + 1}`;
}

export function updateProducerTransport(state = {}) {
  const transport = state.transport || {};
  const bars = Math.max(1, Number(state.bars) || 1);
  const step = Math.max(0, Number(state.step) || 0);
  const position = document.querySelector('#prodPosition');
  if (position) position.textContent = positionText(step);
  const play = document.querySelector('#prodPlay');
  if (play) play.textContent = state.playing ? 'Stop' : 'Play';
  const seek = document.querySelector('#prodSeek');
  if (seek) {
    seek.max = String(bars);
    if (document.activeElement !== seek) seek.value = String(Math.min(bars, step / 16));
  }
  const bpm = document.querySelector('#prodBpm');
  if (bpm && document.activeElement !== bpm) bpm.value = String(Math.round(Number(state.bpm) || 100));
  const loop = document.querySelector('#prodLoop');
  if (loop) {
    const enabled = !!transport.loopEnabled;
    loop.classList.toggle('on', enabled);
    loop.setAttribute('aria-pressed', String(enabled));
  }
  const start = document.querySelector('#prodLoopStart');
  const end = document.querySelector('#prodLoopEnd');
  if (start) {
    start.max = String(bars);
    if (document.activeElement !== start) start.value = String(Math.floor(transport.loopStartBar || 0) + 1);
  }
  if (end) {
    end.max = String(bars);
    if (document.activeElement !== end) end.value = String(Math.ceil(transport.loopEndBar == null ? bars : transport.loopEndBar));
  }
}

function peakDb(peak) {
  return peak > 0.0001 ? 20 * Math.log10(peak) : -Infinity;
}

export function updateProducerMeters(levels = {}) {
  document.querySelectorAll('[data-meter]').forEach(meter => {
    const peak = Math.max(0, Number(levels[meter.dataset.meter]) || 0);
    const db = peakDb(peak);
    const normalized = db === -Infinity ? 0 : Math.max(0, Math.min(1, (db + 60) / 60));
    meter.style.setProperty('--meter', String(normalized));
    meter.classList.toggle('clip', peak >= 1);
    const read = meter.parentElement?.querySelector('.meter-read');
    if (read) read.textContent = db === -Infinity ? '−∞ dB' : db.toFixed(1) + ' dB';
  });
  const master = Number(levels.master) || 0;
  const read = document.querySelector('#peakRead');
  if (read) {
    const db = peakDb(master);
    read.textContent = 'Peak ' + (db === -Infinity ? '−∞' : db.toFixed(1)) + ' dBFS';
    read.classList.toggle('clip', master >= 1);
  }
}

function gainText(gain) {
  if (!(gain > 0.0001)) return '−∞';
  const db = 20 * Math.log10(gain);
  return (db < 0 ? '−' : '') + Math.abs(db).toFixed(1) + ' dB';
}

function slider(label, value, min, max, step, on, law, format) {
  const wrap = document.createElement('label');
  wrap.innerHTML = `${label} <b></b><input type="range">`;
  const input = wrap.querySelector('input');
  const read = wrap.querySelector('b');
  input.min = min; input.max = max; input.step = step;
  input.defaultValue = String(value);
  input.value = value;
  if (law) input.dataset.law = law;
  input.dataset.decimals = String(step).includes('.') ? '2' : '0';
  const show = () => {
    const n = Number(input.value);
    if (format) { read.textContent = format(n); return; }
    if (input.dataset.law === 'audio') { read.textContent = gainText(n); return; }
    read.textContent = input.dataset.decimals === '2' ? n.toFixed(2) : String(Math.round(n));
  };
  show();
  input.oninput = () => { show(); on(+input.value); };
  return wrap;
}

function meter(type) {
  const wrap = document.createElement('span');
  wrap.className = 'mix-meter';
  wrap.innerHTML = `<span class="meter" data-meter="${type}" aria-label="${type} peak meter"><i></i></span><span class="meter-read">−∞ dB</span>`;
  return wrap;
}

function rebuildMix() {
  if (api.rebuildMix) api.rebuildMix();
  else api.applyMix();
}

function panText(value) {
  const pan = Math.round(value * 100);
  if (!pan) return 'C';
  return Math.abs(pan) + (pan < 0 ? 'L' : 'R');
}

function paintMix(host, song) {
  host.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'th';
  head.innerHTML = '<h2>Mix</h2><p class="hint">Inserts, sends, and groups on this song</p>';
  host.appendChild(head);
  const duck = document.createElement('button');
  duck.className = 'chip' + (song.duck ? ' on' : '');
  duck.textContent = 'Kick duck: ' + (song.duck ? 'on' : 'off');
  duck.onclick = () => { song.duck = !song.duck; api.applyMix(); renderProducer(); };
  const tools = document.createElement('div');
  tools.className = 'bar';
  tools.appendChild(duck);
  const peak = document.createElement('span');
  peak.className = 'lab';
  peak.id = 'peakRead';
  peak.textContent = 'Peak —';
  tools.appendChild(peak);
  host.appendChild(tools);
  const master = document.createElement('article');
  master.className = 'opt';
  master.innerHTML = '<b>Master</b>';
  const masterRow = document.createElement('div');
  masterRow.className = 'sl';
  masterRow.appendChild(slider('Output', song.masterVolume, 0, 1.25, '0.01', value => { song.masterVolume = value; api.applyMix(); }, 'audio'));
  masterRow.appendChild(meter('master'));
  master.appendChild(masterRow);
  host.appendChild(master);
  song.tracks.forEach(track => {
    const card = document.createElement('article');
    card.className = 'opt';
    const title = document.createElement('b');
    title.textContent = track.name;
    card.appendChild(title);
    const row = document.createElement('div');
    row.className = 'sl';
    const volume = slider('Volume', track.volume, 0, 1, '0.01', value => { track.volume = value; api.applyMix(); }, 'audio');
    row.appendChild(volume);
    row.appendChild(slider('Pan', track.pan || 0, -1, 1, '0.01', value => { track.pan = value; api.applyMix(); }, null, panText));
    row.appendChild(slider('Reverb', track.send || 0, 0, 1, '0.01', value => { track.send = value; api.applyMix(); }));
    row.appendChild(slider('Delay', track.delaySend || 0, 0, 1, '0.01', value => { track.delaySend = value; api.applyMix(); }));
    row.appendChild(meter(track.type));
    const group = document.createElement('label');
    group.innerHTML = 'Group <b></b><select><option>drums</option><option>music</option><option>vocals</option></select>';
    const select = group.querySelector('select');
    select.value = track.group || 'music';
    group.querySelector('b').textContent = select.value;
    select.oninput = () => { track.group = select.value; group.querySelector('b').textContent = select.value; rebuildMix(); };
    row.appendChild(group);
    card.appendChild(row);
    (track.fx || []).forEach((fx, index) => {
      const line = document.createElement('div');
      line.className = 'trow';
      const name = document.createElement('b');
      name.textContent = FX_LABEL[fx.type] || fx.type;
      line.appendChild(name);
      const amount = document.createElement('input');
      amount.type = 'range'; amount.min = '0'; amount.max = '1'; amount.step = '0.01';
      amount.defaultValue = String(fx.params?.amount ?? 0.5);
      amount.value = fx.params?.amount ?? 0.5;
      amount.setAttribute('aria-label', name.textContent + ' amount');
      amount.oninput = () => { fx.params = { ...(fx.params || {}), amount: +amount.value }; rebuildMix(); };
      line.appendChild(amount);
      const bypass = document.createElement('button');
      bypass.className = 'chip' + (fx.bypass ? '' : ' on');
      bypass.textContent = fx.bypass ? 'Bypassed' : 'Active';
      bypass.setAttribute('aria-pressed', fx.bypass ? 'false' : 'true');
      bypass.onclick = () => { fx.bypass = !fx.bypass; rebuildMix(); renderProducer(); };
      const up = document.createElement('button');
      up.textContent = 'Up';
      up.disabled = index === 0;
      up.onclick = () => { moveFxSlotUp(track.fx, index); rebuildMix(); renderProducer(); };
      const down = document.createElement('button');
      down.textContent = 'Down';
      down.disabled = index === track.fx.length - 1;
      down.onclick = () => { moveFxSlotDown(track.fx, index); rebuildMix(); renderProducer(); };
      const remove = document.createElement('button');
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${name.textContent} from ${track.name}`);
      remove.onclick = () => { track.fx.splice(index, 1); rebuildMix(); renderProducer(); };
      line.append(bypass, up, down, remove);
      card.appendChild(line);
    });
    const add = document.createElement('div');
    add.className = 'bar';
    const pick = document.createElement('select');
    WIRED_FX_TYPES.forEach(type => {
      const option = document.createElement('option');
      option.value = type; option.textContent = FX_LABEL[type];
      pick.appendChild(option);
    });
    const button = document.createElement('button');
    button.textContent = 'Add insert';
    button.onclick = () => {
      track.fx.push({ id: 'fx-' + Math.random().toString(36).slice(2, 7), type: pick.value, bypass: false, params: { amount: 0.5 } });
      rebuildMix();
      renderProducer();
    };
    add.append(pick, button);
    card.appendChild(add);
    host.appendChild(card);
  });
  ['drums', 'music', 'vocals'].forEach(id => {
    const bus = song.groups[id];
    if (!bus) return;
    const row = document.createElement('div');
    row.className = 'sl';
    row.appendChild(slider(id + ' bus', bus.vol, 0, 1.5, '0.01', value => { bus.vol = value; api.applyMix(); }));
    const mute = document.createElement('button');
    mute.type = 'button';
    mute.className = 'ms' + (bus.mute ? ' on' : '');
    mute.dataset.k = 'mute';
    mute.textContent = 'M';
    mute.setAttribute('aria-label', id + ' bus mute');
    mute.setAttribute('aria-pressed', bus.mute ? 'true' : 'false');
    mute.onclick = () => { bus.mute = !bus.mute; api.applyMix(); renderProducer(); };
    row.appendChild(mute);
    host.appendChild(row);
  });
}

function paintBeat(host, song) {
  host.innerHTML = '';
  host.innerHTML = '<div class="th"><h2>Beat</h2><p class="hint">Velocity, nudge, choke, and lanes for the same grid</p></div>';
  const lengths = document.createElement('div');
  lengths.className = 'bar';
  [1, 2, 4].forEach(bars => {
    const button = document.createElement('button');
    button.className = 'chip' + (song.drumBars === bars ? ' on' : '');
    button.textContent = bars + (bars === 1 ? ' bar' : ' bars');
    button.onclick = () => { song.drumBars = bars; api.refreshSong(); renderProducer(); };
    lengths.appendChild(button);
  });
  const add = document.createElement('button');
  add.textContent = 'Add lane';
  add.onclick = () => {
    const name = 'Lane ' + (song.laneNames.length + 1);
    song.laneNames.push(name);
    if (/hat/i.test(name) || song.laneNames.length === 4) song.choke[song.laneNames.length - 1] = 1;
    api.refreshSong();
    renderProducer();
  };
  lengths.appendChild(add);
  host.appendChild(lengths);
  const steps = Math.max(16, (song.drumBars || 1) * 16);
  const notes = (song.track('drums') || { notes: [] }).notes.filter(note => !note.fill && note.step < steps);
  song.laneNames.forEach((name, lane) => {
    const card = document.createElement('article');
    card.className = 'opt';
    const title = document.createElement('b');
    title.textContent = name;
    card.appendChild(title);
    const choke = document.createElement('button');
    choke.className = 'chip' + (song.choke[lane] != null ? ' on' : '');
    choke.textContent = song.choke[lane] != null ? 'Choke on' : 'Choke off';
    choke.onclick = () => {
      if (song.choke[lane] != null) delete song.choke[lane];
      else song.choke[lane] = 1;
      renderProducer();
    };
    card.appendChild(choke);
    const hits = notes.filter(note => note.lane === lane);
    if (!hits.length) {
      const empty = document.createElement('p');
      empty.className = 'meta';
      empty.textContent = 'No hits in this lane yet.';
      card.appendChild(empty);
    }
    hits.forEach(note => {
      const row = document.createElement('div');
      row.className = 'sl';
      row.appendChild(slider('Step ' + (note.step + 1), note.vel == null ? 0.8 : note.vel, 0.05, 1, '0.01', value => { note.vel = value; }));
      row.appendChild(slider('Nudge', note.nudge || 0, -1, 1, '0.05', value => { note.nudge = value; }));
      card.appendChild(row);
    });
    host.appendChild(card);
  });
}

function phraseNotes(notes) {
  return notes.map(note => ({
    n: midiToPitch(note.midi || 60),
    x: note.step,
    w: note.len || 1,
    v: note.vel == null ? 0.8 : note.vel,
    daw: note
  }));
}

function writePhrase(track, phrase) {
  track.notes = phrase.map(note => {
    const base = note.daw ? { ...note.daw } : { word: '', wordLock: false, srcMidi: parsePitchToMidi(note.n), audioStart: null, audioEnd: null };
    base.step = Math.max(0, Math.round(note.x));
    base.midi = parsePitchToMidi(note.n);
    base.len = Math.max(1, Math.round(note.w));
    base.vel = note.v;
    return base;
  });
}

function paintSound(host, song) {
  host.innerHTML = '<div class="th"><h2>Sound</h2><p class="hint">Shape the melody and chords already on the song</p></div>';
  const tools = document.createElement('div');
  tools.className = 'bar';
  const actions = [
    ['Strum', notes => flStrumNotes(notes, { startOffset: 0.12 })],
    ['Chop', notes => flChopNotes(notes, { division: '1/8', gate: 0.8 })],
    ['Flam', notes => flFlamNotes(notes, { count: 3 })],
    ['Flip', notes => flFlipNotes(notes, { direction: 'vertical' })],
    ['Randomize', notes => flRandomizeNotes(notes, { velAmount: 0.15, timeNudge: 0.04 })],
    ['Claw', notes => flClawNotes(notes, { stepLength: 1, gate: 0.7 })]
  ];
  actions.forEach(([label, run]) => {
    const button = document.createElement('button');
    button.textContent = label;
    button.onclick = () => {
      const track = song.track('melody');
      if (!track) return;
      api.pushUndo();
      writePhrase(track, run(phraseNotes(track.notes)));
      api.refreshSong();
      api.flash(label + ' applied');
    };
    tools.appendChild(button);
  });
  host.appendChild(tools);
  const layer = document.createElement('button');
  layer.className = 'chip' + (song.useLayer ? ' on' : '');
  layer.textContent = 'Layered synth: ' + (song.useLayer ? 'on' : 'off');
  layer.onclick = () => { song.useLayer = !song.useLayer; api.applyMix(); renderProducer(); };
  const row = document.createElement('div');
  row.className = 'bar';
  row.appendChild(layer);
  host.appendChild(row);
  const env = document.createElement('div');
  env.className = 'sl';
  [['Attack', 'attack', 0.001, 0.8], ['Decay', 'decay', 0.01, 1.2], ['Sustain', 'sustain', 0, 1], ['Release', 'release', 0.01, 1.5]].forEach(([label, key, min, max]) => {
    env.appendChild(slider(label, song.adsr[key], min, max, '0.01', value => {
      song.adsr[key] = value;
      song.patch.envelope[key] = value;
      api.applyEnvelope();
    }));
  });
  host.appendChild(env);
  const filter = document.createElement('div');
  filter.className = 'sl';
  filter.appendChild(slider('Cutoff', song.patch.filter.cutoff, 80, 8000, '10', value => { song.patch.filter.cutoff = value; }));
  filter.appendChild(slider('Resonance', song.patch.filter.resonance, 0.2, 12, '0.1', value => { song.patch.filter.resonance = value; }));
  host.appendChild(filter);
  [1, 2, 3].forEach(num => {
    const osc = song.patch['osc' + num];
    const line = document.createElement('div');
    line.className = 'sl';
    const shape = document.createElement('label');
    shape.innerHTML = 'Osc ' + num + ' <b></b><select><option>sine</option><option>triangle</option><option>sawtooth</option><option>square</option></select>';
    const select = shape.querySelector('select');
    select.value = osc.shape || 'sawtooth';
    shape.querySelector('b').textContent = select.value;
    select.oninput = () => { osc.shape = select.value; shape.querySelector('b').textContent = select.value; };
    line.appendChild(shape);
    line.appendChild(slider('Level', osc.level == null ? 1 : osc.level, 0, 1, '0.01', value => { osc.level = value; }));
    host.appendChild(line);
  });
  const stamps = document.createElement('div');
  stamps.className = 'bar';
  const pick = document.createElement('select');
  Object.entries(CHORD_STAMPS).forEach(([id, stamp]) => {
    const option = document.createElement('option');
    option.value = id; option.textContent = stamp.name;
    pick.appendChild(option);
  });
  const apply = document.createElement('button');
  apply.textContent = 'Stamp chords';
  apply.onclick = () => {
    api.pushUndo();
    const root = (song.track('melody') || { notes: [] }).notes[0]?.midi || (60 + song.root);
    const names = expandChordStamp(midiToPitch(root), pick.value);
    const notes = [];
    for (let bar = 0; bar < song.bars; bar++) {
      names.forEach(name => notes.push({ step: bar * 16, midi: parsePitchToMidi(name), len: 16, vel: 0.45 }));
    }
    const ct = song.track('chords');
    if (ct) ct.notes = notes;
    api.refreshSong();
    api.flash('Chords stamped');
  };
  stamps.append(pick, apply);
  const slices = document.createElement('button');
  slices.textContent = 'Find transients';
  slices.onclick = () => {
    const buffer = api.vocalBuffer();
    if (!buffer) { api.flash('Record or upload audio first'); return; }
    const points = detectAudioTransients(buffer, { sensitivity: 0.35 });
    api.flash(Math.max(0, points.length - 1) + ' slices in the take');
  };
  stamps.appendChild(slices);
  host.appendChild(stamps);
}

function shiftClip(song, clip, dir) {
  if (clip.locked) { api.flash('Unlock the clip before moving it'); return; }
  const start = clip.startBar + dir;
  if (start < 0 || start + clip.lengthBars > song.bars) {
    api.flash('That clip stays inside the song');
    return;
  }
  clip.startBar = start;
  song.slots = slotsFromClips(song.clips, song.bars);
  api.refreshSong();
  renderProducer();
}

function uniqueClipId(song, base) {
  let id = `${base}-${Math.random().toString(36).slice(2, 7)}`;
  while (song.clips.some(clip => clip.id === id)) id = `${base}-${Math.random().toString(36).slice(2, 7)}`;
  return id;
}

function paintArrange(host, song) {
  host.innerHTML = '<div class="th"><h2>Arrange</h2><p class="hint">Clips follow the bars. Automation rides the same playback.</p></div>';
  if (!song.clips.length) {
    const empty = document.createElement('p');
    empty.className = 'meta';
    empty.textContent = 'No clips in the arrangement. Return to the workspace and enable a bar to create clips.';
    host.appendChild(empty);
  }
  song.clips.forEach(clip => {
    const card = document.createElement('article');
    card.className = 'clip-card' + (clip.muted ? ' muted' : '') + (clip.locked ? ' locked' : '');
    const row = document.createElement('div');
    row.className = 'trow';
    const name = document.createElement('b');
    const track = song.track(clip.track);
    name.textContent = (track?.name || clip.track) + ' · bar ' + (clip.startBar + 1);
    row.appendChild(name);
    const length = slider('Length', clip.lengthBars, 1, Math.max(1, song.bars - clip.startBar), '1', value => {
      clip.lengthBars = value;
      song.slots = slotsFromClips(song.clips, song.bars);
      api.refreshSong();
    });
    length.querySelector('input').disabled = !!clip.locked;
    row.appendChild(length);
    row.appendChild(slider('Clip gain', clip.gain == null ? 1 : clip.gain, 0, 1.5, '0.01', value => { clip.gain = value; }, 'audio'));
    row.appendChild(meter(clip.track));
    card.appendChild(row);
    const tools = document.createElement('div');
    tools.className = 'bar';
    const earlier = document.createElement('button');
    earlier.textContent = 'Earlier';
    earlier.disabled = clip.locked || clip.startBar < 1;
    earlier.onclick = () => shiftClip(song, clip, -1);
    const later = document.createElement('button');
    later.textContent = 'Later';
    later.disabled = clip.locked || clip.startBar + clip.lengthBars >= song.bars;
    later.onclick = () => shiftClip(song, clip, 1);
    const split = document.createElement('button');
    split.textContent = 'Split';
    split.disabled = clip.locked || clip.lengthBars < 2;
    split.onclick = () => {
      const half = Math.max(1, Math.floor(clip.lengthBars / 2));
      const rest = Math.max(1, clip.lengthBars - half);
      clip.lengthBars = half;
      song.clips.push({ ...clip, id: uniqueClipId(song, clip.id), startBar: clip.startBar + half, lengthBars: rest, locked: false });
      song.slots = slotsFromClips(song.clips, song.bars);
      api.refreshSong();
      renderProducer();
    };
    const dup = document.createElement('button');
    dup.textContent = 'Duplicate';
    dup.disabled = !!clip.locked;
    dup.onclick = () => {
      const start = clip.startBar + clip.lengthBars;
      if (start >= song.bars) { api.flash('No bars left after this clip'); return; }
      song.clips.push({ ...clip, id: uniqueClipId(song, clip.id), startBar: start, lengthBars: Math.min(clip.lengthBars, song.bars - start), locked: false });
      song.slots = slotsFromClips(song.clips, song.bars);
      api.refreshSong();
      renderProducer();
    };
    const mute = document.createElement('button');
    mute.className = 'chip' + (clip.muted ? ' on' : '');
    mute.textContent = clip.muted ? 'Muted' : 'Mute';
    mute.setAttribute('aria-pressed', String(!!clip.muted));
    mute.onclick = () => { clip.muted = !clip.muted; song.slots = slotsFromClips(song.clips, song.bars); api.refreshSong(); renderProducer(); };
    const lock = document.createElement('button');
    lock.className = 'chip' + (clip.locked ? ' on' : '');
    lock.textContent = clip.locked ? 'Locked' : 'Lock';
    lock.setAttribute('aria-pressed', String(!!clip.locked));
    lock.onclick = () => { clip.locked = !clip.locked; renderProducer(); };
    const remove = document.createElement('button');
    remove.textContent = 'Delete';
    remove.disabled = !!clip.locked;
    remove.onclick = () => {
      const index = song.clips.indexOf(clip);
      if (index >= 0) song.clips.splice(index, 1);
      song.slots = slotsFromClips(song.clips, song.bars);
      api.refreshSong();
      renderProducer();
    };
    tools.append(earlier, later, split, dup, mute, lock, remove);
    card.appendChild(tools);
    host.appendChild(card);
  });
  const auto = document.createElement('div');
  auto.className = 'th';
  auto.innerHTML = '<h2>Volume automation</h2><p class="hint">One breakpoint per bar</p>';
  host.appendChild(auto);
  const trackSelect = document.createElement('label');
  trackSelect.innerHTML = 'Track <select></select>';
  song.tracks.forEach(track => {
    const option = document.createElement('option');
    option.value = track.type;
    option.textContent = track.name;
    trackSelect.querySelector('select').appendChild(option);
  });
  if (!song.track(automationTrack)) automationTrack = song.tracks[0]?.type || 'melody';
  trackSelect.querySelector('select').value = automationTrack;
  trackSelect.querySelector('select').oninput = event => { automationTrack = event.target.value; renderProducer(); };
  host.appendChild(trackSelect);
  const points = song.automation[automationTrack] || (song.automation[automationTrack] = []);
  const lane = document.createElement('div');
  lane.className = 'sl';
  for (let bar = 0; bar < song.bars; bar++) {
    const fraction = song.bars <= 1 ? 0 : bar / (song.bars - 1);
    const existing = points.find(point => Math.abs(point.x - fraction) < 0.0001);
    lane.appendChild(slider('Bar ' + (bar + 1), existing ? existing.y : 1, 0, 1, '0.01', value => {
      const point = points.find(item => Math.abs(item.x - fraction) < 0.02);
      if (point) point.y = value;
      else insertAutomationPoint({ points }, fraction, value, 0);
    }));
  }
  host.appendChild(lane);
}

function paintDeliver(host, song) {
  host.innerHTML = '<div class="th"><h2>Deliver</h2><p class="hint">Loudness here is approximate, not a certified meter</p></div>';
  const buttons = document.createElement('div');
  buttons.className = 'bar';
  [['WAV', () => api.exportWav()], ['Stems', () => api.exportStems()], ['MIDI', () => api.exportMidi()], ['Share pack', () => api.exportPack()]].forEach(([label, run]) => {
    const button = document.createElement('button');
    button.textContent = label;
    button.onclick = run;
    buttons.appendChild(button);
  });
  host.appendChild(buttons);
  const check = document.createElement('p');
  check.className = 'meta';
  check.textContent = checkProject(song, { name: api.projectName(), bpm: api.bpm() });
  host.appendChild(check);
  const latency = document.createElement('div');
  latency.className = 'sl';
  latency.appendChild(slider('Latency offset ms', song.latencyOffsetMs || 0, -200, 200, '1', value => { song.latencyOffsetMs = value; }));
  host.appendChild(latency);
  const versions = document.createElement('div');
  versions.className = 'th';
  versions.innerHTML = '<h2>Versions</h2><p class="hint">Local saves of this project</p>';
  host.appendChild(versions);
  const id = api.projectId();
  if (!id) return;
  listProjectVersions(id).forEach(version => {
    const row = document.createElement('div');
    row.className = 'trow';
    const name = document.createElement('b');
    name.textContent = new Date(version.at).toLocaleString();
    const restore = document.createElement('button');
    restore.textContent = 'Restore';
    restore.onclick = () => {
      const found = getProjectVersion(id, version.id);
      if (found?.snapshot) api.restore(found.snapshot);
    };
    row.append(name, restore);
    versions.appendChild(row);
  });
  if (!listProjectVersions(id).length) {
    const empty = document.createElement('p');
    empty.className = 'meta';
    empty.textContent = 'Save the song to keep a version.';
    host.appendChild(empty);
  }
}
