// Time-domain pitch shift that keeps each grain's spectrum, so the voice
// does not speed up when the note moves by more than a semitone.

export function formantShift(samples, sampleRate, srcHz, targetHz) {
  const n = samples.length | 0;
  const sr = sampleRate | 0;
  const src = Math.max(70, Math.min(900, Number(srcHz) || 180));
  const tgt = Math.max(70, Math.min(900, Number(targetHz) || src));
  const periodIn = Math.max(16, Math.round(sr / src));
  const periodOut = Math.max(16, Math.round(sr / tgt));
  const half = Math.floor(periodIn / 2);
  const grainLen = periodIn;
  if (n < periodIn * 4 || sr < 8000) return null;
  const marks = [];
  for (let t = 0; t < n; t += periodIn) marks.push(t);
  if (marks.length < 2) return null;
  const out = new Float32Array(n);
  const weight = new Float32Array(n);
  const synthCount = Math.max(1, Math.floor(n / periodOut));
  for (let g = 0; g < synthCount; g++) {
    const centerOut = g * periodOut;
    const centerIn = marks[Math.min(marks.length - 1, Math.floor((g * marks.length) / synthCount))];
    for (let i = 0; i < grainLen; i++) {
      const si = centerIn - half + i;
      const so = centerOut - half + i;
      if (si < 0 || si >= n || so < 0 || so >= n) continue;
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / Math.max(1, grainLen - 1)));
      out[so] += samples[si] * w;
      weight[so] += w;
    }
  }
  let energy = 0;
  for (let i = 0; i < n; i++) {
    if (weight[i] > 1e-6) out[i] /= weight[i];
    energy += out[i] * out[i];
  }
  if (!(energy > 1e-8)) return null;
  return out;
}
