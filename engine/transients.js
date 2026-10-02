export function detectAudioTransients(audioBuffer, { sensitivity = 0.35, minSliceSeconds = 0.08 } = {}) {
  if (!audioBuffer) return [0.0, 1.0];

  const raw = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate || 44100;
  const blockSize = Math.round(sampleRate * 0.01); // 10ms blocks
  const minSamples = Math.round(minSliceSeconds * sampleRate);

  const energy = [];
  for (let i = 0; i < raw.length; i += blockSize) {
    let sum = 0;
    const end = Math.min(raw.length, i + blockSize);
    for (let j = i; j < end; j++) {
      sum += raw[j] * raw[j];
    }
    energy.push(Math.sqrt(sum / (end - i)));
  }

  const sliceIndices = [0];
  let lastSliceSample = 0;

  for (let b = 1; b < energy.length - 1; b++) {
    const prevE = energy[b - 1];
    const curE = energy[b];
    const diff = curE - prevE;
    const curSample = b * blockSize;

    if (diff > sensitivity && (curSample - lastSliceSample) >= minSamples) {
      sliceIndices.push(curSample);
      lastSliceSample = curSample;
    }
  }

  // Ensure end slice point
  if (lastSliceSample < raw.length - minSamples) {
    sliceIndices.push(raw.length);
  }

  return sliceIndices.map(sampleIdx => Math.min(1.0, sampleIdx / raw.length));
}

