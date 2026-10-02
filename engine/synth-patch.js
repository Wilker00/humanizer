export const DEFAULT_3XOSC_PATCH = {
  osc1: { shape: 'sawtooth', coarse: 0, fine: 0, level: 1.0, invert: false },
  osc2: { shape: 'sawtooth', coarse: 0, fine: 12, level: 0.75, invert: false },
  osc3: { shape: 'sine', coarse: -12, fine: -5, level: 0.5, invert: false },
  filter: { type: 'lowpass', cutoff: 3200, resonance: 1.8 },
  envelope: { attack: 0.01, decay: 0.35, sustain: 0.6, release: 0.25 }
};


export function synthesize3xOscNote(audioContext, freq, duration, patch = DEFAULT_3XOSC_PATCH, when = null, destination = null) {
  if (!audioContext || !freq || isNaN(freq)) return;
  const now = when ?? audioContext.currentTime;
  const p = { ...DEFAULT_3XOSC_PATCH, ...(patch || {}) };

  const masterGain = audioContext.createGain();
  const filter = audioContext.createBiquadFilter();
  filter.type = p.filter?.type || 'lowpass';
  filter.frequency.setValueAtTime(p.filter?.cutoff || 3200, now);
  filter.Q.value = p.filter?.resonance || 1.8;

  filter.connect(masterGain);
  masterGain.connect(destination || audioContext.destination);

  // ADSR Gain Envelope
  const env = p.envelope || DEFAULT_3XOSC_PATCH.envelope;
  const attack = Math.max(0.002, env.attack || 0.01);
  const decay = Math.max(0.01, env.decay || 0.3);
  const sustain = Math.max(0.01, Math.min(1.0, env.sustain || 0.6));
  const release = Math.max(0.02, env.release || 0.25);

  masterGain.gain.setValueAtTime(0.0001, now);
  masterGain.gain.linearRampToValueAtTime(0.22, now + attack);
  masterGain.gain.exponentialRampToValueAtTime(Math.max(0.001, 0.22 * sustain), now + attack + decay);
  masterGain.gain.setValueAtTime(Math.max(0.001, 0.22 * sustain), now + duration);
  masterGain.gain.exponentialRampToValueAtTime(0.0001, now + duration + release);

  // Start 3 oscillators
  [1, 2, 3].forEach(num => {
    const oscData = p[`osc${num}`] || DEFAULT_3XOSC_PATCH[`osc${num}`];
    const coarse = Number(oscData.coarse) || 0;
    const fine = Number(oscData.fine) || 0;
    const level = (Number(oscData.level) ?? 1.0) * (oscData.invert ? -1 : 1);
    if (Math.abs(level) < 0.01) return;

    const oscFreq = freq * Math.pow(2, (coarse + fine / 100) / 12);

    if (oscData.shape === 'noise') {
      const bufferSize = Math.floor(audioContext.sampleRate * (duration + release));
      const noiseBuffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
      const noiseSource = audioContext.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      const noiseGain = audioContext.createGain();
      noiseGain.gain.value = Math.abs(level) * 0.15;
      noiseSource.connect(noiseGain).connect(filter);
      noiseSource.start(now);
      noiseSource.stop(now + duration + release + 0.05);
    } else {
      const osc = audioContext.createOscillator();
      osc.type = oscData.shape || 'sawtooth';
      osc.frequency.setValueAtTime(oscFreq, now);

      const oscGain = audioContext.createGain();
      oscGain.gain.value = Math.abs(level) * 0.33;
      osc.connect(oscGain).connect(filter);
      osc.start(now);
      osc.stop(now + duration + release + 0.05);
    }
  });
}
