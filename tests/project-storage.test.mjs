import test from 'node:test';
import assert from 'node:assert/strict';
import { isStoredAudioAsset, storeAudioAsset, packProjectAssets, hydrateProjectAssets } from '../engine/project-storage.js';

const ref='bmai-asset:00000000-0000-4000-8000-000000000001';
test('persistent identifiers reject malformed lookalikes',()=>{
  assert.equal(isStoredAudioAsset(ref),true);
  for(const value of ['', 'kick.wav', 'bmai-asset:missing',null]) assert.equal(isStoredAudioAsset(value),false);
});
test('legacy blob audio is packaged once and source snapshots stay unchanged',async()=>{
  const bytes=new Uint8Array(Array.from({length:50000},(_,i)=>i%251));
  const url=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));
  try{
    const original={name:'Portable',customSampleAssets:{kick:url},customSamples:{kick:'custom.wav'},vocals:{url}};
    const before=structuredClone(original);
    const packed=await packProjectAssets(original);
    assert.deepEqual(original,before);
    assert.equal(packed.schemaVersion,3);
    assert.deepEqual(Object.keys(packed.audioAssets),[url]);
    assert.deepEqual(new Uint8Array(Buffer.from(packed.audioAssets[url].base64,'base64')),bytes);
    assert.equal(packed.audioAssets[url].byteLength,bytes.length);
  }finally{URL.revokeObjectURL(url);}
});
test('factory audio stays a reference and projects without user media need no database',async()=>{
  const value={vocals:{url:'/sounds/vocal.wav'},customSamples:{}};
  const result=await hydrateProjectAssets(await packProjectAssets(value));
  assert.equal(result.schemaVersion,3);
  assert.equal(result.vocals.url,'/sounds/vocal.wav');
  assert.ok(result.patterns);
  assert.ok(result.playlist);
});
test('damaged or incompatible embedded media is rejected before database writes',async()=>{
  for(const asset of [{base64:'###='},{base64:'YWJj',byteLength:5},{base64:'YQ==',mime:5},{base64:'YR=='}]) {
    await assert.rejects(hydrateProjectAssets({vocals:{url:ref},audioAssets:{[ref]:asset}}),/Invalid|invalid|size/);
  }
  await assert.rejects(hydrateProjectAssets({schemaVersion:99}),/unsupported/);
  await assert.rejects(hydrateProjectAssets({audioAssets:[]}),/audioAssets/);
});
test('unavailable storage or expired URLs never produce a fake complete backup',async()=>{
  await assert.rejects(storeAudioAsset(new Blob()),/empty/);
  await assert.rejects(storeAudioAsset(new Blob(['audio'])),/storage is unavailable/);
  await assert.rejects(packProjectAssets({vocals:{url:'blob:expired'}}),/earlier session/);
});
