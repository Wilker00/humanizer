import { migrateProjectToV3 } from './project-format.js';

// Project JSON stores references; IndexedDB owns the audio bytes between visits.
const DATABASE = 'bmai-audio-assets';
const STORE = 'assets';
const PREFIX = 'bmai-asset:';
const REFERENCE = /^bmai-asset:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PROJECT_AUDIO_BYTES = 100 * 1024 * 1024;

export function isStoredAudioAsset(ref) {
  return typeof ref === 'string' && REFERENCE.test(ref);
}

function storageError(error) {
  if (error?.name === 'QuotaExceededError') {
    return new Error('Audio storage is full. Free browser storage and try again.', { cause: error });
  }
  return new Error('Audio storage is unavailable. Allow browser storage and try again.', { cause: error });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    let request;
    let failed = false;
    const fail = error => {
      failed = true;
      reject(storageError(error));
    };
    try {
      if (!globalThis.indexedDB) throw new Error('IndexedDB is unavailable');
      request = globalThis.indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onerror = () => fail(request.error);
      request.onblocked = () => fail(new Error('Another BMAI tab is blocking audio storage'));
      request.onsuccess = () => {
        const database = request.result;
        if (failed) { database.close(); return; }
        database.onversionchange = () => database.close();
        resolve(database);
      };
    } catch (error) {
      fail(error);
    }
  });
}

async function transact(mode, action) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    let transaction;
    let value;
    let failure;
    const fail = error => {
      database.close();
      reject(storageError(error));
    };
    try {
      transaction = database.transaction(STORE, mode);
      transaction.oncomplete = () => { database.close(); resolve(value); };
      transaction.onerror = event => { failure = event.target?.error || transaction.error; };
      transaction.onabort = () => fail(failure || transaction.error);
      action(transaction.objectStore(STORE), result => { value = result; });
    } catch (error) {
      if (transaction) {
        try { transaction.abort(); } catch { /* It may already have completed. */ }
      }
      fail(error);
    }
  });
}

function assertAudioBlob(blob) {
  if (!(blob instanceof Blob) || !blob.size) throw new Error('Audio data is empty or damaged. Import the audio file again.');
}

function createReference() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return PREFIX + globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) throw new Error('This browser cannot create audio asset identifiers.');
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return PREFIX + `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function writeAssets(assets) {
  if (!assets.length) return;
  await transact('readwrite', store => {
    for (const { ref, blob, name } of assets) store.put({ blob, name }, ref.slice(PREFIX.length));
  });
}

export async function storeAudioAsset(blob) {
  assertAudioBlob(blob);
  const ref = createReference();
  await writeAssets([{ ref, blob, name: typeof blob.name === 'string' ? blob.name : undefined }]);
  return ref;
}

async function readStoredAsset(ref) {
  if (!isStoredAudioAsset(ref)) throw new Error('Invalid BMAI audio asset reference.');
  const record = await transact('readonly', (store, done) => {
    const request = store.get(ref.slice(PREFIX.length));
    request.onsuccess = () => done(request.result);
  });
  if (record === undefined) return null;
  assertAudioBlob(record?.blob);
  return record;
}

export async function resolveAudioAsset(ref) {
  return (await readStoredAsset(ref))?.blob || null;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneProject(snapshot) {
  if (!isObject(snapshot)) throw new Error('Invalid project: expected a JSON object.');
  const version = snapshot.schemaVersion === undefined ? 1 : snapshot.schemaVersion;
  if (version !== 1 && version !== 2 && version !== 3) {
    throw new Error('This project uses an unsupported schema version.');
  }
  return migrateProjectToV3(structuredClone(snapshot));
}

function localReference(ref) {
  if (typeof ref !== 'string') return false;
  if (ref.startsWith(PREFIX) && !isStoredAudioAsset(ref)) throw new Error('Invalid BMAI audio asset reference.');
  return isStoredAudioAsset(ref) || ref.startsWith('blob:');
}

function referenceLocations(project) {
  const locations = [];
  for (const field of ['customSampleAssets', 'customSamples']) {
    const samples = project[field];
    if (samples === undefined) continue;
    if (!isObject(samples)) throw new Error(`Invalid project: ${field} must be an object.`);
    for (const [lane, ref] of Object.entries(samples)) {
      if (ref !== null && ref !== undefined && typeof ref !== 'string') throw new Error(`Invalid audio reference for ${lane}.`);
      if (localReference(ref)) locations.push({ owner: samples, key: lane, ref });
    }
  }
  if (project.vocals !== undefined) {
    if (!isObject(project.vocals)) throw new Error('Invalid project: vocals must be an object.');
    const ref = project.vocals.url;
    if (ref !== undefined && ref !== null && typeof ref !== 'string') throw new Error('Invalid vocal audio reference.');
    if (localReference(ref)) locations.push({ owner: project.vocals, key: 'url', ref });
  }
  if (project.vocalTakes !== undefined) {
    if (!Array.isArray(project.vocalTakes)) throw new Error('Invalid project: vocalTakes must be an array.');
    for (const take of project.vocalTakes) {
      if (!isObject(take) || typeof take.url !== 'string') throw new Error('Invalid vocal take.');
      if (localReference(take.url)) locations.push({ owner: take, key: 'url', ref: take.url });
    }
  }
  if (project.tracks !== undefined) {
    if (!Array.isArray(project.tracks)) throw new Error('Invalid project: tracks must be an array.');
    for (const track of project.tracks) {
      const sampler = track?.patch?.sampler;
      if (!sampler) continue;
      if (!isObject(sampler)) throw new Error('Invalid sampler patch.');
      if (sampler.url !== undefined && sampler.url !== null && typeof sampler.url !== 'string') throw new Error('Invalid sampler audio reference.');
      if (localReference(sampler.url)) locations.push({ owner: sampler, key: 'url', ref: sampler.url });
    }
  }
  return locations;
}

async function readLocalAsset(ref) {
  if (isStoredAudioAsset(ref)) {
    const asset = await readStoredAsset(ref);
    if (!asset) throw new Error('Project audio is missing from this browser. Import the original audio or a project file containing it.');
    return asset;
  }
  try {
    const response = await fetch(ref);
    if (!response.ok) throw new Error('The audio URL is unavailable');
    const blob = await response.blob();
    assertAudioBlob(blob);
    return { blob };
  } catch (error) {
    throw new Error('Audio from an earlier session is unavailable. Import the original audio file again.', { cause: error });
  }
}

function encodeBase64(bytes) {
  const parts = [];
  // A multiple of three avoids padding until the final chunk.
  for (let offset = 0; offset < bytes.length; offset += 24576) {
    parts.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24576))));
  }
  return parts.join('');
}

function embeddedByteLength(asset) {
  if (!isObject(asset) || typeof asset.base64 !== 'string') throw new Error('Invalid embedded audio data.');
  const encoded = asset.base64;
  if (encoded.length > Math.ceil(MAX_PROJECT_AUDIO_BYTES / 3) * 4) throw new Error('Project audio exceeds the 100 MB portable project limit.');
  if (!encoded.length || encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('Embedded audio contains invalid base64 data.');
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const bytes = encoded.length / 4 * 3 - padding;
  if (btoa(atob(encoded.slice(-4))) !== encoded.slice(-4)) throw new Error('Embedded audio contains invalid base64 data.');
  if (asset.byteLength !== undefined && asset.byteLength !== bytes) throw new Error('Embedded audio size does not match its data.');
  if (asset.mime !== undefined && (typeof asset.mime !== 'string' || asset.mime.length > 255 || /[^\x20-\x7e]/.test(asset.mime))) throw new Error('Invalid embedded audio MIME type.');
  if (asset.name !== undefined && (typeof asset.name !== 'string' || asset.name.length > 4096)) throw new Error('Invalid embedded audio filename.');
  return bytes;
}

function decodeAsset(asset, byteLength) {
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (let start = 0; start < asset.base64.length; start += 32768) {
    const chunk = atob(asset.base64.slice(start, start + 32768));
    for (let index = 0; index < chunk.length; index++) bytes[offset++] = chunk.charCodeAt(index);
  }
  return new Blob([bytes], { type: asset.mime || 'application/octet-stream' });
}

/** Make a portable JSON snapshot, including all imported samples and vocals. */
export async function packProjectAssets(snapshot) {
  const project = cloneProject(snapshot);
  const locations = referenceLocations(project);
  const assets = {};
  let totalBytes = 0;
  for (const ref of new Set(locations.map(location => location.ref))) {
    const { blob, name } = await readLocalAsset(ref);
    totalBytes += blob.size;
    if (totalBytes > MAX_PROJECT_AUDIO_BYTES) throw new Error('Project audio exceeds the 100 MB portable project limit.');
    assets[ref] = {
      base64: encodeBase64(new Uint8Array(await blob.arrayBuffer())),
      mime: blob.type || 'application/octet-stream',
      byteLength: blob.size,
      ...(typeof name === 'string' ? { name } : {})
    };
  }
  project.audioAssets = assets;
  return project;
}

/** Validate imported assets before writing any bytes or changing references. */
export async function hydrateProjectAssets(snapshot) {
  const project = cloneProject(snapshot);
  const locations = referenceLocations(project);
  const embedded = project.audioAssets ?? {};
  if (!isObject(embedded)) throw new Error('Invalid project: audioAssets must be an object.');
  const lengths = new Map();
  let totalBytes = 0;
  for (const [ref, asset] of Object.entries(embedded)) {
    if (!localReference(ref)) throw new Error('Invalid embedded audio reference.');
    const byteLength = embeddedByteLength(asset);
    totalBytes += byteLength;
    if (totalBytes > MAX_PROJECT_AUDIO_BYTES) throw new Error('Project audio exceeds the 100 MB portable project limit.');
    lengths.set(ref, byteLength);
  }
  const replacements = new Map();
  const writes = [];
  // Resolve every reference before the single write transaction, so a missing
  // asset cannot leave a partially imported project in the caller's state.
  for (const ref of new Set(locations.map(location => location.ref))) {
    if (lengths.has(ref)) {
      const nextRef = createReference();
      writes.push({ ref: nextRef, blob: decodeAsset(embedded[ref], lengths.get(ref)), name: embedded[ref].name });
      replacements.set(ref, nextRef);
    } else {
      const asset = await readLocalAsset(ref);
      if (!isStoredAudioAsset(ref)) {
        const nextRef = createReference();
        writes.push({ ref: nextRef, ...asset });
        replacements.set(ref, nextRef);
      }
    }
  }
  await writeAssets(writes);
  for (const { owner, key, ref } of locations) owner[key] = replacements.get(ref) || ref;
  delete project.audioAssets;
  return project;
}
