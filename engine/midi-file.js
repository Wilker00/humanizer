function writeVar(value) {
  const bytes = [value & 0x7f];
  let next = value >> 7;
  while (next) {
    bytes.unshift((next & 0x7f) | 0x80);
    next >>= 7;
  }
  return bytes;
}

function pushInt(bytes, value, size) {
  for (let i = size - 1; i >= 0; i--) bytes.push((value >> (i * 8)) & 0xff);
}

function trackBytes(events) {
  const data = [];
  let last = 0;
  events.sort((a, b) => a.tick - b.tick);
  for (const event of events) {
    data.push(...writeVar(Math.max(0, event.tick - last)));
    last = event.tick;
    data.push(...event.bytes);
  }
  data.push(...writeVar(0), 0xff, 0x2f, 0x00);
  const header = [0x4d, 0x54, 0x72, 0x6b];
  pushInt(header, data.length, 4);
  return header.concat(data);
}

export function encodeMidi({ bpm = 100, melody = [], chords = [], bass = [], drums = [], bars = 8 } = {}) {
  const ticks = 480;
  const stepTicks = ticks / 4;
  const endTick = Math.max(1, bars) * ticks;
  const events = [{ tick: 0, bytes: [0xff, 0x51, 0x03, ...tempoBytes(bpm)] }];
  const note = (channel, midi, start, length, vel) => {
    const on = Math.max(0, Math.round(start * stepTicks));
    const off = Math.min(endTick, on + Math.max(1, Math.round(length * stepTicks)));
    const velocity = Math.max(1, Math.min(127, Math.round((vel == null ? 0.8 : vel) * 127)));
    events.push({ tick: on, bytes: [0x90 | channel, midi & 127, velocity] });
    events.push({ tick: off, bytes: [0x80 | channel, midi & 127, 0] });
  };
  melody.forEach(item => note(0, item.midi, item.step, item.len || 1, item.vel));
  chords.forEach(item => note(1, item.midi, item.step, item.len || 1, item.vel));
  bass.forEach(item => note(2, item.midi, item.step, item.len || 1, item.vel));
  const drumPitch = [36, 38, 42, 46, 39, 41];
  drums.forEach(item => note(9, drumPitch[item.lane] || 42, item.step, 1, item.vel));
  const body = trackBytes(events);
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, ticks >> 8, ticks & 0xff];
  return new Uint8Array(header.concat(body));
}

function tempoBytes(bpm) {
  const us = Math.round(60000000 / Math.max(40, bpm));
  return [(us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff];
}
