import { WIRED_FX_TYPES, moveFxSlotUp, moveFxSlotDown } from './engine/track-fx-graph.js';
import { flStrumNotes, flChopNotes, flRandomizeNotes, flFlamNotes, flFlipNotes, flClawNotes, midiToPitch, parsePitchToMidi } from './engine/score-tools.js';
import { CHORD_STAMPS, expandChordStamp } from './engine/chords.js';
import { insertAutomationPoint } from './engine/automation.js';
import { slotsFromClips, checkProject } from './engine/song-session.js';
import { listProjectVersions, getProjectVersion } from './engine/project-versions.js';
import { detectAudioTransients } from './engine/transients.js';

let api = null;
let tab = 'mix';

const FX_LABEL = { eq: 'EQ', compress: 'Compress', saturator: 'Saturate', chorus: 'Chorus', filter: 'Filter', utility: 'Utility' };

export function installProducer(next) {
  api = next;
  document.querySelectorAll('#prodTabs .tab').forEach(button => {
    button.onclick = () => {
      tab = button.dataset.p;
      document.querySelectorAll('#prodTabs .tab').forEach(item => item.classList.toggle('on', item === button));
      renderProducer();
    };
  });
  const back = document.querySelector('#prodBack');
  if (back) back.onclick = () => api.back();
  const play = document.querySelector('#prodPlay');
  if (play) play.onclick = () => api.togglePlay();
  const save = document.querySelector('#prodSave');
  if (save) save.onclick = () => api.save();
}

export function renderProducer() {
  if (!api) return;
  const song = api.song();
  const host = document.querySelector('#p-' + tab);
  document.querySelectorAll('#prodTabs .tab').forEach(item => item.classList.toggle('on', item.dataset.p === tab));
  document.querySelectorAll('#v-producer .panel').forEach(panel => { panel.hidden = panel.id !== 'p-' + tab; });
  if (!host) return;
  if (tab === 'mix') paintMix(host, song);
  if (tab === 'beat') paintBeat(host, song);
  if (tab === 'sound') paintSound(host, song);
  if (tab === 'arrange') paintArrange(host, song);
  if (tab === 'deliver') paintDeliver(host, song);
  if (api.mountFaders) api.mountFaders(host);
}

function gainText(gain) {
  if (!(gain > 0.0001)) return '−∞';
  const db = 20 * Math.log10(gain);
  return (db < 0 ? '−' : '') + Math.abs(db).toFixed(1) + ' dB';
}

function slider(label, value, min, max, step, on, law) {
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
    if (input.dataset.law === 'audio') { read.textContent = gainText(n); return; }
    read.textContent = input.dataset.decimals === '2' ? n.toFixed(2) : String(Math.round(n));
  };
  show();
  input.oninput = () => { show(); on(+input.value); };
  return wrap;
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
    row.appendChild(slider('Reverb', track.send || 0, 0, 1, '0.01', value => { track.send = value; api.applyMix(); }));
    row.appendChild(slider('Delay', track.delaySend || 0, 0, 1, '0.01', value => { track.delaySend = value; api.applyMix(); }));
    const group = document.createElement('label');
    group.innerHTML = 'Group <b></b><select><option>drums</option><option>music</option><option>vocals</option></select>';
    const select = group.querySelector('select');
    select.value = track.group || 'music';
    group.querySelector('b').textContent = select.value;
    select.oninput = () => { track.group = select.value; group.querySelector('b').textContent = select.value; api.applyMix(); };
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
      amount.oninput = () => { fx.params = { ...(fx.params || {}), amount: +amount.value }; api.applyMix(); };
      line.appendChild(amount);
      const bypass = document.createElement('button');
      bypass.className = 'chip' + (fx.bypass ? '' : ' on');
      bypass.textContent = fx.bypass ? 'Bypassed' : 'Active';
      bypass.setAttribute('aria-pressed', fx.bypass ? 'false' : 'true');
      bypass.onclick = () => { fx.bypass = !fx.bypass; api.applyMix(); renderProducer(); };
      const up = document.createElement('button');
      up.textContent = 'Up';
      up.onclick = () => { moveFxSlotUp(track.fx, index); api.applyMix(); renderProducer(); };
      const down = document.createElement('button');
      down.textContent = 'Down';
      down.onclick = () => { moveFxSlotDown(track.fx, index); api.applyMix(); renderProducer(); };
      line.append(bypass, up, down);
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
      api.applyMix();
      renderProducer();
    };
    add.append(pick, button);
    card.appendChild(add);
    host.appendChild(card);
  });
  ['drums', 'music', 'vocals'].forEach(id => {
    const bus = song.groups[id];
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
  const notes = song.track('drums').notes.filter(note => !note.fill && note.step < steps);
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
    const root = song.track('melody').notes[0]?.midi || (60 + song.root);
    const names = expandChordStamp(midiToPitch(root), pick.value);
    const notes = [];
    for (let bar = 0; bar < song.bars; bar++) {
      names.forEach(name => notes.push({ step: bar * 16, midi: parsePitchToMidi(name), len: 16, vel: 0.45 }));
    }
    song.track('chords').notes = notes;
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

function paintArrange(host, song) {
  host.innerHTML = '<div class="th"><h2>Arrange</h2><p class="hint">Clips follow the bars. Automation rides the same playback.</p></div>';
  if (!song.clips.length) api.syncClips();
  song.clips.forEach(clip => {
    const row = document.createElement('div');
    row.className = 'trow';
    const name = document.createElement('b');
    name.textContent = clip.track + ' bar ' + (clip.startBar + 1);
    row.appendChild(name);
    row.appendChild(slider('Bars', clip.lengthBars, 1, Math.max(1, song.bars - clip.startBar), '1', value => {
      clip.lengthBars = value;
      song.slots = slotsFromClips(song.clips, song.bars);
      api.refreshSong();
    }));
    const earlier = document.createElement('button');
    earlier.textContent = 'Earlier';
    earlier.disabled = clip.startBar < 1;
    earlier.onclick = () => shiftClip(song, clip, -1);
    const later = document.createElement('button');
    later.textContent = 'Later';
    later.disabled = clip.startBar + clip.lengthBars >= song.bars;
    later.onclick = () => shiftClip(song, clip, 1);
    const split = document.createElement('button');
    split.textContent = 'Split';
    split.disabled = clip.lengthBars < 2;
    split.onclick = () => {
      const half = Math.max(1, Math.floor(clip.lengthBars / 2));
      const rest = Math.max(1, clip.lengthBars - half);
      clip.lengthBars = half;
      song.clips.push({ id: clip.id + '-b', track: clip.track, startBar: clip.startBar + half, lengthBars: rest, gain: clip.gain });
      song.slots = slotsFromClips(song.clips, song.bars);
      api.refreshSong();
      renderProducer();
    };
    const dup = document.createElement('button');
    dup.textContent = 'Duplicate';
    dup.onclick = () => {
      const start = clip.startBar + clip.lengthBars;
      if (start >= song.bars) { api.flash('No bars left after this clip'); return; }
      song.clips.push({ id: clip.id + 'c', track: clip.track, startBar: start, lengthBars: Math.min(clip.lengthBars, song.bars - start), gain: clip.gain });
      song.slots = slotsFromClips(song.clips, song.bars);
      api.refreshSong();
      renderProducer();
    };
    row.append(earlier, later, split, dup);
    host.appendChild(row);
  });
  const auto = document.createElement('div');
  auto.className = 'th';
  auto.innerHTML = '<h2>Volume lane</h2><p class="hint">One point per bar on the sound track</p>';
  host.appendChild(auto);
  const points = song.automation.melody || (song.automation.melody = []);
  const lane = document.createElement('div');
  lane.className = 'sl';
  for (let bar = 0; bar < song.bars; bar++) {
    const existing = points.find(point => Math.round(point.x * song.bars) === bar);
    lane.appendChild(slider('Bar ' + (bar + 1), existing ? existing.y : 1, 0, 1, '0.01', value => {
      const fraction = song.bars <= 1 ? 0 : bar / (song.bars - 1);
      const point = points.find(item => Math.abs(item.x - fraction) < 0.02);
      if (point) point.y = value;
      else insertAutomationPoint({ points }, fraction, value, 0);
      api.applyMix();
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
