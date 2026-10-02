export const DEFAULT_ADSR = {
  attack: 0.005, // seconds
  hold: 0.05,    // seconds
  decay: 0.25,   // seconds
  sustain: 0.7,  // 0.0 - 1.0 level
  release: 0.15  // seconds
};


export function applyAdsrToGainParam(gainParam, adsr = DEFAULT_ADSR, startTime, duration = 0.5, peakVolume = 1.0) {
  if (!gainParam) return;
  const env = { ...DEFAULT_ADSR, ...(adsr || {}) };
  const att = Math.max(0.001, env.attack);
  const hold = Math.max(0.001, env.hold);
  const dec = Math.max(0.005, env.decay);
  const sus = Math.max(0.001, Math.min(1.0, env.sustain));
  const rel = Math.max(0.005, env.release);

  const t0 = startTime;
  const tAtt = t0 + att;
  const tHold = tAtt + hold;
  const tDec = tHold + dec;

  gainParam.setValueAtTime(0.0001, t0);
  gainParam.linearRampToValueAtTime(peakVolume, tAtt);
  gainParam.setValueAtTime(peakVolume, tHold);
  gainParam.exponentialRampToValueAtTime(Math.max(0.0001, peakVolume * sus), tDec);

  const tEnd = Math.max(tDec, t0 + duration);
  gainParam.setValueAtTime(Math.max(0.0001, peakVolume * sus), tEnd);
  gainParam.exponentialRampToValueAtTime(0.0001, tEnd + rel);
}
