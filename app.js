import { connectFxChain, channelAudibleGain } from './engine/track-fx-graph.js';
import { swingOffsetSeconds } from './engine/transport.js';
import { defaultGroupBuses } from './engine/pro-features.js';
import { DEFAULT_3XOSC_PATCH, synthesize3xOscNote } from './engine/synth-patch.js';
import { DEFAULT_ADSR, applyAdsrToGainParam } from './engine/adsr.js';
import { buildConstrainedPhrase, mergeLockedNotes, rewriteDrumLanes, chordPitchClasses, suggestLatencyOffsetMs } from './engine/generation.js';
import { STARTER_TEMPLATES } from './engine/starter-templates.js';
import { midiToPitch, parsePitchToMidi } from './engine/score-tools.js';
import { expandChordStamp } from './engine/chords.js';
import { freshSessionFields, ensureMix, rebuildClips, clipGainAt, automationGain, shiftSteps, GROUP_FOR } from './engine/song-session.js';
import { storeAudioAsset, resolveAudioAsset } from './engine/project-storage.js';
import { pushProjectVersion } from './engine/project-versions.js';
import { encodeWav, stereoWav } from './engine/wav.js';
import { encodeMidi } from './engine/midi-file.js';
import { renderSong } from './engine/offline-render.js';
import { calculateAudioPeaks, createZipArchive, generateSharePackReadme, sharePackStemName, resolveStemTracks } from './engine/export-tools.js';
import { estimateIntegratedLufs } from './engine/pro-features.js';
import { installProducer, renderProducer } from './producer.js';

const $=s=>document.querySelector(s), R=()=>Math.random(), clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const NAMES=['Kick','Snare','Hat'];
const DRUM_VEL=[0.95,0.8,0.55];
const PITCH_N=1024, PITCH_FFT=2048, PITCH_SR=11025;
const tune={rmsMin:0.02,clarityMin:0.62,octaveFold:10,octaveTol:3,medianN:5,minVotes:2};
const fftRe=new Float32Array(PITCH_FFT), fftIm=new Float32Array(PITCH_FFT), pitched=new Float32Array(PITCH_N);

// ---- Pitch detection: NSDF autocorrelation -> MIDI ----
function fftRadix2(re,im){
  const n=re.length;
  for(let i=1,j=0;i<n;i++){
    let bit=n>>1;
    for(;j&bit;bit>>=1)j^=bit;
    j^=bit;
    if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t}
  }
  for(let len=2;len<=n;len<<=1){
    const ang=-2*Math.PI/len, wRe=Math.cos(ang), wIm=Math.sin(ang), half=len>>1;
    for(let i=0;i<n;i+=len){
      let cRe=1,cIm=0;
      for(let k=0;k<half;k++){
        const tRe=re[i+k+half]*cRe-im[i+k+half]*cIm;
        const tIm=re[i+k+half]*cIm+im[i+k+half]*cRe;
        re[i+k+half]=re[i+k]-tRe; im[i+k+half]=im[i+k]-tIm;
        re[i+k]+=tRe; im[i+k]+=tIm;
        const nRe=cRe*wRe-cIm*wIm;
        cIm=cRe*wIm+cIm*wRe; cRe=nRe;
      }
    }
  }
}
function ifftRadix2(re,im){
  const n=re.length;
  for(let i=0;i<n;i++)im[i]=-im[i];
  fftRadix2(re,im);
  for(let i=0;i<n;i++){re[i]/=n;im[i]=-im[i]/n}
}
function nsdfCurve(x,n){
  fftRe.fill(0); fftIm.fill(0);
  for(let i=0;i<n;i++)fftRe[i]=x[i];
  fftRadix2(fftRe,fftIm);
  const N=fftRe.length;
  for(let i=0;i<N;i++){fftRe[i]=fftRe[i]*fftRe[i]+fftIm[i]*fftIm[i]; fftIm[i]=0}
  ifftRadix2(fftRe,fftIm);
  const prefix=new Float32Array(n+1);
  for(let i=0;i<n;i++)prefix[i+1]=prefix[i]+x[i]*x[i];
  const nsdf=new Float32Array(n);
  nsdf[0]=1;
  for(let lag=1;lag<n;lag++){
    const m=prefix[n-lag]+(prefix[n]-prefix[lag]);
    nsdf[lag]=m>1e-8?(2*fftRe[lag])/m:0;
  }
  return nsdf;
}
function chooseLag(nsdf,minLag,maxLag){
  const peaks=[];
  for(let lag=minLag;lag<maxLag;lag++){
    const v=nsdf[lag];
    if(v>0 && nsdf[lag-1]<v && v>=nsdf[lag+1])peaks.push(lag);
  }
  if(!peaks.length){
    let best=minLag,bestV=-1;
    for(let lag=minLag;lag<=maxLag;lag++)if(nsdf[lag]>bestV){bestV=nsdf[lag];best=lag}
    return best;
  }
  let maxPeak=peaks[0];
  peaks.forEach(l=>{if(nsdf[l]>nsdf[maxPeak])maxPeak=l});
  let lag=maxPeak;
  for(let k=0;k<3;k++){
    const half=Math.round(lag/2);
    if(half<minLag)break;
    let hv=-1,hl=half;
    const a=Math.max(minLag,half-3), b=Math.min(maxLag,half+3);
    for(let l=a;l<=b;l++)if(nsdf[l]>hv){hv=nsdf[l];hl=l}
    const local=hl>0 && hv>=nsdf[hl-1] && hv>=nsdf[Math.min(nsdf.length-1,hl+1)];
    if(local && hv>=nsdf[lag]*0.9)lag=hl; else break;
  }
  const floor=nsdf[maxPeak]*0.9;
  for(let i=0;i<peaks.length;i++)if(nsdf[peaks[i]]>=floor){if(peaks[i]<lag)lag=peaks[i]; break}
  return lag;
}
function refineLag(nsdf,lag,maxLag){
  if(lag<=0||lag>=maxLag)return lag;
  const a=nsdf[lag-1], b=nsdf[lag], g=nsdf[lag+1], den=a-2*b+g;
  if(!den)return lag;
  const p=0.5*(a-g)/den;
  return (p<-1||p>1)?lag:lag+p;
}
class PitchDetector{
  static detect(buf,sr,tuneNow){
    const n=buf.length;
    if(n<64)return{midi:null,clarity:0,rms:0,rejected:true};
    let e=0,mean=0;
    for(let i=0;i<n;i++){e+=buf[i]*buf[i]; mean+=buf[i]}
    const rms=Math.sqrt(e/n); mean/=n;
    if(rms<tuneNow.rmsMin)return{midi:null,clarity:0,rms,rejected:true};
    for(let i=0;i<n;i++){
      const w=0.5*(1-Math.cos((2*Math.PI*i)/(n-1)));
      pitched[i]=(buf[i]-mean)*w;
    }
    const nsdf=nsdfCurve(pitched,n);
    const minLag=Math.max(2,Math.floor(sr/1100)), maxLag=Math.min(n-2,Math.floor(sr/60));
    if(maxLag<=minLag)return{midi:null,clarity:0,rms,rejected:true};
    const lag=chooseLag(nsdf,minLag,maxLag);
    const refined=refineLag(nsdf,lag,maxLag);
    const clarity=nsdf[lag]||0;
    if(!(clarity>0.2)||!(refined>1))return{midi:null,clarity,rms,rejected:true};
    const hz=sr/refined;
    const midi=clamp(Math.round(69+12*Math.log2(hz/440)),36,84);
    return{midi,clarity,rms,rejected:clarity<tuneNow.clarityMin};
  }
}
function smoothFrames(frames,tuneNow){
  let stable=null;
  frames.forEach(f=>{
    f.octaveFixed=false;
    if(f.midiRaw==null&&f.midi!=null)f.midiRaw=f.midi;
    if(f.rejected||f.midi==null)return;
    if(stable!=null){
      const jump=f.midi-stable, ad=Math.abs(jump);
      if(ad>=tuneNow.octaveFold){
        const k=Math.round(jump/12);
        if(k!==0 && Math.abs(jump-k*12)<=tuneNow.octaveTol){
          f.midi=clamp(f.midi-k*12,36,84);
          f.octaveFixed=true;
        }
      }
    }
    if(stable==null||!f.octaveFixed)stable=f.midi;
  });
  const voiced=frames.filter(f=>!f.rejected&&f.midi!=null);
  let win=tuneNow.medianN|0;
  if(win<1)win=1;
  if(win%2===0)win+=1;
  const half=win>>1;
  const sm=voiced.map((_,i)=>{
    const bucket=[];
    for(let k=i-half;k<=i+half;k++){
      const j=Math.max(0,Math.min(voiced.length-1,k));
      bucket.push(voiced[j].midi);
    }
    bucket.sort((a,b)=>a-b);
    return bucket[bucket.length>>1];
  });
  voiced.forEach((f,i)=>{f.midiSmooth=sm[i]});
  frames.forEach(f=>{if(f.rejected||f.midi==null)f.midiSmooth=null});
}
function downsample(samples,sr,target){
  if(sr<=target*1.05)return{samples,sampleRate:sr};
  const ratio=sr/target, n=Math.floor(samples.length/ratio), out=new Float32Array(n);
  for(let i=0;i<n;i++){
    const a=Math.floor(i*ratio), b=Math.min(samples.length,Math.floor((i+1)*ratio));
    let s=0,c=0;
    for(let j=a;j<b;j++){s+=samples[j];c++}
    out[i]=c?s/c:0;
  }
  return{samples:out,sampleRate:target};
}

// ---- Audio engine: per-track gain + instruments ----
class Engine{
  constructor(){
    const ctx=Tone.getContext().rawContext;
    this.ctx=ctx;
    this.master=ctx.createGain();
    this.master.gain.value=0.92;
    this.master.connect(ctx.destination);
    this.analyser=ctx.createAnalyser();
    this.analyser.fftSize=2048;
    this.master.connect(this.analyser);
    this.groups={};
    ['drums','music','vocals'].forEach(id=>{
      const gain=ctx.createGain();
      gain.connect(this.master);
      this.groups[id]=gain;
    });
    this.reverbSend=roomSend(ctx,this.master);
    this.delaySend=echoSend(ctx,this.master);
    this.gains={};
    this.sends={};
    this._stops={};
    ['melody','drums','chords','bass','vocal'].forEach(type=>{
      this.gains[type]=ctx.createGain();
    });
    const hp=new Tone.Filter(7000,'highpass').connect(this.gains.drums);
    this.kick=new Tone.MembraneSynth().connect(this.gains.drums);
    this.snare=new Tone.NoiseSynth({envelope:{attack:.001,decay:.16,sustain:0}}).connect(this.gains.drums);
    this.hat=new Tone.NoiseSynth({envelope:{attack:.001,decay:.04,sustain:0}}).connect(hp);
    this.lead=new Tone.PolySynth(Tone.Synth,{oscillator:{type:'triangle'}}).connect(this.gains.melody);
    this.chordVoice=new Tone.PolySynth(Tone.Synth,{oscillator:{type:'triangle'}}).connect(this.gains.chords);
    this.bassVoice=new Tone.Synth({oscillator:{type:'sine'}}).connect(this.gains.bass);
    this.lead.volume.value=-8; this.hat.volume.value=-10; this.chordVoice.volume.value=-16; this.bassVoice.volume.value=-6;
    this.wire();
  }
  wire(){
    ['melody','drums','chords','bass','vocal'].forEach(type=>{
      const gain=this.gains[type];
      try{gain.disconnect()}catch(e){}
      if(this._stops[type])this._stops[type]();
      const track=song.track(type);
      const fx=connectFxChain(this.ctx,gain,(track&&track.fx)||[]);
      this._stops[type]=fx.stop;
      const group=(track&&track.group)||GROUP_FOR[type]||'music';
      fx.output.connect(this.groups[group]||this.groups.music);
      const send=this.ctx.createGain();
      send.gain.value=track?track.send||0:0;
      fx.output.connect(send);
      send.connect(this.reverbSend);
      const delay=this.ctx.createGain();
      delay.gain.value=track?track.delaySend||0:0;
      fx.output.connect(delay);
      delay.connect(this.delaySend);
      this.sends[type]={send,delay};
    });
    this.applyGroups();
  }
  applyGroups(){
    ['drums','music','vocals'].forEach(id=>{
      const bus=song.groups&&song.groups[id];
      this.groups[id].gain.value=!bus||bus.mute?0:(bus.vol==null?1:bus.vol);
    });
  }
  applySends(){
    song.tracks.forEach(track=>{
      const send=this.sends[track.type];
      if(!send)return;
      send.send.gain.value=track.send||0;
      send.delay.gain.value=track.delaySend||0;
    });
  }
  setGain(type,v){
    const track=song.track(type);
    if(!this.gains[type]||!track)return;
    const anySolo=song.tracks.some(item=>item.solo);
    this.gains[type].gain.value=channelAudibleGain({vol:v,mute:track.mute,solo:track.solo,anySolo,automation:1});
  }
  peak(){
    const data=new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);
    let peak=0;
    for(let i=0;i<data.length;i++)peak=Math.max(peak,Math.abs(data[i]));
    return peak;
  }
  drum(i,t,v){
    if(i==0){
      this.kick.triggerAttackRelease('C1','8n',t,v);
      if(song.duck){
        const gain=this.groups.music.gain;
        const rest=song.groups.music.mute?0:song.groups.music.vol;
        gain.cancelScheduledValues(t);
        gain.setValueAtTime(rest,t);
        gain.linearRampToValueAtTime(rest*0.35,t+0.015);
        gain.linearRampToValueAtTime(rest,t+0.2);
      }
    }
    if(i==1)this.snare.triggerAttackRelease('16n',t,v);
    if(i>=2)this.hat.triggerAttackRelease('32n',t,v);
  }
  note(m,dur,t,v){
    if(song.useLayer){
      const freq=Tone.Frequency(m,'midi').toFrequency();
      const voice=this.ctx.createGain();
      applyAdsrToGainParam(voice.gain,song.adsr,t,dur,Math.max(0.05,v)*0.35);
      voice.connect(this.gains.melody);
      synthesize3xOscNote(this.ctx,freq,dur,song.patch,t,voice);
      return;
    }
    this.lead.triggerAttackRelease(Tone.Frequency(m,'midi'),dur,t,v);
  }
  chord(midis,dur,t,v){if(midis.length)this.chordVoice.triggerAttackRelease(midis.map(m=>Tone.Frequency(m,'midi')),dur,t,v)}
  bass(m,dur,t,v){this.bassVoice.triggerAttackRelease(Tone.Frequency(m,'midi'),dur,t,v)}
}
function roomSend(ctx,dest){
  const input=ctx.createGain();
  const conv=ctx.createConvolver();
  const length=Math.floor(ctx.sampleRate*1.1);
  const impulse=ctx.createBuffer(2,length,ctx.sampleRate);
  for(let channel=0;channel<2;channel++){
    const data=impulse.getChannelData(channel);
    for(let i=0;i<length;i++)data[i]=(Math.random()*2-1)*Math.pow(1-i/length,2.5);
  }
  conv.buffer=impulse;
  const wet=ctx.createGain();
  wet.gain.value=0.85;
  input.connect(conv); conv.connect(wet); wet.connect(dest);
  return input;
}
function echoSend(ctx,dest){
  const input=ctx.createGain();
  const delay=ctx.createDelay(1.2);
  delay.delayTime.value=0.28;
  const feedback=ctx.createGain();
  feedback.gain.value=0.32;
  const wet=ctx.createGain();
  wet.gain.value=0.8;
  input.connect(delay); delay.connect(feedback); feedback.connect(delay); delay.connect(wet); wet.connect(dest);
  return input;
}

// ---- Humanizer: swing, velocity floats, micro timing ----
class Humanizer{
  constructor(){this.on=true;this.swing=.3;this.vel=.25;this.drift=8}
  apply(step,t,base){
    if(!this.on)return{t,v:base};
    const sw=swingOffsetSeconds(step,Tone.Transport.bpm.value,this.swing*100);
    const jit=(R()*2-1)*this.drift/1000;
    return{t:t+sw+jit,v:clamp(base*(1+(R()*2-1)*this.vel),.05,1)};
  }
}

// ---- Tracks: melody notes and drum hits, with mix state ----
function defaultDrumNotes(){
  const spec=[[0,8,10],[4,12],[0,2,4,6,8,10,12,14]], notes=[];
  spec.forEach((steps,lane)=>steps.forEach(step=>notes.push({step,lane,len:1,vel:DRUM_VEL[lane]})));
  return notes;
}
function gridToNotes(rows){
  const notes=[];
  (rows||[]).forEach((row,lane)=>(row||[]).forEach((on,step)=>{if(on)notes.push({step,lane,len:1,vel:DRUM_VEL[lane]||0.7})}));
  return notes;
}
function drumLoop(){return Math.max(16,(song.drumBars||1)*16)}
function laneName(index){return (song.laneNames&&song.laneNames[index])||NAMES[index]||('Lane '+(index+1))}
function notesToGrid(notes,steps){
  const width=steps||16;
  const maxLane=(notes||[]).reduce((max,note)=>note.lane==null?max:Math.max(max,note.lane),2);
  const rows=Array.from({length:maxLane+1},()=>Array(width).fill(0));
  (notes||[]).forEach(n=>{
    if(n.fill||n.lane==null||n.lane<0)return;
    const s=n.step|0;
    if(s>=0&&s<width&&rows[n.lane])rows[n.lane][s]=1;
  });
  return rows;
}
function hitsFromMelody(notes){
  const list=(notes||[]).filter(n=>n&&n.step>=0);
  if(!list.length)return [];
  const once=list.some(n=>n.step>=16);
  const seen=new Set(), hits=[];
  list.forEach(n=>{
    const step=n.step|0;
    const lane=(step%16===0)?0:(n.len>=2?1:2);
    const key=step+':'+lane;
    if(seen.has(key))return;
    seen.add(key);
    const hit={step,lane,len:1,vel:DRUM_VEL[lane]||0.7};
    if(once)hit.once=true;
    hits.push(hit);
  });
  return hits;
}
function defaultSections(){
  return[{name:'Intro',bars:2},{name:'Verse',bars:2},{name:'Chorus',bars:2},{name:'Outro',bars:2}];
}
function blankTrack(id,name,type,volume,notes){
  return ensureMix({id,name,type,notes:notes||[],volume,mute:false,solo:false,fx:[],send:0,delaySend:0,group:GROUP_FOR[type]||'music'});
}
class Song{
  constructor(){
    this.tracks=[
      blankTrack('mel','Sound','melody',0.8),
      blankTrack('drm','Beat','drums',0.9,defaultDrumNotes()),
      blankTrack('ch','Chords','chords',0.55),
      blankTrack('bas','Bass','bass',0.75),
      blankTrack('vox','Vocal','vocal',0.9)
    ];
    this.bars=8;
    this.slots=['drums','drums','both','both','both','both','melody','drums'];
    this.sections=defaultSections();
    this.cycle=['off','drums','melody','both'];
    this.osc='triangle'; this.trans=0;
    this.root=0; this.scale='major'; this.voice='take';
    this.motif=[];
    this.groups=defaultGroupBuses();
    this.duck=false;
    this.useLayer=false;
    this.patch=structuredClone(DEFAULT_3XOSC_PATCH);
    this.adsr=structuredClone(DEFAULT_ADSR);
    this.laneNames=['Kick','Snare','Hat'];
    this.drumBars=1;
    this.choke={2:1};
    this.automation={};
    this.clips=[];
    this.latencyOffsetMs=0;
    this.audioRef=null;
    freshSessionFields(this);
  }
  bump(i){this.slots[i]=this.cycle[(this.cycle.indexOf(this.slots[i])+1)%4]; this.clips=rebuildClips(this.slots)}
  track(type){return this.tracks.find(t=>t.type===type)}
  audible(t){
    if(!t||t.mute)return false;
    const soloed=this.tracks.some(x=>x.solo);
    return !soloed||t.solo;
  }
}
function songSteps(){return Math.max(16,(song.bars||8)*16)}
function melodyNotes(){const t=song.track('melody'); return t?t.notes:[]}
function ensureTracks(tracks){
  const need=[['chords','Chords','ch',0.55],['bass','Bass','bas',0.75],['vocal','Vocal','vox',0.9]];
  need.forEach(([type,name,id,vol])=>{
    if(!tracks.some(t=>t.type===type))tracks.push(blankTrack(id,name,type,vol));
  });
  tracks.forEach(ensureMix);
  return tracks;
}
function setDrumStep(lane,step,on){
  const notes=song.track('drums').notes;
  const once=notes.some(n=>n.once);
  const i=notes.findIndex(n=>!n.fill&&!!n.once===once&&n.lane===lane&&n.step===step);
  if(on&&i<0){
    const hit={step,lane,len:1,vel:DRUM_VEL[lane]||0.7,nudge:0};
    if(once)hit.once=true;
    notes.push(hit);
  }else if(!on&&i>=0)notes.splice(i,1);
}
function fitSections(n){
  const names=(song.sections&&song.sections.length)?song.sections.map(s=>s.name):['Intro','Verse','Chorus','Outro'];
  const k=names.length, base=Math.floor(n/k);
  let rem=n-base*k;
  song.sections=names.map(name=>{
    const bars=base+(rem>0?1:0);
    if(rem>0)rem--;
    return{name,bars};
  }).filter(s=>s.bars>0);
}
function trimToBars(){
  const max=songSteps();
  song.tracks.forEach(t=>{
    if(t.type==='drums')t.notes=t.notes.filter(n=>!n.fill||n.step<max);
    else{
      t.notes=t.notes.filter(n=>n.step<max);
      t.notes.forEach(n=>{if(n.step+n.len>max)n.len=max-n.step});
    }
  });
}
function setBars(n,opts){
  opts=opts||{};
  n=clamp(Math.round(+n||8),4,32);
  song.bars=n;
  if(!opts.keepSlots){
    while(song.slots.length<n)song.slots.push(song.slots.length<2?'drums':'both');
    if(song.slots.length>n)song.slots.length=n;
    trimToBars();
  }
  if(opts.sections)song.sections=opts.sections;
  else fitSections(n);
  const label=$('#barsV'); if(label)label.textContent=n+' bars';
  const input=$('#bars'); if(input&&+input.value!==n)input.value=n;
  buildSections(); buildSlots();
  if(!opts.keepClips)song.clips=rebuildClips(song.slots);
}

const song=new Song(), eng=new Engine(), hum=new Humanizer();
let step=0, started=false, playing=false, countingIn=false;
let lastFrames=[], lastPcm=null, analyzeGen=0, resultReady=false, accepted=false;
let audition=null, previewWhich=-1, previews=[], vocalAudio=null, rollDrag=null;
let undoStack=[], redoStack=[];
let countInToken=0, endCountIn=null, session=null;

function tick(time){
  if(countingIn)return;
  const total=songSteps();
  if(step>=total)step=0;
  const bar=Math.floor(step/16), slot=audition?'both':(song.slots[bar]||'off');
  const playMel=slot=='melody'||slot=='both', playDrm=slot=='drums'||slot=='both';
  const sd=Tone.Time('16n').toSeconds();
  const melNotes=audition?audition.melody:melodyNotes();
  const drmNotes=audition?audition.drums:song.track('drums').notes;
  const chNotes=audition?audition.chords:song.track('chords').notes;
  const bsNotes=audition?audition.bass:song.track('bass').notes;
  if(playDrm&&(audition||song.audible(song.track('drums')))){
    const loop=audition?16:drumLoop();
    const due=drmNotes.filter(n=>((n.fill||n.once)?n.step===step:n.step===(step%loop)));
    const kept=chokeHits(due,audition?{}:song.choke);
    const scale=audition?1:clipGainAt(song.clips,'drums',bar)*automationGain(song.automation.drums,bar,song.bars);
    kept.forEach(n=>{
      const h=hum.apply(step,time,(n.vel==null?0.8:n.vel)*scale);
      h.t+=(n.nudge||0)*sd*0.5;
      eng.drum(n.lane,h.t,h.v);
    });
  }
  if(playMel&&(audition||song.audible(song.track('melody')))){
    melNotes.forEach(n=>{
      if(n.step!==step)return;
      const sung=song.voice==='take'&&vocalAudio&&grainFor(n)&&(audition||song.audible(song.track('vocal')));
      if(sung)return;
      const h=hum.apply(step,time,(n.vel==null?0.7:n.vel)*(audition?1:clipGainAt(song.clips,'melody',bar)*automationGain(song.automation.melody,bar,song.bars)));
      eng.note(n.midi+(song.trans||0),n.len*sd*.95,h.t,h.v);
    });
  }
  if(playMel&&(audition||song.audible(song.track('vocal')))){
    melNotes.forEach(n=>{
      if(n.step!==step)return;
      playVocal(n,time,n.vel==null?0.8:n.vel);
    });
  }
  if(playMel&&(audition||song.audible(song.track('chords')))){
    const hits=chNotes.filter(n=>n.step===step);
    if(hits.length){
      const h=hum.apply(step,time,hits[0].vel==null?0.45:hits[0].vel);
      eng.chord(hits.map(n=>n.midi),hits[0].len*sd*.95,h.t,h.v);
    }
  }
  if(playMel&&(audition||song.audible(song.track('bass')))){
    bsNotes.forEach(n=>{
      if(n.step!==step)return;
      const h=hum.apply(step,time,n.vel==null?0.75:n.vel);
      eng.bass(n.midi,n.len*sd*.9,h.t,h.v);
    });
  }
  const cur=step;
  Tone.Draw.schedule(()=>mark(cur),time);
  step++;
}
Tone.Transport.scheduleRepeat(tick,'16n');

function applyTrackGains(){song.tracks.forEach(t=>eng.setGain(t.type,t.volume)); eng.applyGroups(); eng.applySends()}
function chokeHits(hits,choke){
  const plain=[], grouped={};
  (hits||[]).forEach(note=>{
    const group=choke&&choke[note.lane];
    if(group==null)plain.push(note);
    else if(!grouped[group]||note.lane>grouped[group].lane)grouped[group]=note;
  });
  return plain.concat(Object.values(grouped));
}
function setBpm(v){
  v=clamp(Math.round(+v||100),60,160);
  Tone.Transport.bpm.value=v;
  const b=$('#bpm'), r=$('#recBpm');
  if(b&&+b.value!==v)b.value=v;
  if(r&&+r.value!==v)r.value=v;
  if($('#bpmV'))$('#bpmV').textContent=v+' BPM';
  if($('#recBpmV'))$('#recBpmV').textContent=v+' BPM';
}

// ---- UI ----
function buildGrid(){
  const g=$('#grid'); g.innerHTML='';
  const steps=drumLoop();
  const rows=notesToGrid(song.track('drums').notes,steps);
  const lanes=Math.max(rows.length,(song.laneNames&&song.laneNames.length)||0,3);
  while(rows.length<lanes)rows.push(Array(steps).fill(0));
  rows.forEach((row,r)=>{
    const d=document.createElement('div'); d.className='row';
    d.innerHTML=`<span>${laneName(r)}</span><div class="steps"></div>`;
    row.forEach((on,i)=>{
      const b=document.createElement('button'); b.className='st'+(on?' on':'');
      b.setAttribute('aria-label',`${laneName(r)} step ${i+1}`);
      b.onclick=()=>{
        const next=!b.classList.contains('on');
        setDrumStep(r,i,next);
        b.classList.toggle('on',next);
        logEdit('drum');
      };
      d.lastChild.appendChild(b);
    });
    g.appendChild(d);
  });
}
function buildSections(){
  const w=$('#secNames'); if(!w)return;
  w.innerHTML='';
  const cols=`repeat(${song.bars}, minmax(72px, 1fr))`;
  w.style.gridTemplateColumns=cols;
  w.style.minWidth=(song.bars*76)+'px';
  song.sections.forEach((sec,i)=>{
    const inp=document.createElement('input');
    inp.value=sec.name;
    inp.setAttribute('aria-label','Section '+(i+1));
    inp.style.gridColumn='span '+sec.bars;
    inp.oninput=()=>{sec.name=inp.value};
    inp.onchange=()=>logEdit('section');
    w.appendChild(inp);
  });
}
function buildSlots(){
  const w=$('#slots'); w.innerHTML='';
  w.style.gridTemplateColumns=`repeat(${song.bars}, minmax(72px, 1fr))`;
  w.style.minWidth=(song.bars*76)+'px';
  song.slots.forEach((s,i)=>{
    const b=document.createElement('button'); b.className='slot '+s;
    b.innerHTML=`<b>Bar ${i+1}</b><small>${s=='off'?'empty':s=='melody'?'sound':s}</small>`;
    b.onclick=()=>{song.bump(i); buildSlots(); logEdit('slot')};
    w.appendChild(b);
  });
}
const rangeValueDesc=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
const TRACK_GAIN={melody:0.8,drums:0.9,chords:0.55,bass:0.75,vocal:0.9};
function rangeStep(input){
  const raw=input.dataset.step;
  if(raw==null||raw===''||raw==='any')return 1;
  const n=+raw;
  return n>0?n:1;
}
function stepDecimals(step){
  const s=String(step), exp=s.indexOf('e-');
  if(exp>=0)return (s.slice(0,exp).split('.')[1]||'').length+(+s.slice(exp+2));
  const dot=s.indexOf('.');
  return dot<0?0:s.length-dot-1;
}
function snapTo(min,max,step,value){
  let v=+value;
  if(!isFinite(v))v=min;
  v=Math.min(max,Math.max(min,v));
  if(!(step>0))return v;
  v=+(min+Math.round((v-min)/step)*step).toFixed(stepDecimals(step));
  return Math.min(max,Math.max(min,v));
}
function valueToT(input,value){
  const min=+input.min, max=+input.max;
  const u=(Math.min(max,Math.max(min,+value))-min)/((max-min)||1);
  return input.dataset.law==='audio'?Math.sqrt(Math.min(1,Math.max(0,u))):u;
}
function tToValue(input,t){
  const min=+input.min, max=+input.max;
  const u=input.dataset.law==='audio'?Math.min(1,Math.max(0,t))**2:Math.min(1,Math.max(0,t));
  return min+u*(max-min);
}
function gainLabel(g){
  if(!(g>0.0001))return '−∞';
  const db=20*Math.log10(g);
  return (db<0?'−':'')+Math.abs(db).toFixed(1)+' dB';
}
function paintFader(input){
  const fader=input.closest('.fader');
  if(!fader)return;
  const raw=+rangeValueDesc.get.call(input);
  fader.style.setProperty('--t',String(valueToT(input,raw)));
  if(input.dataset.law!=='audio')return;
  const text=gainLabel(raw);
  input.setAttribute('aria-valuetext',text);
  const db=fader.nextElementSibling;
  if(db&&db.classList.contains('db'))db.textContent=text;
}
function commitFader(input,value,quantum){
  const step=quantum||rangeStep(input);
  const next=snapTo(+input.min,+input.max,step,value);
  const prev=+rangeValueDesc.get.call(input);
  if(Math.abs(prev-next)<=Math.max(step,1)*1e-6)return false;
  input.value=String(next);
  input.dispatchEvent(new Event('input',{bubbles:true}));
  return true;
}
function mountFader(input){
  if(!input)return;
  if(input.closest('.fader')){paintFader(input);return}
  if(!('step' in input.dataset))input.dataset.step=input.hasAttribute('step')?input.getAttribute('step'):'';
  const kept=input.value;
  input.step='any';
  rangeValueDesc.set.call(input,kept);
  const fader=document.createElement('span');
  fader.className='fader';
  const slot=document.createElement('span');
  slot.className='fader-slot';
  const fill=document.createElement('span');
  fill.className='fader-fill';
  slot.appendChild(fill);
  const cap=document.createElement('span');
  cap.className='fader-cap';
  cap.setAttribute('aria-hidden','true');
  input.parentNode.insertBefore(fader,input);
  fader.append(slot,cap,input);
  const step=rangeStep(input), min=+input.min, max=+input.max;
  const positions=Math.round((max-min)/step)+1;
  if(positions>=2&&positions<=9){
    fader.classList.add('has-ticks');
    const ticks=document.createElement('span');
    ticks.className='fader-ticks';
    ticks.setAttribute('aria-hidden','true');
    for(let i=0;i<positions;i++){
      const tick=document.createElement('i');
      tick.style.left=(i/(positions-1)*100)+'%';
      ticks.appendChild(tick);
    }
    fader.appendChild(ticks);
  }
  Object.defineProperty(input,'value',{
    configurable:true,
    get(){return rangeValueDesc.get.call(this)},
    set(v){rangeValueDesc.set.call(this,v); paintFader(this)}
  });
  let keyDirty=false;
  fader.addEventListener('pointerdown',e=>{
    if(e.button!=null&&e.button!==0)return;
    input.focus({preventScroll:true});
    const tOf=ev=>{
      const r=slot.getBoundingClientRect();
      return r.width?Math.min(1,Math.max(0,(ev.clientX-r.left)/r.width)):0;
    };
    let anchorPointer=tOf(e), fine=!!e.shiftKey, dirty=false;
    fader.classList.add('drag');
    if(commitFader(input,tToValue(input,anchorPointer)))dirty=true;
    let anchorT=valueToT(input,+rangeValueDesc.get.call(input));
    const move=ev=>{
      const now=tOf(ev);
      if(!!ev.shiftKey!==fine){
        fine=!!ev.shiftKey;
        anchorPointer=now;
        anchorT=valueToT(input,+rangeValueDesc.get.call(input));
      }
      const t=fine?anchorT+(now-anchorPointer)*0.25:now;
      if(commitFader(input,tToValue(input,t)))dirty=true;
    };
    const up=()=>{
      fader.classList.remove('drag');
      try{if(fader.hasPointerCapture(e.pointerId))fader.releasePointerCapture(e.pointerId)}catch(err){}
      fader.removeEventListener('pointermove',move);
      fader.removeEventListener('pointerup',up);
      fader.removeEventListener('pointercancel',up);
      if(dirty)input.dispatchEvent(new Event('change',{bubbles:true}));
    };
    try{fader.setPointerCapture(e.pointerId)}catch(err){}
    fader.addEventListener('pointermove',move);
    fader.addEventListener('pointerup',up);
    fader.addEventListener('pointercancel',up);
  });
  fader.addEventListener('dblclick',e=>{
    e.preventDefault();
    const fallback=input.defaultValue===''?+input.min:+input.defaultValue;
    if(commitFader(input,fallback))input.dispatchEvent(new Event('change',{bubbles:true}));
  });
  input.addEventListener('keydown',e=>{
    const quantumStep=rangeStep(input);
    const integer=Number.isInteger(quantumStep);
    let next=null, quantum=null;
    if(e.key==='Home')next=+input.min;
    else if(e.key==='End')next=+input.max;
    else if(e.key==='ArrowLeft'||e.key==='ArrowDown'||e.key==='ArrowRight'||e.key==='ArrowUp'){
      const dir=(e.key==='ArrowLeft'||e.key==='ArrowDown')?-1:1;
      quantum=(!integer&&e.shiftKey)?quantumStep/10:quantumStep;
      next=+rangeValueDesc.get.call(input)+dir*quantum;
    }else return;
    e.preventDefault();
    if(commitFader(input,next,quantum))keyDirty=true;
  });
  input.addEventListener('keyup',e=>{
    if(!keyDirty)return;
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].indexOf(e.key)<0)return;
    keyDirty=false;
    input.dispatchEvent(new Event('change',{bubbles:true}));
  });
  paintFader(input);
}
function mountFaders(root){(root||document).querySelectorAll('input[type=range]').forEach(mountFader)}
function buildTrackStrip(){
  const w=$('#trackStrip'); w.innerHTML='';
  song.tracks.forEach(t=>{
    const row=document.createElement('div'); row.className='trow';
    row.innerHTML='<b></b><input type="range" min="0" max="1" step="0.01" data-law="audio"><span class="db"></span><button type="button" class="ms" data-k="mute">M</button><button type="button" class="ms" data-k="solo">S</button>';
    row.querySelector('b').textContent=t.name;
    const sl=row.querySelector('input');
    sl.defaultValue=String(TRACK_GAIN[t.type]!=null?TRACK_GAIN[t.type]:t.volume);
    sl.value=t.volume;
    sl.setAttribute('aria-label',t.name+' volume');
    mountFader(sl);
    sl.oninput=()=>{t.volume=+sl.value; applyTrackGains()};
    sl.onchange=()=>logEdit('volume');
    const mute=row.querySelector('[data-k=mute]'), solo=row.querySelector('[data-k=solo]');
    const paint=()=>{
      mute.classList.toggle('on',t.mute); mute.setAttribute('aria-pressed',t.mute);
      solo.classList.toggle('on',t.solo); solo.setAttribute('aria-pressed',t.solo);
    };
    mute.onclick=()=>{t.mute=!t.mute; paint(); logEdit('mute')};
    solo.onclick=()=>{t.solo=!t.solo; paint(); logEdit('solo')};
    paint();
    w.appendChild(row);
  });
}
function mark(cur){
  const total=songSteps(), s=cur%16, bar=Math.floor(cur/16);
  document.querySelectorAll('.st.now').forEach(e=>e.classList.remove('now'));
  document.querySelectorAll('.row').forEach(r=>{const cell=r.querySelectorAll('.st')[s]; if(cell)cell.classList.add('now')});
  document.querySelectorAll('.slot').forEach((e,i)=>e.classList.toggle('now',i==bar));
  drawRoll(cur);
  $('#lab').textContent='bar '+(bar+1)+' / '+song.bars;
  $('#ringp').setAttribute('stroke-dashoffset',100-(cur%total)/total*100);
}
function rollSpan(notes, lock){
  const ms=notes.map(n=>n.midi);
  const lo=lock?lock.lo:Math.min(...ms)-2;
  const hi=lock?lock.hi:Math.max(...ms)+2;
  const span=lock?lock.span:Math.max(hi-lo,8);
  return{lo,span};
}
function noteAtPoint(clientX, clientY){
  const c=$('#roll'), rect=c.getBoundingClientRect();
  const notes=melodyNotes();
  if(!rect.width||!notes.length)return null;
  const steps=songSteps();
  const st=(clientX-rect.left)/rect.width*steps;
  const g=rollSpan(notes, rollDrag&&rollDrag.lock);
  const midi=g.lo-1+(1-(clientY-rect.top)/rect.height)*g.span;
  const hits=notes.filter(n=>st>=n.step&&st<n.step+n.len);
  if(!hits.length)return null;
  hits.sort((a,b)=>Math.abs(a.midi-midi)-Math.abs(b.midi-midi));
  return hits[0];
}
function snapshotNotes(){
  return{
    melody:melodyNotes().map(n=>Object.assign({},n)),
    drums:song.track('drums').notes.map(n=>Object.assign({},n))
  };
}
function pushUndo(){
  undoStack.push(snapshotNotes());
  if(undoStack.length>50)undoStack.shift();
  redoStack=[];
}
function restoreSnap(s){
  if(wordEdit){wordEdit.onblur=null; wordEdit.remove(); wordEdit=null}
  song.track('melody').notes=s.melody.map(n=>Object.assign({},n));
  song.track('drums').notes=s.drums.map(n=>Object.assign({},n));
  buildGrid(); drawRoll(null);
}
function undoEdit(){
  if(!undoStack.length)return;
  redoStack.push(snapshotNotes());
  restoreSnap(undoStack.pop());
}
function redoEdit(){
  if(!redoStack.length)return;
  undoStack.push(snapshotNotes());
  restoreSnap(redoStack.pop());
}
function drawRoll(ph){
  const c=$('#roll'); if(!c)return;
  const lock=rollDrag&&rollDrag.lock;
  const steps=songSteps(), px=Math.max(10,Math.min(18,Math.floor(1400/steps)));
  c.width=steps*px; c.height=340; c.style.width=(steps*px)+'px'; c.style.height='170px';
  const x=c.getContext('2d'), W=c.width, H=c.height, cs=getComputedStyle(document.documentElement);
  const notes=melodyNotes();
  x.clearRect(0,0,W,H);
  x.strokeStyle=cs.getPropertyValue('--line');
  for(let i=0;i<=steps;i+=4){x.beginPath();x.moveTo(i*W/steps,0);x.lineTo(i*W/steps,H);x.stroke()}
  if(notes.length){
    const g=rollSpan(notes, lock), lo=g.lo, span=g.span;
    notes.forEach(n=>{
      const nx=n.step*W/steps+1, ny=H-((n.midi-lo+1)/span)*H, nw=Math.max(n.len*W/steps-2,2), nh=Math.max(H/span-2,4);
      x.fillStyle=cs.getPropertyValue('--mel');
      x.fillRect(nx,ny,nw,nh);
      if(n.word){
        x.fillStyle=cs.getPropertyValue('--ink');
        x.font='12px "JetBrains Mono",monospace';
        x.fillText(n.word,nx+2,Math.max(14,ny-4));
      }
    });
  }
  if(ph!=null){x.fillStyle=cs.getPropertyValue('--drum');x.globalAlpha=.85;x.fillRect(ph*W/steps,0,2,H);x.globalAlpha=1}
}
function drawPitchDebug(){
  const c=$('#pitchDbg'); if(!c)return;
  const x=c.getContext('2d'), W=c.width, H=c.height, cs=getComputedStyle(document.documentElement);
  const ink=(cs.getPropertyValue('--ink')||'#0a0a0a').trim();
  const mut=(cs.getPropertyValue('--mut')||'#8a8a8f').trim();
  const drum=(cs.getPropertyValue('--drum')||'#d6303a').trim();
  const line=(cs.getPropertyValue('--line')||'#ececec').trim();
  x.clearRect(0,0,W,H);
  const notes=melodyNotes();
  if(!lastFrames.length&&!notes.length){
    x.fillStyle=mut; x.font='14px "JetBrains Mono",monospace';
    x.fillText('Upload or record to see pitch over time.',16,32);
    return;
  }
  const bpm=+$('#bpm').value||100, per=60/bpm/4;
  const dur=lastFrames.length?Math.max(lastFrames[lastFrames.length-1].t,0.01):(notes.length?songSteps()*per:1);
  const mids=[];
  lastFrames.forEach(f=>{if(f.midiRaw!=null)mids.push(f.midiRaw); if(f.midiSmooth!=null)mids.push(f.midiSmooth)});
  notes.forEach(n=>mids.push(n.midi));
  let lo=mids.length?Math.min.apply(null,mids)-2:48, hi=mids.length?Math.max.apply(null,mids)+2:72;
  if(hi-lo<12){lo-=4; hi+=4}
  const yOf=m=>H-((m-lo)/(hi-lo))*(H-16)-8;
  const xOf=t=>(t/dur)*W;
  x.strokeStyle=line; x.beginPath();
  for(let m=Math.ceil(lo);m<=hi;m+=2){const y=yOf(m); x.moveTo(0,y); x.lineTo(W,y)}
  x.stroke();
  x.globalAlpha=.18; x.fillStyle=ink;
  notes.forEach(n=>{
    const x0=xOf(n.step*per), x1=xOf((n.step+n.len)*per);
    const y0=yOf(n.midi+0.45), y1=yOf(n.midi-0.45);
    x.fillRect(x0,y0,Math.max(2,x1-x0),Math.max(3,y1-y0));
  });
  x.globalAlpha=1;
  lastFrames.forEach(f=>{
    if(f.midiRaw==null)return;
    x.beginPath();
    x.fillStyle=f.rejected?mut:ink;
    x.arc(xOf(f.t),yOf(f.midiRaw),f.rejected?1.6:2.3,0,Math.PI*2);
    x.fill();
    if(f.octaveFixed){
      x.beginPath(); x.strokeStyle=drum; x.lineWidth=1.5;
      x.arc(xOf(f.t),yOf(f.midi),4.5,0,Math.PI*2); x.stroke();
    }
  });
  x.beginPath(); x.strokeStyle=drum; x.lineWidth=1.25;
  let pen=false;
  lastFrames.forEach(f=>{
    if(f.midiSmooth==null){pen=false; return}
    const X=xOf(f.t), Y=yOf(f.midiSmooth);
    if(!pen){x.moveTo(X,Y); pen=true} else x.lineTo(X,Y);
  });
  x.stroke();
}
function drawMini(cv,clip,drums,mode){
  const x=cv.getContext('2d'), W=cv.width, H=cv.height, cs=getComputedStyle(document.documentElement); x.clearRect(0,0,W,H);
  const end=Math.max(32,(clip||[]).reduce((m,n)=>Math.max(m,(n.step||0)+(n.len||1)),0));
  if(mode!='beat'&&clip.length){const ms=clip.map(n=>n.midi), lo=Math.min(...ms)-1, span=Math.max(Math.max(...ms)+1-lo,6), h=mode=='both'?H*.6:H;
    x.fillStyle=cs.getPropertyValue('--mel'); clip.forEach(n=>x.fillRect(n.step*W/end+1,h-((n.midi-lo+1)/span)*h,Math.max(n.len*W/end-2,2),Math.max(h/span-1,2)))}
  if(mode!='notes'){const y0=mode=='both'?H*.68:6, rh=(H-y0-6)/3; x.fillStyle=cs.getPropertyValue('--drum');
    drums.forEach((r,i)=>r.forEach((v,k)=>{if(v)x.fillRect(k*W/16+1,y0+i*rh,W/16-3,rh-3)}))}
}
function refreshSplitCards(){
  if(!$('#v-split').classList.contains('on'))return;
  const mel=melodyNotes(), grid=notesToGrid(song.track('drums').notes);
  drawMini($('#cS'),mel,grid,'notes');
  $('#mS').textContent=mel.length+' notes';
  drawMini($('#cB'),mel,grid,'beat');
  $('#mB').textContent=$('#bpm').value+' BPM, '+grid.flat().filter(Boolean).length+' hits';
}

// ---- Producer log ----
const LOG_KEY='awd_producer_log';
let plog={events:[]};
try{const saved=JSON.parse(localStorage.getItem(LOG_KEY)||'null'); if(saved&&Array.isArray(saved.events))plog=saved}catch(e){plog={events:[]}}
function logEvent(type,extra){
  plog.events.push(Object.assign({t:Date.now(),type},extra||{}));
  if(plog.events.length>1000)plog.events.splice(0,plog.events.length-1000);
  try{localStorage.setItem(LOG_KEY,JSON.stringify(plog))}catch(e){}
  renderLog();
}
function logEdit(target){logEvent('edit',{target})}
function median(nums){
  if(!nums.length)return null;
  const a=nums.slice().sort((x,y)=>x-y), m=a.length>>1;
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function renderLog(){
  const el=$('#plogStats'); if(!el)return;
  const ev=plog.events;
  const accepts=ev.filter(e=>e.type==='accept').length;
  const regens=ev.filter(e=>e.type==='regenerate').length;
  const edits=ev.filter(e=>e.type==='edit').length;
  const firsts=ev.filter(e=>e.type==='firstSound'&&typeof e.ms==='number').map(e=>e.ms);
  const med=median(firsts);
  const rate=(accepts+regens)?Math.round(100*accepts/(accepts+regens)):0;
  el.textContent='Time to first sound (median) '+(med==null?'—':Math.round(med)+' ms')+'. Accept '+accepts+', regenerate '+regens+', accept rate '+rate+'%. Edits '+edits+'.';
}

// ---- Capture: PCM -> frames -> melody track ----
class IdeaAnalyzer{
  static notes(fr,per,max,minVotes){
    if(!fr.length||!(per>0))return [];
    const hop=fr.length>1?Math.max(0.02,Math.min(0.08,fr[1].t-fr[0].t)):0.03;
    const minHold=Math.max(0.06,(minVotes||2)*0.05);
    const runs=[];
    let run=null;
    fr.forEach(f=>{
      const voiced=!f.rejected&&f.midiSmooth!=null;
      if(!voiced){if(run){runs.push(run); run=null} return}
      if(run&&run.midi===f.midiSmooth){run.t1=f.t}
      else{if(run)runs.push(run); run={midi:f.midiSmooth,t0:f.t,t1:f.t}}
    });
    if(run)runs.push(run);
    const out=[];
    runs.forEach(r=>{
      const dur=r.t1-r.t0+hop;
      if(dur<minHold)return;
      let step=Math.max(0,Math.round(r.t0/per));
      let len=Math.max(1,Math.round(dur/per));
      if(step>=max)return;
      if(step+len>max)len=max-step;
      const prev=out[out.length-1];
      if(prev&&step<prev.step+prev.len){
        if(prev.midi===r.midi){
          const end=Math.min(max,Math.max(prev.step+prev.len,step+len));
          prev.len=end-prev.step; prev.audioEnd=r.t0+dur;
          return;
        }
        step=prev.step+prev.len;
        if(step>=max)return;
        if(step+len>max)len=max-step;
      }
      out.push({step,midi:r.midi,len,vel:0.7,srcMidi:r.midi,audioStart:r.t0,audioEnd:r.t0+dur,word:'',wordLock:false});
    });
    return out;
  }
  static onsets(fr){
    const on=[]; let last=-1;
    for(let i=5;i<fr.length;i++){
      const avg=fr.slice(i-5,i).reduce((a,f)=>a+f.rms,0)/5, f=fr[i];
      if(f.rms>0.02&&f.rms>avg*1.6&&f.t-last>0.12){on.push(f); last=f.t}
    }
    return on;
  }
  static tempo(on){
    if(on.length<3)return 100;
    const d=[]; for(let i=1;i<on.length;i++)d.push(on[i].t-on[i-1].t);
    d.sort((a,b)=>a-b); let bpm=60/d[d.length>>1];
    while(bpm<70)bpm*=2; while(bpm>150)bpm/=2;
    return Math.round(bpm);
  }
  static pattern(on,bpm){
    if(!on.length)return null;
    const per=60/bpm/4, rows=[0,1,2].map(()=>Array(16).fill(0));
    const loud=[...on].sort((a,b)=>b.rms-a.rms)[Math.floor(on.length/3)].rms;
    on.forEach(o=>{
      const lane=o.zcr>0.25?2:(o.m!=null&&o.m<55)?0:o.rms>=loud?1:2;
      rows[lane][Math.round(o.t/per)%16]=1;
    });
    if(!rows[0].some(Boolean))rows[0][0]=1;
    return rows;
  }
}
function storePcm(samples,sampleRate){
  const max=Math.min(samples.length,Math.floor(sampleRate*30));
  const copy=new Float32Array(max);
  copy.set(samples.subarray(0,max));
  lastPcm={samples:copy,sampleRate};
  syncVocalBuffer();
}
function syncVocalBuffer(){
  vocalAudio=null;
  if(!lastPcm)return;
  try{
    const ctx=Tone.getContext().rawContext;
    const buf=ctx.createBuffer(1,lastPcm.samples.length,lastPcm.sampleRate);
    buf.getChannelData(0).set(lastPcm.samples);
    vocalAudio=buf;
  }catch(e){vocalAudio=null}
}
async function framesFromPcm(pcm,tuneNow,gen){
  const ds=downsample(pcm.samples,pcm.sampleRate,PITCH_SR);
  const data=ds.samples, sr=ds.sampleRate;
  const hop=Math.max(1,Math.floor(sr*0.03));
  const max=data.length-PITCH_N;
  const fr=[];
  if(max<=0)return fr;
  for(let i=0;i<=max;i+=hop){
    if(gen!==analyzeGen)return null;
    const buf=data.subarray(i,i+PITCH_N);
    const det=PitchDetector.detect(buf,sr,tuneNow);
    let z=0;
    for(let k=1;k<buf.length;k++)if((buf[k]>=0)!==(buf[k-1]>=0))z++;
    fr.push({t:i/sr,midi:det.midi,midiRaw:det.midi,clarity:det.clarity,rms:det.rms,zcr:z/buf.length,rejected:det.rejected,octaveFixed:false,midiSmooth:null,m:null});
    if(fr.length%40===0){
      $('#msg').textContent='Listening for pitch... '+Math.min(99,Math.round(100*i/max))+'%';
      await new Promise(r=>setTimeout(r,0));
    }
  }
  if(gen!==analyzeGen)return null;
  smoothFrames(fr,tuneNow);
  fr.forEach(f=>{f.m=f.midiSmooth});
  return fr;
}
async function analyze(bpmOv,opts){
  opts=opts||{};
  if(!lastPcm||lastPcm.samples.length<PITCH_N){
    $('#msg').textContent='Record or upload audio to analyze it.';
    drawPitchDebug();
    return;
  }
  const gen=++analyzeGen;
  $('#msg').textContent='Listening for pitch...';
  const frames=await framesFromPcm(lastPcm,tune,gen);
  if(!frames||gen!==analyzeGen)return;
  lastFrames=frames;
  const on=IdeaAnalyzer.onsets(lastFrames);
  const bpm=bpmOv||IdeaAnalyzer.tempo(on);
  if(!bpmOv)setBpm(bpm);
  const per=60/bpm/4;
  const span=Math.max(16,Math.min(32*16,Math.ceil(lastFrames[lastFrames.length-1].t/per)));
  const detected=IdeaAnalyzer.notes(lastFrames,per,span,tune.minVotes);
  pushUndo();
  if(opts.genre!==false)applyDetectedGenre(lastFrames);
  const limit=songSteps();
  const wordsNow=lyricWords();
  const pitched=detected.filter(n=>n.step<limit);
  const sparse=pitched.length<2&&on.length>0;
  let usedSpeech=false, hits=[];
  if(wordsNow.length||sparse){
    const spoken=speechMelody(wordsNow,on,per,limit);
    if(spoken.length){
      song.motif=spoken.map(n=>Object.assign({},n));
      song.track('melody').notes=spoken;
      const melT=song.track('melody');
      if(melT)melT.mute=false;
      if(vocalAudio){const voxT=song.track('vocal'); if(voxT)voxT.mute=false}
      buildTrackStrip();
      usedSpeech=true;
    }
  }
  if(!usedSpeech){
    song.motif=detected.map(n=>Object.assign({},n));
    song.track('melody').notes=pitched.map(n=>{
      const c=Object.assign({},n);
      if(c.step+c.len>limit)c.len=limit-c.step;
      return c;
    });
    reflowLyrics();
    hits=hitsFromMelody(song.track('melody').notes);
    if(opts.drums!==false&&hits.length){song.track('drums').notes=hits; buildGrid()}
    if(opts.fresh&&vocalAudio){
      const melT=song.track('melody'), voxT=song.track('vocal');
      if(melT)melT.mute=true;
      if(voxT)voxT.mute=false;
      buildTrackStrip();
    }
  }
  if(opts.fresh){
    resultReady=true; accepted=false;
    const hit=lastFrames.find(fr=>fr.rms>=tune.rmsMin);
    if(hit){
      song.latencyOffsetMs=suggestLatencyOffsetMs(0,hit.t*1000);
      shiftSteps(song.track('melody').notes,song.latencyOffsetMs,per);
    }
  }
  if(opts.logFirst){
    const hit=lastFrames.find(fr=>fr.rms>=tune.rmsMin);
    logEvent('firstSound',{ms:hit?Math.round(hit.t*1000):null});
  }
  drawRoll(null); drawPitchDebug(); refreshSplitCards();
  if(!usedSpeech){
    $('#beatInfo').textContent=hits.length?`The beat follows ${hits.length} hummed notes`+(hits.some(h=>h.once)?' across the song. Tap steps to edit bar 1.':'. Tap steps to edit the loop.'):'Not enough held notes to build a beat. Tap steps to draw your own.';
    $('#msg').textContent=`Split into ${melodyNotes().length} melody notes and ${hits.length} beat hits. Press play to hear them.`;
  }else $('#msg').textContent=`Turned the words into ${melodyNotes().length} melody notes. Press play to hear them.`;
}
function floatWord(w){
  const el=document.createElement('span'); el.className='w'; el.textContent=w;
  el.style.left=(4+R()*66)+'%'; el.style.top=(10+R()*65)+'%';
  $('#words').appendChild(el); setTimeout(()=>el.remove(),4600);
}
const GENRE_LABEL={pop:'Pop',rnb:'R&B',rap:'Rap',lofi:'Lo-fi',rock:'Rock'};
const MICS={
  pop:{caption:'Pop · studio condenser', html:'<img src="mic.png" alt="Studio condenser microphone in a shock mount">'},
  rnb:{caption:'R&B · tube condenser', html:'<img src="mic-rnb.png" alt="Vintage tube condenser microphone">'},
  rap:{caption:'Rap · broadcast mic', html:'<img src="mic-rap.png" alt="Broadcast microphone with a pop filter">'},
  lofi:{caption:'Lo-fi · ribbon mic', html:'<img src="mic-lofi.png" alt="Ribbon microphone">'},
  rock:{caption:'Rock · stage dynamic', html:'<img src="mic-rock.png" alt="Handheld stage microphone">'}
};
let genreManual=false, liveFrames=[], liveGuessAt=0, guessStreak=null;
function detectGenre(frames){
  if(!frames||frames.length<8)return null;
  const dur=Math.max(0.5, frames[frames.length-1].t-frames[0].t);
  const loud=frames.filter(f=>f.rms>=0.02);
  if(loud.length<4)return null;
  const voiced=frames.filter(f=>f.midi!=null&&!f.rejected&&f.rms>=0.015);
  const voicedRatio=voiced.length/frames.length;
  let meanZ=0; frames.forEach(f=>{meanZ+=f.zcr||0}); meanZ/=frames.length;
  let range=0;
  if(voiced.length>1){
    let lo=99, hi=0;
    voiced.forEach(f=>{if(f.midi<lo)lo=f.midi; if(f.midi>hi)hi=f.midi});
    range=hi-lo;
  }
  const on=IdeaAnalyzer.onsets(frames), onsetRate=on.length/dur;
  let meanHold=0;
  if(voiced.length>1){
    let runs=0, hold=0, runT=voiced[0].t, prev=voiced[0];
    for(let i=1;i<voiced.length;i++){
      const f=voiced[i];
      if(Math.abs(f.midi-prev.midi)>1||f.t-prev.t>0.28){hold+=prev.t-runT; runs++; runT=f.t}
      prev=f;
    }
    hold+=prev.t-runT; runs++;
    meanHold=runs?hold/runs:0;
  }
  const s={pop:1,rnb:0,rap:0,lofi:0,rock:0};
  if(voicedRatio<0.42)s.rap+=2;
  if(onsetRate>2.2)s.rap+=2;
  if(range<5)s.rap+=1;
  if(meanZ>0.15)s.rock+=2;
  if(onsetRate>1.6&&meanZ>0.11&&voicedRatio>0.3)s.rock+=2;
  if(onsetRate<1.5&&meanZ<0.09)s.lofi+=2;
  if(range<=7&&onsetRate<1.8&&meanZ<0.1)s.lofi+=1;
  if(range>=8&&voicedRatio>0.5)s.rnb+=2;
  if(meanHold>0.4&&voicedRatio>0.45&&range>=5)s.rnb+=2;
  if(meanHold>0.45&&voicedRatio>0.55&&onsetRate<2)s.rnb+=2;
  if(voicedRatio>0.5&&range>=3&&range<=12&&meanZ<0.14&&onsetRate>=1.4)s.pop+=2;
  let best='pop', top=s.pop;
  Object.keys(s).forEach(k=>{if(s[k]>top){top=s[k]; best=k}});
  return best;
}
function applyDetectedGenre(frames){
  if(genreManual)return;
  const g=detectGenre(frames);
  if(g)setGenre(g);
}
function noteGuess(g){
  if(!g||genreManual)return;
  if(guessStreak&&guessStreak.id===g)guessStreak.n++;
  else guessStreak={id:g,n:1};
  if(guessStreak.n>=2)setGenre(g);
}
function setMic(id){
  const m=MICS[id]||MICS.pop;
  const el=$('#micArt'); if(!el)return;
  if(el.dataset.mic===id){
    if($('#micap'))$('#micap').textContent=m.caption;
    return;
  }
  el.dataset.mic=id;
  el.innerHTML=m.html;
  el.style.animation='none'; void el.offsetWidth; el.style.animation='';
  $('#mic').classList.remove('g-pop','g-rnb','g-rap','g-lofi','g-rock');
  $('#mic').classList.add('g-'+(MICS[id]?id:'pop'));
  if($('#micap'))$('#micap').textContent=m.caption;
}
function setGenre(id){
  if(!GENRE_LABEL[id])return;
  const sel=$('#genre'); if(sel)sel.value=id;
  const lab=$('#genreV'); if(lab)lab.textContent=GENRE_LABEL[id];
  setMic(id);
}
function concatFloats(chunks){
  let n=0; chunks.forEach(c=>n+=c.length);
  const out=new Float32Array(n); let o=0;
  chunks.forEach(c=>{out.set(c,o); o+=c.length});
  return out;
}
function cancelCountIn(){countInToken++; if(endCountIn)endCountIn()}
function runCountIn(bpm){
  const token=++countInToken;
  return new Promise(resolve=>{
    countingIn=true;
    if(Tone.Transport.state==='started')Tone.Transport.stop();
    setBpm(bpm);
    Tone.Transport.position=0;
    const click=new Tone.MembraneSynth({pitchDecay:0.008,octaves:2,oscillator:{type:'sine'},envelope:{attack:0.001,decay:0.05,sustain:0,release:0.01}}).toDestination();
    click.volume.value=-8;
    let n=0, settled=false;
    const beatMs=60000/bpm;
    const finish=()=>{
      if(settled)return;
      settled=true;
      clearTimeout(safety);
      try{Tone.Transport.clear(id)}catch(e){}
      countingIn=false;
      try{click.dispose()}catch(e){}
      if(Tone.Transport.state==='started'){Tone.Transport.stop(); Tone.Transport.position=0}
      step=0; endCountIn=null; resolve();
    };
    endCountIn=finish;
    const id=Tone.Transport.scheduleRepeat(time=>{
      if(token!==countInToken){Tone.Draw.schedule(finish,time); return}
      if(n<4){
        click.triggerAttackRelease(n===0?'C3':'C2','32n',time,n===0?1:0.55);
        const beatNo=n+1;
        Tone.Draw.schedule(()=>{
          if(token!==countInToken)return;
          $('#msg').textContent='Count-in '+beatNo;
          $('#mic').style.setProperty('--lvl','1');
          setTimeout(()=>$('#mic').style.setProperty('--lvl','0'),80);
        },time);
      }
      n++;
      if(n===4)Tone.Draw.schedule(finish,time+Tone.Time('4n').toSeconds());
    },'4n');
    Tone.Transport.start();
    const safety=setTimeout(finish,beatMs*4+900);
  });
}
async function record(){
  if(session){session.stop(); return}
  genreManual=false;
  let stopRequested=false, phase='init', finish=()=>{}, recT0=0;
  session={stop(){
    if(phase==='count'||phase==='init'){stopRequested=true; if(phase==='count')cancelCountIn(); return}
    finish(false);
  }};
  try{
    await Tone.start(); started=true;
    if(stopRequested){session=null; setRec(0); return}
    $('#msg').textContent='Waiting for microphone permission...';
    const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false}});
    if(stopRequested){
      stream.getTracks().forEach(t=>t.stop()); session=null; setRec(0);
      $('#msg').textContent='Recording cancelled.'; return;
    }
    const countOn=$('#countIn').getAttribute('aria-pressed')==='true';
    let usedCount=false;
    if(countOn){
      phase='count'; setRec(1); $('#mic').classList.add('live');
      await runCountIn(+$('#recBpm').value||100);
      if(stopRequested){
        stream.getTracks().forEach(t=>t.stop()); session=null; setRec(0);
        $('#mic').classList.remove('live'); $('#mic').style.setProperty('--lvl','0');
        $('#msg').textContent='Recording cancelled.'; return;
      }
      usedCount=true;
    }
    phase='rec';
    const ctx=Tone.getContext().rawContext;
    if(ctx.state!=='running'){try{await ctx.resume()}catch(e){}}
    const src=ctx.createMediaStreamSource(stream), mute=ctx.createGain(), analyser=ctx.createAnalyser();
    mute.gain.value=0; analyser.fftSize=2048; analyser.smoothingTimeConstant=0;
    try{src.channelCount=1; src.channelCountMode='explicit'}catch(e){}
    src.connect(analyser); analyser.connect(mute); mute.connect(ctx.destination);
    const chunks=[], blobs=[], wave=new Float32Array(analyser.fftSize);
    liveFrames=[]; liveGuessAt=0; guessStreak=null;
    const micT0=performance.now();
    let proc=null, meterId=0, lastLive=0, rec=null;
    const pullChunk=()=>{
      analyser.getFloatTimeDomainData(wave);
      const ch=wave.subarray(0,PITCH_N);
      let e2=0, z=0;
      for(let i=0;i<ch.length;i++){e2+=ch[i]*ch[i]; if(i&&(ch[i]>=0)!==(ch[i-1]>=0))z++}
      $('#mic').style.setProperty('--lvl',String(Math.min(1,Math.sqrt(e2/ch.length)*10)));
      if(performance.now()-lastLive<120)return;
      lastLive=performance.now();
      const det=PitchDetector.detect(ch,ctx.sampleRate,tune);
      liveFrames.push({t:(performance.now()-micT0)/1000, midi:det.rejected?null:det.midi, rms:det.rms, zcr:z/ch.length, rejected:det.rejected});
      if(liveFrames.length>=8&&performance.now()-liveGuessAt>650){liveGuessAt=performance.now(); noteGuess(detectGenre(liveFrames))}
    };
    const pump=()=>{if(finished)return; pullChunk(); meterId=requestAnimationFrame(pump)};
    try{
      const types=['audio/webm;codecs=opus','audio/webm','audio/mp4'];
      const mime=types.find(t=>window.MediaRecorder&&MediaRecorder.isTypeSupported(t))||'';
      rec=new MediaRecorder(stream, mime?{mimeType:mime}:undefined);
      rec.ondataavailable=e=>{if(e.data&&e.data.size)blobs.push(e.data)};
      rec.start(200);
    }catch(e){rec=null}
    if(!rec&&ctx.createScriptProcessor){
      proc=ctx.createScriptProcessor(2048,1,1);
      proc.onaudioprocess=e=>{
        const input=e.inputBuffer.getChannelData(0);
        const ch=new Float32Array(input.length); ch.set(input); chunks.push(ch);
        let e2=0; for(let i=0;i<input.length;i++)e2+=input[i]*input[i];
        $('#mic').style.setProperty('--lvl',String(Math.min(1,Math.sqrt(e2/input.length)*10)));
      };
      src.connect(proc); proc.connect(mute);
    }
    meterId=requestAnimationFrame(pump);
    let text='', sr=null, spawned=0;
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(SR){try{sr=new SR(); sr.continuous=true; sr.interimResults=true;
      sr.onresult=e=>{text=Array.from(e.results).map(r=>r[0].transcript).join(' '); const w=text.trim().split(/\s+/).filter(Boolean); while(spawned<w.length)floatWord(w[spawned++])};
      sr.onerror=()=>{}; sr.start()}catch(_){sr=null}}
    recT0=performance.now();
    setRec(1); $('#msg').textContent='Listening. Sing or hum your idea.'; $('#mic').classList.add('live');
    let finished=false;
    const to=setTimeout(()=>finish(true),8000);
    let delivered=false;
    const release=()=>{
      if(meterId)cancelAnimationFrame(meterId);
      try{src.disconnect()}catch(e){}
      try{analyser.disconnect()}catch(e){}
      try{if(proc){proc.onaudioprocess=null; proc.disconnect()}}catch(e){}
      try{mute.disconnect()}catch(e){}
      stream.getTracks().forEach(t=>t.stop());
      if(sr){try{sr.stop()}catch(e){}}
      session=null; setRec(0); $('#mic').classList.remove('live'); $('#mic').style.setProperty('--lvl','0');
    };
    const useTake=(samples,sampleRate)=>{
      if(delivered)return;
      delivered=true;
      release();
      if(!samples||samples.length<PITCH_N){$('#msg').textContent='No audio was captured.'; return}
      if(resultReady)logEvent('regenerate',{via:'record'});
      storePcm(samples,sampleRate);
      const bpmLock=usedCount?(+$('#recBpm').value||100):null;
      analyze(bpmLock,{logFirst:true,fresh:true}).then(()=>{
        toSplit();
        setTimeout(()=>{
          const w=text.trim(); $('#lyr').value=w;
          if(w.split(/\s+/).filter(Boolean).length)applySpeechMelody(w.split(/\s+/).filter(Boolean));
          else reflowLyrics();
          drawRoll(null); fillLyrics();
          $('#lyrNote').textContent=w?'Transcribed from your recording. Edit the words and they line up with the melody notes.':(sr?'No words recognized. Type your own lyrics.':'Speech recognition is not available in this browser. Type your own lyrics.');
        },900);
      });
    };
    finish=auto=>{
      if(finished)return;
      if(!auto&&performance.now()-recT0<2000){$('#msg').textContent='Keep going, at least 2 seconds.'; return}
      finished=true; clearTimeout(to);
      if(meterId)cancelAnimationFrame(meterId);
      if(rec&&rec.state==='recording'){
        $('#msg').textContent='Reading the take...';
        const slow=setTimeout(()=>{
          const late=new Blob(blobs,{type:(rec&&rec.mimeType)||'audio/webm'});
          if(!late.size){useTake(concatFloats(chunks),ctx.sampleRate); return}
          late.arrayBuffer().then(ab=>ctx.decodeAudioData(ab)).then(audio=>{
            const ch=audio.getChannelData(0), copy=new Float32Array(ch.length); copy.set(ch);
            useTake(copy,audio.sampleRate);
          }).catch(()=>useTake(concatFloats(chunks),ctx.sampleRate));
        },3000);
        rec.addEventListener('stop',()=>{
          clearTimeout(slow);
          const blob=new Blob(blobs,{type:rec.mimeType||'audio/webm'});
          if(!blob.size){useTake(concatFloats(chunks),ctx.sampleRate); return}
          blob.arrayBuffer().then(ab=>ctx.decodeAudioData(ab)).then(audio=>{
            const ch=audio.getChannelData(0), copy=new Float32Array(ch.length); copy.set(ch);
            useTake(copy,audio.sampleRate);
          }).catch(()=>useTake(concatFloats(chunks),ctx.sampleRate));
        },{once:true});
        try{rec.stop()}catch(e){clearTimeout(slow); useTake(concatFloats(chunks),ctx.sampleRate)}
      }else useTake(concatFloats(chunks),ctx.sampleRate);
    };
  }catch(e){
    setRec(0); session=null; countingIn=false;
    $('#msg').textContent='Microphone unavailable ('+(e.name||'error')+'). This preview may block mic access, so use "Upload a voice memo" or the demo idea instead.';
  }
}

// ---- Lyrics locked to notes ----
function lyricWords(){return $('#lyr').value.trim().split(/\s+/).filter(Boolean)}
function reflowLyrics(){
  const words=lyricWords();
  let i=0;
  melodyNotes().forEach(n=>{
    if(n.wordLock)return;
    n.word=i<words.length?words[i++]:'';
  });
}
let wordEdit=null;
function editWord(note,x,y){
  if(wordEdit)wordEdit.remove();
  const inp=document.createElement('input');
  inp.className='wordedit'; inp.value=note.word||'';
  inp.setAttribute('aria-label','Word for this note');
  inp.style.left=x+'px'; inp.style.top=y+'px';
  document.body.appendChild(inp); inp.focus(); inp.select();
  const done=()=>{
    if(!wordEdit)return;
    note.word=inp.value.trim();
    note.wordLock=true;
    inp.remove(); wordEdit=null;
    drawRoll(null); logEdit('lyric');
  };
  inp.onkeydown=e=>{
    if(e.key==='Enter'){e.preventDefault(); done()}
    if(e.key==='Escape'){inp.onblur=null; inp.remove(); wordEdit=null}
  };
  inp.onblur=done;
  wordEdit=inp;
}

// ---- Scale, expansion, voice ----
const KEYS=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const SCALES={major:[0,2,4,5,7,9,11],minor:[0,2,3,5,7,8,10],pentatonic:[0,2,4,7,9]};
const GENRES={
  pop:{density:.7,swing:.15,fill:true},
  rnb:{density:.85,swing:.45,fill:true},
  rap:{density:.55,swing:.2,fill:true},
  lofi:{density:.4,swing:.55,fill:false},
  rock:{density:1,swing:0,fill:true}
};
const MELODY_STYLE={
  pop:{scale:'major',base:60,step:1,leap:2,hold:2},
  rnb:{scale:'minor',base:58,step:1,leap:2,hold:4},
  rap:{scale:'pentatonic',base:57,step:0,leap:1,hold:1},
  lofi:{scale:'pentatonic',base:53,step:1,leap:1,hold:2},
  rock:{scale:'minor',base:60,step:1,leap:3,hold:2}
};
function mulberry32(a){return function(){a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296}}
function snapToScale(midi,root,scale){
  const tones=SCALES[scale]||SCALES.major;
  const pc=((midi%12)-root+12)%12;
  let best=tones[0], dist=99;
  tones.forEach(t=>{const d=Math.min((pc-t+12)%12,(t-pc+12)%12); if(d<dist){dist=d; best=t}});
  let out=Math.floor(midi/12)*12+((root+best)%12);
  while(out>midi+6)out-=12;
  while(out<midi-6)out+=12;
  return clamp(out,36,84);
}
function varyContour(midis,rand,variation,root,scale){
  const dirs=midis.map((m,i)=>i===0?0:Math.sign(m-midis[i-1]));
  const out=midis.slice();
  for(let i=1;i<out.length;i++){
    const wobble=Math.round((rand()*2-1)*(variation/100)*4);
    let m=snapToScale(out[i]+wobble,root,scale);
    const dir=Math.sign(m-out[i-1]);
    if(dirs[i]!==0&&dir!==0&&dir!==dirs[i])m=snapToScale(out[i],root,scale);
    out[i]=m;
  }
  return out;
}
function stepScale(midi,dir,root,scale){
  const sign=dir<0?-1:1;
  let cur=snapToScale(midi,root,scale);
  for(let i=0;i<14;i++){
    const nxt=snapToScale(cur+sign,root,scale);
    if(nxt!==cur)return nxt;
    cur+=sign;
  }
  return snapToScale(midi,root,scale);
}
function spokenPitch(t){
  let best=null, dist=0.35;
  lastFrames.forEach(f=>{
    if(!f||f.rejected||f.midiSmooth==null)return;
    const d=Math.abs(f.t-t);
    if(d<dist){dist=d; best=f.midiSmooth}
  });
  return best;
}
function speechSlice(item,midi){
  if(!item.live||!vocalAudio)return {srcMidi:midi,audioStart:null,audioEnd:null};
  const start=Math.max(0,item.t);
  const cap=vocalAudio.duration;
  if(!(start<cap))return {srcMidi:midi,audioStart:null,audioEnd:null};
  let end=item.nextT==null?start+0.35:item.nextT;
  end=Math.min(cap,Math.max(start+0.03,end));
  if(!(end>start))return {srcMidi:midi,audioStart:null,audioEnd:null};
  const heard=spokenPitch(start);
  return {srcMidi:heard==null?midi:heard,audioStart:start,audioEnd:end};
}
function speechMelody(words,onsets,per,maxSteps){
  const genre=($('#genre')&&$('#genre').value)||'pop';
  const style=MELODY_STYLE[genre]||MELODY_STYLE.pop;
  const root=+song.root||0, scale=style.scale;
  song.scale=scale;
  const sel=$('#scaleSel');
  if(sel){sel.value=scale; if($('#scaleV')&&sel.selectedOptions[0])$('#scaleV').textContent=sel.selectedOptions[0].textContent}
  const hits=(onsets||[]).filter(o=>o&&typeof o.t==='number');
  const list=[];
  if(words&&words.length){
    const nHit=Math.min(words.length,hits.length);
    for(let i=0;i<nHit;i++)list.push({t:hits[i].t,rms:hits[i].rms||0,word:words[i],live:true});
    const extra=words.length-nHit;
    if(extra>0){
      const start=nHit?Math.round(hits[nHit-1].t/per)+1:0;
      for(let i=0;i<extra;i++){
        const step=start+i;
        if(step>=maxSteps)break;
        list.push({t:step*per,rms:0,word:words[nHit+i],live:false});
      }
    }
  }else hits.forEach(h=>list.push({t:h.t,rms:h.rms||0,word:'',live:true}));
  const liveAt=[];
  list.forEach((item,i)=>{if(item.live)liveAt.push(i)});
  liveAt.forEach((idx,k)=>{list[idx].nextT=k+1<liveAt.length?list[liveAt[k+1]].t:null});
  if(!list.length||!(per>0))return [];
  const louds=list.map(x=>x.rms).filter(r=>r>0).sort((a,b)=>a-b);
  const loudCut=louds.length?louds[Math.floor(louds.length*0.66)]:Infinity;
  let midi=snapToScale(style.base+root,root,scale);
  const home=midi;
  const notes=[];
  list.forEach((item,i)=>{
    const loud=item.rms>=loudCut;
    if(i>0){
      let move=0;
      if(genre==='rap')move=loud?style.leap:0;
      else if(genre==='rock')move=(i%2?style.leap:style.step)*(i%4<2?1:-1);
      else if(genre==='rnb'&&i%5===4)move=style.leap;
      else if(genre==='lofi')move=(i%2?1:-1)*style.step;
      else move=(i%4===3?style.leap:style.step)*(i%2?1:-1);
      const sign=move<0?-1:1;
      for(let s=0;s<Math.abs(move);s++)midi=stepScale(midi,sign,root,scale);
      if(genre==='lofi'){
        if(midi>home+5)midi=stepScale(home,1,root,scale);
        if(midi<home-2)midi=home;
      }
    }
    let step=Math.max(0,Math.round(item.t/per));
    if(step>=maxSteps)return;
    const prev=notes[notes.length-1];
    if(prev&&step<=prev.step)step=prev.step+1;
    if(step>=maxSteps)return;
    const slice=speechSlice(item,midi);
    notes.push({step,midi,len:1,vel:loud?0.9:0.7,srcMidi:slice.srcMidi,audioStart:slice.audioStart,audioEnd:slice.audioEnd,word:item.word||'',wordLock:false});
  });
  for(let i=0;i<notes.length;i++){
    const gap=i+1<notes.length?notes[i+1].step-notes[i].step:style.hold;
    let len=Math.max(1,Math.min(style.hold,gap));
    if(genre==='rap')len=1;
    if(genre==='rnb')len=Math.max(2,Math.min(style.hold,Math.max(gap,2)));
    notes[i].len=Math.max(1,Math.min(len,maxSteps-notes[i].step));
    if(i+1<notes.length&&notes[i].step+notes[i].len>notes[i+1].step)notes[i].len=Math.max(1,notes[i+1].step-notes[i].step);
  }
  return notes;
}
function applySpeechMelody(words){
  if(!lastFrames.length)return false;
  const list=(words&&words.length)?words:lyricWords();
  if(!list.length)return false;
  const per=60/(+$('#bpm').value||100)/4;
  const notes=speechMelody(list,IdeaAnalyzer.onsets(lastFrames),per,songSteps());
  if(!notes.length)return false;
  pushUndo();
  song.track('melody').notes=notes;
  song.motif=notes.map(n=>Object.assign({},n));
  const melT=song.track('melody');
  if(melT)melT.mute=false;
  if(vocalAudio){const voxT=song.track('vocal'); if(voxT)voxT.mute=false}
  buildTrackStrip();
  drawRoll(null);
  return true;
}
function cloneNote(n,step,midi){
  return{step,midi,len:n.len,vel:n.vel==null?0.7:n.vel,srcMidi:n.srcMidi==null?n.midi:n.srcMidi,audioStart:null,audioEnd:null,word:'',wordLock:false};
}
function makeOption(motif,seed,genre,variation,mood){
  const rand=mulberry32(seed);
  const root=song.root, scale=song.scale, bars=song.bars, total=bars*16;
  const g=GENRES[genre]||GENRES.pop;
  let shift=mood==='dark'?-12:0;
  const velScale=mood==='soft'?.6:mood==='driving'?1.15:mood==='bright'?1.1:1;
  const shaped=motif.map(n=>({...n,midi:snapToScale(n.midi+shift,root,scale)}));
  const spanSteps=Math.max(16,shaped.reduce((m,n)=>Math.max(m,n.step+n.len),0));
  const phraseBars=Math.max(1,Math.ceil(spanSteps/16));
  const period=variation<8?999:variation<40?2:4;
  let melody=[];
  for(let b=0;b<bars;b++){
    const slice=shaped.filter(n=>Math.floor(n.step/16)%phraseBars===b%phraseBars);
    const exact=variation<8||(b%period)===0;
    const midis=exact?slice.map(n=>n.midi):varyContour(slice.map(n=>n.midi),rand,variation,root,scale);
    slice.forEach((n,i)=>{
      const step=b*16+(n.step%16);
      if(step>=total)return;
      const note=cloneNote(n,step,midis[i]);
      note.len=Math.min(n.len,total-step);
      if(mood==='driving')note.len=Math.max(1,note.len-1);
      note.vel=clamp((n.vel||0.7)*velScale,.05,1);
      melody.push(note);
    });
  }
  let groove=song.track('drums').notes.filter(n=>!n.fill&&n.step<16).map(n=>({step:n.step,lane:n.lane,len:1,vel:n.vel||DRUM_VEL[n.lane]||0.7}));
  if(!groove.length)groove=defaultDrumNotes();
  if(g.density<0.75)groove=groove.filter(n=>n.lane!==2||rand()<g.density+0.35);
  else if(g.density>0.8){
    for(let s=0;s<16;s+=2)if(!groove.some(n=>n.lane===2&&n.step===s)&&rand()<g.density-0.45)groove.push({step:s,lane:2,len:1,vel:0.4});
  }
  const drums=groove.map(n=>({step:n.step,lane:n.lane,len:1,vel:n.vel,fill:false}));
  if(g.fill){
    let bar=0;
    song.sections.forEach(sec=>{
      const last=bar+sec.bars-1;
      if(last>=0&&last<bars)[12,13,14,15].forEach((s,i)=>drums.push({step:last*16+s,lane:1,len:1,vel:0.45+i*0.12,fill:true}));
      bar+=sec.bars;
    });
  }
  const chords=[], bass=[];
  for(let b=0;b<bars;b++){
    const inBar=melody.filter(n=>Math.floor(n.step/16)===b);
    const center=inBar.length?inBar[0].midi:60+root;
    const snapped=snapToScale(center,root,scale);
    const tones=SCALES[scale];
    const pc=((snapped%12)-root+12)%12;
    let deg=tones.indexOf(pc); if(deg<0)deg=0;
    const midis=[0,2,4].map(off=>{
      const d=deg+off, oct=Math.floor(d/tones.length), t=tones[d%tones.length];
      let m=Math.floor(snapped/12)*12+((root+t)%12)+oct*12;
      while(m<snapped-7)m+=12; while(m>snapped+8)m-=12;
      return clamp(m,48,76);
    });
    const stamp=scale==='major'?'maj':scale==='pentatonic'?'min':'min7';
    const voiced=expandChordStamp(midiToPitch(snapped),stamp).map(name=>clamp(parsePitchToMidi(name),48,76));
    (voiced.length?voiced:midis).forEach(m=>chords.push({step:b*16,midi:m,len:16,vel:0.45*velScale}));
    const bassMidi=clamp(midis[0]-24,28,52);
    bass.push({step:b*16,midi:bassMidi,len:8,vel:0.8});
    bass.push({step:b*16+8,midi:bassMidi,len:8,vel:0.55});
  }
  const phrase=melody.map(n=>({n:midiToPitch(n.midi),x:n.step,w:n.len,v:n.vel,locked:!!n.wordLock,daw:n}));
  const locked=phrase.filter(n=>n.locked);
  const scaleTones=[];
  for(let oct=3;oct<=5;oct++)(SCALES[scale]||SCALES.major).forEach(semi=>scaleTones.push(midiToPitch(((root+semi)%12)+(oct+1)*12)));
  const symbol=KEYS[root]+(scale==='major'?'maj':'m');
  let merged=mergeLockedNotes(phrase,locked);
  if(variation>=8){
    const extra=buildConstrainedPhrase(scaleTones,variation>60?2:1,{density:g.density,locked,chordClasses:chordPitchClasses([symbol]),rng:rand});
    merged=mergeLockedNotes(phrase.filter(n=>n.x>=16).concat(extra),locked.filter(n=>n.x<16));
  }
  melody=merged.map(item=>{
    const base=item.daw||{word:'',wordLock:false,srcMidi:parsePitchToMidi(item.n),audioStart:null,audioEnd:null};
    return Object.assign({},base,{step:Math.max(0,Math.round(item.x)),midi:parsePitchToMidi(item.n),len:Math.max(1,Math.round(item.w||1)),vel:item.v==null?0.7:item.v,wordLock:!!item.locked||!!base.wordLock});
  });
  const laneOf=['kick','snare','hat'];
  const current={kick:[],snare:[],hat:[]};
  groove.forEach(hit=>{const key=laneOf[hit.lane]; if(key)current[key].push(hit.step)});
  const rewritten=rewriteDrumLanes(current,{...current,_kit:genre==='rap'?'trap':genre},{variation:g.density,rng:rand,lanes:laneOf});
  const loopHits=[];
  laneOf.forEach((key,lane)=>(rewritten[key]||[]).forEach(hitStep=>loopHits.push({step:hitStep,lane,len:1,vel:DRUM_VEL[lane]||0.7,fill:false})));
  const fills=drums.filter(hit=>hit.fill);
  return{melody,drums:loopHits.concat(fills),chords,bass,swing:g.swing,bars,seed};
}
const HARMONY_TONE={
  pop:{osc:'triangle',attack:0.01,decay:0.2,sustain:0.6,release:0.25,stamp:'maj',bass:'beats'},
  rnb:{osc:'sine',attack:0.08,decay:0.35,sustain:0.75,release:0.6,stamp:'min7',bass:'hold'},
  rap:{osc:'square',attack:0.005,decay:0.08,sustain:0.2,release:0.08,stamp:'power',bass:'short'},
  lofi:{osc:'triangle',attack:0.04,decay:0.45,sustain:0.5,release:0.9,stamp:'sus2',bass:'hold'},
  rock:{osc:'sawtooth',attack:0.005,decay:0.12,sustain:0.4,release:0.2,stamp:'power',bass:'eighth'}
};
function harmonyVoicing(rootMidi,stamp){
  if(stamp==='power')return [0,7].map(iv=>clamp(rootMidi+iv,40,76));
  const names=expandChordStamp(midiToPitch(rootMidi),stamp);
  const midis=names.map(name=>clamp(parsePitchToMidi(name),40,76));
  return midis.length?midis:[clamp(rootMidi,40,76)];
}
function writeHarmonyBass(bass,bar,rootMidi,pattern,quiet){
  const v=quiet?0.35:1;
  const add=(step,len,vel)=>bass.push({step,midi:rootMidi,len,vel:vel*v});
  if(pattern==='hold')add(bar*16,16,0.7);
  else if(pattern==='short'){add(bar*16,1,0.9); add(bar*16+6,1,0.55)}
  else if(pattern==='eighth')[0,4,8,12].forEach(s=>add(bar*16+s,2,0.8));
  else{add(bar*16,8,0.8); add(bar*16+8,8,0.55)}
}
function walkDegrees(midi,steps,root,scale){
  let cur=midi;
  const sign=steps<0?-1:1;
  for(let i=0;i<Math.abs(steps);i++)cur=stepScale(cur,sign,root,scale);
  return cur;
}
function harmonyOption(melody,seed,genre,slot){
  const tone=HARMONY_TONE[genre]||HARMONY_TONE.pop;
  const root=+song.root||0, scale=song.scale||'major';
  const chords=[], bass=[];
  const dirs=[0,1,-1,2];
  for(let b=0;b<song.bars;b++){
    const inBar=melody.filter(n=>Math.floor(n.step/16)===b);
    const pool=inBar.length?inBar:[{midi:60+root}];
    const picked=pool[(slot+(seed%pool.length))%pool.length].midi;
    const turn=(seed%7)-3;
    const center=walkDegrees(picked,(Math.floor(slot/pool.length)?dirs[slot]:0)+turn,root,scale);
    const snapped=snapToScale(center,root,scale);
    let voices=harmonyVoicing(snapped,tone.stamp);
    if(genre==='lofi')voices=voices.map(m=>clamp(m-12,36,64));
    const vel=genre==='lofi'?0.28:0.45;
    voices.forEach(m=>chords.push({step:b*16,midi:m,len:16,vel}));
    writeHarmonyBass(bass,b,clamp(snapped-(genre==='lofi'?36:24),28,52),tone.bass,genre==='lofi');
  }
  return{
    kind:'harmony',
    melody:melody.map(n=>Object.assign({},n)),
    drums:song.track('drums').notes.map(n=>Object.assign({},n)),
    chords,bass,
    tone:{osc:tone.osc,attack:tone.attack,decay:tone.decay,sustain:tone.sustain,release:tone.release},
    seed
  };
}
function paintPreviews(){
  const w=$('#previews'); if(!w)return;
  w.innerHTML='';
  previews.forEach((opt,i)=>{
    const card=document.createElement('article');
    card.className='opt'+(previewWhich===i?' on':'');
    card.innerHTML='<canvas width="320" height="90"></canvas><b></b><div class="bar"><button type="button" data-a="prev">Preview</button><button type="button" data-a="acc">Accept</button></div>';
    card.querySelector('b').textContent=(opt.kind==='harmony'?'Harmony ':'Option ')+(i+1);
    drawMini(card.querySelector('canvas'),opt.melody,notesToGrid(opt.drums),'both');
    card.querySelector('[data-a=prev]').onclick=()=>startPreview(i);
    card.querySelector('[data-a=acc]').onclick=()=>acceptPreview(i);
    w.appendChild(card);
  });
}
function sourceMotif(){return (song.motif&&song.motif.length)?song.motif:melodyNotes()}
function buildPreviews(){
  const motif=sourceMotif();
  if(!motif.length){flash('Hum or load a melody first'); return false}
  if(playing)stopPlay();
  const genre=$('#genre').value, variation=+$('#var').value, mood=$('#mood').value;
  previews=[0,1,2,3].map(()=>makeOption(motif,Math.floor(Math.random()*1e9),genre,variation,mood));
  previewKind='expand'; previewWhich=-1; audition=null;
  paintPreviews();
  return true;
}
let previewKind='expand';
function buildHarmony(){
  const melody=melodyNotes();
  if(!melody.length){flash('Add a melody first'); return false}
  if(playing)stopPlay();
  const genre=$('#genre').value||'pop';
  previews=[0,1,2,3].map(slot=>harmonyOption(melody,Math.floor(Math.random()*1e9),genre,slot));
  previewKind='harmony'; previewWhich=-1; audition=null;
  paintPreviews();
  return true;
}
let savedSwing=null, savedTone=null;
function captureTone(){
  return{osc:song.osc,attack:song.adsr.attack,decay:song.adsr.decay,sustain:song.adsr.sustain,release:song.adsr.release};
}
function applyTone(tone){
  if(!tone)return;
  song.osc=tone.osc;
  song.adsr.attack=tone.attack; song.adsr.decay=tone.decay; song.adsr.sustain=tone.sustain; song.adsr.release=tone.release;
  if(song.patch&&song.patch.envelope){
    song.patch.envelope.attack=tone.attack; song.patch.envelope.decay=tone.decay;
    song.patch.envelope.sustain=tone.sustain; song.patch.envelope.release=tone.release;
  }
  applyOsc();
  const env={attack:tone.attack,decay:tone.decay,sustain:tone.sustain,release:tone.release};
  eng.lead.set({envelope:env});
  eng.bassVoice.set({envelope:env});
  eng.chordVoice.set({oscillator:{type:tone.osc},envelope:env});
}
function startPreview(i){
  const opt=previews[i]; if(!opt)return;
  if(opt.kind!=='harmony'&&opt.swing!=null){
    if(savedSwing==null)savedSwing=hum.swing;
    hum.swing=opt.swing;
    $('#sw').value=Math.round(opt.swing*100); $('#swV').textContent=Math.round(opt.swing*100)+'%';
  }
  if(opt.tone){
    if(!savedTone)savedTone=captureTone();
    applyTone(opt.tone);
  }
  audition=opt.kind==='harmony'?Object.assign({},opt,{
    melody:melodyNotes().map(n=>Object.assign({},n)),
    drums:song.track('drums').notes.map(n=>Object.assign({},n))
  }):opt;
  previewWhich=i; step=0;
  Tone.start().then(()=>{started=true});
  if(Tone.Transport.state==='started')Tone.Transport.stop();
  Tone.Transport.position=0;
  Tone.Transport.start('+0.05');
  setPlay(true); paintPreviews();
}
function acceptPreview(i){
  const opt=previews[i]; if(!opt)return;
  if(opt.kind==='harmony'){
    savedTone=null; savedSwing=null;
    stopPlay();
    pushUndo();
    song.track('chords').notes=opt.chords.map(n=>Object.assign({},n));
    song.track('bass').notes=opt.bass.map(n=>Object.assign({},n));
    applyTone(opt.tone);
    logEvent('accept',{via:'harmony'});
    flash('Harmony accepted');
    paintPreviews();
    return;
  }
  savedSwing=null;
  stopPlay();
  song.track('melody').notes=opt.melody.map(n=>Object.assign({},n));
  song.track('drums').notes=opt.drums.map(n=>Object.assign({},n));
  song.track('chords').notes=opt.chords.map(n=>Object.assign({},n));
  song.track('bass').notes=opt.bass.map(n=>Object.assign({},n));
  hum.swing=opt.swing; $('#sw').value=Math.round(opt.swing*100); $('#swV').textContent=Math.round(opt.swing*100)+'%';
  reflowLyrics(); buildGrid(); drawRoll(null);
  logEvent('accept',{via:'expand'});
  flash('Expansion accepted');
  paintPreviews();
}
function grainFor(note){
  if(note.audioStart!=null&&note.audioEnd!=null&&note.audioEnd>note.audioStart)return note;
  const pool=(song.motif&&song.motif.length)?song.motif:melodyNotes();
  let best=null, dist=1e9;
  pool.forEach(n=>{
    if(n.audioStart==null)return;
    const d=Math.abs((n.srcMidi==null?n.midi:n.srcMidi)-(note.srcMidi==null?note.midi:note.srcMidi));
    if(d<dist){dist=d; best=n}
  });
  return best;
}
const VocalSources={
  take:{ready:true,play(note,time,vel){
    const grain=grainFor(note);
    if(!grain||!vocalAudio)return;
    const srcMidi=grain.srcMidi==null?grain.midi:grain.srcMidi;
    const target=note.midi+(song.trans||0);
    const rate=clamp(Math.pow(2,(target-srcMidi)/12),0.5,2);
    const start=grain.audioStart, avail=Math.max(0.03,(grain.audioEnd||start)-start);
    const noteDur=Math.max(0.05,note.len*Tone.Time('16n').toSeconds());
    const bufDur=Math.min(avail,noteDur*rate,Math.max(0.03,vocalAudio.duration-start));
    if(!(bufDur>0))return;
    const ctx=Tone.getContext().rawContext;
    const src=ctx.createBufferSource();
    src.buffer=vocalAudio; src.playbackRate.value=rate;
    const g=ctx.createGain(); g.gain.value=vel;
    src.connect(g);
    const dest=eng.gains.vocal.input||eng.gains.vocal;
    g.connect(dest);
    try{src.start(time,start,bufDur)}catch(e){try{src.disconnect(); g.disconnect()}catch(err){}}
    src.onended=()=>{try{src.disconnect(); g.disconnect()}catch(err){}};
  }},
  clone:{ready:false,async render(notes){void notes; return null},play(){}}
};
function playVocal(note,time,vel){
  const src=VocalSources[song.voice]||VocalSources.take;
  if(!src.ready)return;
  src.play(note,time,vel);
}

const DEMO=[[0,67,2],[2,69,2],[4,72,4],[8,71,2],[10,69,2],[12,67,4],[16,64,2],[18,67,2],[20,69,4],[24,67,2],[26,64,2],[28,60,4]];
function setPlay(on){
  playing=on;
  $('#play').innerHTML=ICON(on?'stop':'play').replace('class="i"','class="i f"');
  const prod=$('#prodPlay'); if(prod)prod.textContent=on?'Stop':'Play';
  $('#disc').classList.toggle('spin',on);
  if(!on){$('#lab').textContent=''; $('#ringp').setAttribute('stroke-dashoffset',100)}
}
function stopPlay(){
  if(playing){Tone.Transport.stop(); step=0; setPlay(false)}
  if(savedSwing!=null){
    hum.swing=savedSwing;
    $('#sw').value=Math.round(savedSwing*100); $('#swV').textContent=Math.round(savedSwing*100)+'%';
    savedSwing=null;
  }
  if(savedTone){applyTone(savedTone); savedTone=null}
  audition=null; previewWhich=-1;
  if($('#previews'))paintPreviews();
}
// ---- Projects, views and workspace ----
let projects=[], cur=null, mem=[];
try{projects=JSON.parse(localStorage.getItem('awd_projects')||'[]')}catch(e){projects=mem}
function persist(){try{localStorage.setItem('awd_projects',JSON.stringify(projects))}catch(e){mem=projects}}
function ICON(n){return `<svg class="i"><use href="#i-${n}"/></svg>`}
function setRec(on){$('#rec').innerHTML=ICON(on?'stop':'mic').replace('class="i"','class="i f"')+(on?'Stop':'Record')}
function flash(t){const e=$('#toast'); e.textContent=t; clearTimeout(flash.t); flash.t=setTimeout(()=>e.textContent='',1800)}
function projectNotes(p){
  if(p.tracks){const t=p.tracks.find(x=>x.type==='melody'); return (t&&t.notes)||[]}
  return p.clip||[];
}
function projectGrid(p){
  if(p.tracks){const t=p.tracks.find(x=>x.type==='drums'); return notesToGrid((t&&t.notes)||[])}
  return p.drums||notesToGrid([]);
}
function snap(){
  return{id:cur.id,name:$('#pname').value||'Untitled idea',ts:Date.now(),bpm:+$('#bpm').value,swing:+$('#sw').value,vel:+$('#vv').value,drift:+$('#td').value,hz:hum.on,tracks:JSON.parse(JSON.stringify(song.tracks)),slots:song.slots.slice(),bars:song.bars,sections:JSON.parse(JSON.stringify(song.sections)),root:song.root,scale:song.scale,voice:song.voice,motif:JSON.parse(JSON.stringify(song.motif||[])),lyrics:$('#lyr').value,osc:song.osc,trans:song.trans,groups:song.groups,duck:song.duck,useLayer:song.useLayer,patch:song.patch,adsr:song.adsr,laneNames:song.laneNames,drumBars:song.drumBars,choke:song.choke,automation:song.automation,clips:song.clips,latencyOffsetMs:song.latencyOffsetMs,audioRef:song.audioRef};
}
function save(){if(!cur)return; const p=snap(), i=projects.findIndex(x=>x.id==p.id); if(i<0)projects.unshift(p); else projects[i]=p; persist(); pushProjectVersion(p.id,p,{label:'Save'}); storeTake(); flash('Saved')}
async function storeTake(){
  if(!cur||!lastPcm)return;
  try{
    const blob=new Blob([encodeWav(lastPcm.samples,lastPcm.sampleRate)],{type:'audio/wav'});
    song.audioRef=await storeAudioAsset(blob);
    const i=projects.findIndex(item=>item.id==cur.id);
    if(i>=0)projects[i].audioRef=song.audioRef;
    persist();
  }catch(e){}
}
function go(v){
  const studio=$('#v-work').classList.contains('on')||$('#v-producer').classList.contains('on');
  const stay=studio&&(v=='work'||v=='producer');
  if(!stay&&v!='work'){if(cur&&studio)save(); stopPlay()}
  document.querySelectorAll('.view').forEach(e=>e.classList.toggle('on',e.id=='v-'+v));
  $('#navGal').hidden=!projects.length||v=='gallery';
  $('#recBack').hidden=!projects.length;
  if(v=='home')paintHome();
  if(v=='gallery')renderGallery();
  if(v=='split')drawPitchDebug();
  if(v=='work')renderLog();
  if(v=='producer')renderProducer();
  scrollTo(0,0);
}
function setSliders(o){for(const k in o){const e=$('#'+k); if(!e||o[k]==null)continue; e.value=o[k]; if(e.oninput)e.oninput()}}
function applyOsc(){
  eng.lead.set({oscillator:{type:song.osc}});
  document.querySelectorAll('.chip[data-o]').forEach(c=>c.classList.toggle('on',c.dataset.o==song.osc));
  $('#octV').textContent=(song.trans>0?'+':'')+(song.trans/12)+' oct';
}
function resetSong(){
  const fresh=new Song();
  song.tracks=fresh.tracks; song.slots=fresh.slots.slice(); song.osc=fresh.osc; song.trans=0;
  song.root=0; song.scale='major'; song.voice='take'; song.motif=[];
  song.sections=fresh.sections.map(s=>({name:s.name,bars:s.bars}));
  adoptSession(fresh);
  hum.on=true; $('#hz').textContent='Humanize: on'; $('#hz').classList.add('on'); $('#hz').setAttribute('aria-pressed','true');
  $('#lyr').value=''; $('#pname').value='';
  if($('#voiceSrc'))$('#voiceSrc').value='take';
  if($('#keySel'))$('#keySel').value='0';
  if($('#scaleSel'))$('#scaleSel').value='major';
  if($('#keyV'))$('#keyV').textContent='C';
  if($('#scaleV'))$('#scaleV').textContent='Major';
  lastFrames=[]; lastPcm=null; vocalAudio=null; resultReady=false; accepted=false;
  audition=null; previewWhich=-1; previews=[]; savedSwing=null;
  undoStack=[]; redoStack=[];
  setSliders({bpm:100,sw:30,vv:25,td:8}); setGenre('pop');
  setBars(8,{keepSlots:true,sections:song.sections});
  applyOsc(); applyTrackGains(); buildGrid(); buildTrackStrip(); drawRoll(null); drawPitchDebug(); paintPreviews();
}
function newProject(){cur=null; resetSong(); setRec(0); $('#msg').textContent='Allow microphone access when asked, then sing or hum.'; go('record')}
function coerceTracks(p){
  let tracks;
  if(p.tracks&&p.tracks.length)tracks=JSON.parse(JSON.stringify(p.tracks));
  else{
    const melNotes=(p.clip||[]).map(n=>({step:n.step,midi:n.midi,len:n.len,vel:n.vel==null?0.7:n.vel,srcMidi:n.midi,audioStart:null,audioEnd:null,word:'',wordLock:false}));
    tracks=[
      blankTrack('mel','Sound','melody',0.8,melNotes),
      blankTrack('drm','Beat','drums',0.9,gridToNotes(p.drums||[]))
    ];
  }
  tracks.forEach(t=>{
    if(t.type!=='melody')return;
    t.notes.forEach(n=>{
      if(n.word==null)n.word='';
      if(n.wordLock==null)n.wordLock=false;
      if(n.srcMidi==null)n.srcMidi=n.midi;
    });
  });
  return ensureTracks(tracks);
}
function openProject(p){
  cur={id:p.id};
  undoStack=[]; redoStack=[];
  song.tracks=coerceTracks(p);
  const bars=clamp(Math.round(p.bars||(p.slots&&p.slots.length)||8),4,32);
  song.slots=p.slots?[...p.slots]:['drums','drums','both','both','both','both','melody','drums'];
  while(song.slots.length<bars)song.slots.push('both');
  if(song.slots.length>bars)song.slots.length=bars;
  song.osc=p.osc||'triangle'; song.trans=p.trans||0;
  song.root=+p.root||0; song.scale=p.scale||'major'; song.voice=p.voice||'take';
  song.motif=p.motif?JSON.parse(JSON.stringify(p.motif)):[];
  const sections=(p.sections&&p.sections.reduce((s,x)=>s+(+x.bars||0),0)===bars)?p.sections.map(s=>({name:s.name,bars:+s.bars})):null;
  $('#lyr').value=p.lyrics||''; $('#pname').value=p.name||'';
  if($('#voiceSrc'))$('#voiceSrc').value=song.voice==='clone'?'clone':'take';
  if($('#keySel'))$('#keySel').value=String(song.root);
  if($('#scaleSel'))$('#scaleSel').value=song.scale;
  if($('#keyV'))$('#keyV').textContent=KEYS[song.root]||'C';
  if($('#scaleV')){const opt=$('#scaleSel').selectedOptions[0]; $('#scaleV').textContent=opt?opt.textContent:'Major'}
  if(!melodyNotes().some(n=>n.word))reflowLyrics();
  setSliders({bpm:p.bpm,sw:p.swing,vv:p.vel,td:p.drift});
  setBpm(p.bpm||100);
  setBars(bars,{keepSlots:true,sections:sections||undefined});
  hum.on=p.hz!==false; $('#hz').textContent='Humanize: '+(hum.on?'on':'off'); $('#hz').classList.toggle('on',hum.on); $('#hz').setAttribute('aria-pressed',hum.on);
  adoptSession(p);
  if(p.clips)song.clips=JSON.parse(JSON.stringify(p.clips));
  applyOsc(); applyTrackGains(); buildGrid(); buildTrackStrip(); drawRoll(null); openTab('beat'); go('work');
  if(p.audioRef)hydrateTake(p.audioRef);
}
function paintHome(){
  const notes=DEMO.map(([step,midi,len])=>({step,midi,len}));
  const grid=[
    [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],
    [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,1],
    [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0]
  ];
  const sound=$('#homeSound'), beat=$('#homeBeat');
  if(sound)drawMini(sound,notes,grid,'notes');
  if(beat)drawMini(beat,notes,grid,'beat');
}
function renderGallery(){
  const g=$('#cards'); g.innerHTML='';
  const nb=document.createElement('button'); nb.className='card new'; nb.innerHTML=ICON('plus')+'New project'; nb.onclick=newProject; g.appendChild(nb);
  projects.forEach(p=>{
    const notes=projectNotes(p), grid=projectGrid(p);
    const c=document.createElement('div'); c.className='card'; c.tabIndex=0; c.setAttribute('role','button');
    c.innerHTML=`<canvas width="320" height="150"></canvas><div class="cm"><b></b><span></span></div><button class="del" aria-label="Delete project">${ICON('trash')}</button>`;
    c.querySelector('b').textContent=p.name;
    c.querySelector('.cm span').textContent=`${p.bpm} BPM · ${notes.length} notes · ${new Date(p.ts).toLocaleDateString(undefined,{month:'short',day:'numeric'})}`;
    drawMini(c.querySelector('canvas'),notes,grid,'both');
    c.onclick=()=>openProject(p); c.onkeydown=e=>{if(e.key=='Enter')openProject(p)};
    const d=c.querySelector('.del');
    d.onclick=e=>{e.stopPropagation(); if(d.dataset.arm){projects=projects.filter(x=>x.id!=p.id); persist(); renderGallery(); if(!projects.length)go('record')}
      else{d.dataset.arm=1; d.classList.add('arm'); flash('Tap again to delete'); setTimeout(()=>{delete d.dataset.arm; d.classList.remove('arm')},2500)}};
    g.appendChild(c);
  });
}
function toSplit(){
  ['pS','pL','pB'].forEach(i=>$('#'+i).classList.add('busy'));
  $('#goWork').disabled=true;
  $('#sTitle').textContent='Splitting your idea';
  $('#sL').textContent='Reading the words'; $('#sL').classList.remove('none');
  go('split');
  setTimeout(()=>{
    const mel=melodyNotes(), grid=notesToGrid(song.track('drums').notes);
    drawMini($('#cS'),mel,grid,'notes'); $('#mS').textContent=mel.length+' notes'; $('#pS').classList.remove('busy');
  },500);
  setTimeout(()=>{
    const mel=melodyNotes(), grid=notesToGrid(song.track('drums').notes);
    drawMini($('#cB'),mel,grid,'beat'); $('#mB').textContent=$('#bpm').value+' BPM, '+grid.flat().filter(Boolean).length+' hits'; $('#pB').classList.remove('busy');
  },1000);
}
function fillLyrics(){
  const w=$('#lyr').value.trim();
  $('#sL').textContent=w||'No words picked up. You can type them in the workspace.';
  $('#sL').classList.toggle('none',!w);
  setTimeout(()=>{$('#pL').classList.remove('busy'); $('#sTitle').textContent='Your idea, in three parts'; $('#goWork').disabled=false},300);
}
function openTab(t){
  document.querySelectorAll('#v-work .tab').forEach(b=>b.classList.toggle('on',b.dataset.t==t));
  ['sound','lyrics','beat','expand'].forEach(n=>$('#t-'+n).hidden=n!=t);
  drawRoll(null);
}
function openWork(t){
  if($('#v-split').classList.contains('on')&&!accepted){accepted=true; logEvent('accept')}
  if(!cur){cur={id:Date.now()}; $('#pname').value='Idea '+(projects.length+1)}
  save(); refreshSong(); openTab(t); go('work');
}

async function togglePlay(){
  if(!started){await Tone.start(); started=true}
  const here=$('#v-work').classList.contains('on')||$('#v-producer').classList.contains('on');
  if(!here)return;
  if(playing)stopPlay(); else{step=0; Tone.Transport.start('+0.05'); setPlay(true)}
}
$('#play').onclick=togglePlay;
$('#rec').onclick=record;
$('#demo').onclick=()=>{
  const genre=($('#genre')&&$('#genre').value)||'pop';
  const pick={pop:'rnb-latenight',rnb:'rnb-latenight',rap:'trap-hook',lofi:'lofi-sketch',rock:'acoustic-ballad'}[genre];
  const template=STARTER_TEMPLATES.find(item=>item.id===pick);
  if(template&&template.melody){
    song.track('melody').notes=template.melody.map(note=>({step:note.x|0,midi:parsePitchToMidi(note.n),len:Math.max(1,Math.round(note.w||1)),vel:note.v==null?0.7:note.v,srcMidi:parsePitchToMidi(note.n),audioStart:null,audioEnd:null,word:'',wordLock:false}));
    if(template.drums){
      const lane={kick:0,snare:1,hat:2,openhat:3,clap:1};
      const hits=[];
      Object.entries(template.drums).forEach(([name,steps])=>{
        if(!Array.isArray(steps)||lane[name]==null)return;
        steps.forEach(hit=>{
          const step=hit|0, index=lane[name];
          if(hits.some(item=>item.step===step&&item.lane===index))return;
          hits.push({step,lane:index,len:1,vel:0.8,nudge:0});
        });
      });
      if(hits.length){
        song.track('drums').notes=hits;
        const names=['Kick','Snare','Hat'];
        if(hits.some(hit=>hit.lane===3))names.push('Open hat');
        song.laneNames=names;
        song.choke={2:1};
        if(names.length>3)song.choke[3]=1;
      }
    }
    if(template.bass)song.track('bass').notes=template.bass.map(note=>({step:note.x|0,midi:parsePitchToMidi(note.n),len:Math.max(1,Math.round(note.w||1)),vel:note.v==null?0.8:note.v}));
    if(template.bpm)setBpm(template.bpm);
  }else song.track('melody').notes=DEMO.map(([step,midi,len])=>({step,midi,len,vel:0.7,srcMidi:midi,audioStart:null,audioEnd:null,word:'',wordLock:false}));
  song.motif=song.track('melody').notes.map(n=>Object.assign({},n));
  $('#lyr').value='Walking through the city lights tonight';
  reflowLyrics();
  drawRoll(null); toSplit(); setTimeout(fillLyrics,1300);
};
$('#lyr').oninput=()=>{reflowLyrics(); drawRoll(null)};
$('#roll').onpointerdown=e=>{
  if(e.button!=null&&e.button!==0)return;
  const c=$('#roll'), rect=c.getBoundingClientRect();
  if(!rect.width)return;
  const note=noteAtPoint(e.clientX,e.clientY);
  if(!note)return;
  const steps=songSteps(), g=rollSpan(melodyNotes(),null);
  const right=rect.left+((note.step+note.len)/steps)*rect.width;
  const notePx=(note.len/steps)*rect.width;
  rollDrag={
    note, mode:notePx>=16&&e.clientX>=right-8?'len':'move',
    x:e.clientX, y:e.clientY, step:note.step, midi:note.midi, len:note.len,
    pxStep:rect.width/steps, pxSemi:Math.max(8,rect.height/g.span), steps,
    lock:{lo:g.lo,span:g.span}, moved:false, pushed:false
  };
  try{c.setPointerCapture(e.pointerId)}catch(err){}
  e.preventDefault();
};
$('#roll').onpointermove=e=>{
  if(!rollDrag)return;
  const dx=e.clientX-rollDrag.x, dy=e.clientY-rollDrag.y;
  if(!rollDrag.moved&&Math.hypot(dx,dy)<4)return;
  if(!rollDrag.pushed){pushUndo(); rollDrag.pushed=true}
  rollDrag.moved=true;
  const n=rollDrag.note, dStep=Math.round(dx/rollDrag.pxStep), dSemi=Math.round(-dy/rollDrag.pxSemi);
  if(rollDrag.mode==='len')n.len=clamp(rollDrag.len+dStep,1,rollDrag.steps-n.step);
  else{
    n.midi=clamp(rollDrag.midi+dSemi,36,84);
    n.step=clamp(rollDrag.step+dStep,0,rollDrag.steps-n.len);
  }
  drawRoll(null);
};
$('#roll').onpointerup=e=>{
  if(!rollDrag)return;
  const drag=rollDrag;
  rollDrag=null;
  if(!drag.moved)editWord(drag.note,e.clientX,e.clientY);
  else{drawRoll(null); logEdit('note')}
};
$('#roll').onpointercancel=()=>{if(rollDrag&&rollDrag.moved)drawRoll(null); rollDrag=null};
KEYS.forEach((name,i)=>{const o=document.createElement('option'); o.value=String(i); o.textContent=name; $('#keySel').appendChild(o)});
$('#keySel').oninput=()=>{song.root=+$('#keySel').value; $('#keyV').textContent=KEYS[song.root]};
$('#scaleSel').oninput=()=>{song.scale=$('#scaleSel').value; $('#scaleV').textContent=$('#scaleSel').selectedOptions[0].textContent};
$('#genre').oninput=()=>{$('#genreV').textContent=$('#genre').selectedOptions[0].textContent};
$('#mood').oninput=()=>{$('#moodV').textContent=$('#mood').selectedOptions[0].textContent};
$('#var').oninput=()=>{$('#varV').textContent=$('#var').value+'%'};
$('#bars').oninput=()=>setBars($('#bars').value);
$('#buildExp').onclick=()=>buildPreviews();
$('#buildHarm').onclick=()=>buildHarmony();
$('#regenExp').onclick=()=>{
  if(previewKind==='harmony'){
    if(!melodyNotes().length){flash('Add a melody first'); return}
    logEvent('regenerate',{via:'harmony'});
    buildHarmony();
    return;
  }
  if(!sourceMotif().length){flash('Hum or load a melody first'); return}
  logEvent('regenerate',{via:'expand'});
  buildPreviews();
};
$('#voiceSrc').oninput=()=>{
  song.voice=$('#voiceSrc').value;
  if(song.voice==='clone')flash('Voice clone API is not connected yet');
};
$('#upl').onclick=()=>$('#file').click();
$('#file').onchange=async e=>{
  const f=e.target.files[0]; if(!f)return;
  try{
    await Tone.start(); started=true; genreManual=false; $('#msg').textContent='Reading audio...';
    const ab=await Tone.getContext().rawContext.decodeAudioData(await f.arrayBuffer());
    if(resultReady)logEvent('regenerate',{via:'upload'});
    storePcm(ab.getChannelData(0),ab.sampleRate);
    await analyze(null,{logFirst:true,fresh:true});
    toSplit(); setTimeout(fillLyrics,1300);
    $('#lyrNote').textContent='Lyrics are not transcribed from uploads. Type your own words.';
  }catch(err){$('#msg').textContent='Could not read that audio file ('+(err.name||'error')+'). Try an mp3, m4a, or wav.'}
  e.target.value='';
};
$('#reana').onclick=async()=>{
  if(!lastPcm){flash('Record or upload audio first'); return}
  logEvent('regenerate',{via:'reanalyze'});
  await analyze(+$('#bpm').value,{logFirst:false});
};
$('#clr').onclick=()=>{pushUndo(); song.track('melody').notes=[]; drawRoll(null); logEdit('clear')};
$('#hz').onclick=e=>{hum.on=!hum.on; e.target.textContent='Humanize: '+(hum.on?'on':'off'); e.target.classList.toggle('on',hum.on); e.target.setAttribute('aria-pressed',hum.on)};
$('#countIn').onclick=e=>{
  const on=e.currentTarget.getAttribute('aria-pressed')!=='true';
  e.currentTarget.setAttribute('aria-pressed',on);
  e.currentTarget.classList.toggle('on',on);
  e.currentTarget.textContent='Count-in: '+(on?'on':'off');
};
$('#genre').onchange=()=>{genreManual=true; setGenre($('#genre').value)};
$('#bpm').oninput=()=>setBpm($('#bpm').value);
$('#recBpm').oninput=()=>setBpm($('#recBpm').value);
[['sw',v=>hum.swing=v/100,v=>v+'%'],
 ['vv',v=>hum.vel=v/100,v=>v+'%'],
 ['td',v=>hum.drift=+v,v=>v+' ms']].forEach(([id,fn,lab])=>{
  const el=$('#'+id), out=$('#'+id+'V');
  el.oninput=()=>{fn(el.value); out.textContent=lab(el.value)};
});
[['rmsMin','rmsV',v=>v.toFixed(3)],
 ['clarityMin','clarV',v=>v.toFixed(2)],
 ['octaveFold','octFV',v=>String(v)],
 ['octaveTol','octTV',v=>String(v)],
 ['medianN','medV',v=>String(v)],
 ['minVotes','voteV',v=>String(v)]].forEach(([id,out,fmt])=>{
  $('#'+id).oninput=async()=>{
    tune[id]=+$('#'+id).value;
    $('#'+out).textContent=fmt(tune[id]);
    if(lastPcm)await analyze(+$('#bpm').value||100,{logFirst:false,drums:false});
    else drawPitchDebug();
  };
});
$('#plogExport').onclick=()=>{
  const blob=new Blob([JSON.stringify(plog,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='producer-log.json'; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
};
$('#plogClear').onclick=()=>{plog={events:[]}; try{localStorage.removeItem(LOG_KEY)}catch(e){} renderLog(); flash('Log cleared')};
document.addEventListener('keydown',e=>{
  const tag=e.target&&e.target.tagName;
  const typing=tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||(e.target&&e.target.isContentEditable);
  if((e.ctrlKey||e.metaKey)&&e.code==='KeyZ'&&!typing){
    e.preventDefault();
    if(e.shiftKey)redoEdit(); else undoEdit();
    return;
  }
  if(e.code!=='Space')return;
  if(typing)return;
  if(e.repeat)return;
  if(session){e.preventDefault(); session.stop(); return}
  if($('#v-work').classList.contains('on')||$('#v-producer').classList.contains('on')){e.preventDefault(); togglePlay()}
});
document.querySelectorAll('#v-work .tab').forEach(b=>b.onclick=()=>{openTab(b.dataset.t); save()});
document.querySelectorAll('.chip[data-o]').forEach(c=>c.onclick=()=>{song.osc=c.dataset.o; applyOsc()});
$('#octD').onclick=()=>{song.trans=Math.max(-24,song.trans-12); applyOsc()};
$('#octU').onclick=()=>{song.trans=Math.min(24,song.trans+12); applyOsc()};
$('#eS').onclick=()=>openWork('sound'); $('#eL').onclick=()=>openWork('lyrics'); $('#eB').onclick=()=>openWork('beat'); $('#goWork').onclick=()=>openWork('sound');
$('#saveBtn').onclick=save; $('#brand').onclick=()=>go('home'); $('#navGal').onclick=()=>go('gallery'); $('#recBack').onclick=()=>go('gallery');
document.querySelectorAll('[data-land="start"]').forEach(b=>b.onclick=newProject);
document.querySelectorAll('[data-land="upload"]').forEach(b=>b.onclick=()=>{newProject(); $('#file').click()});
document.querySelectorAll('[data-land="projects"]').forEach(b=>b.onclick=()=>go('gallery'));
function adoptSession(source){
  song.groups=source.groups?JSON.parse(JSON.stringify(source.groups)):defaultGroupBuses();
  song.duck=!!source.duck;
  song.useLayer=!!source.useLayer;
  song.patch=source.patch?JSON.parse(JSON.stringify(source.patch)):structuredClone(DEFAULT_3XOSC_PATCH);
  song.adsr=source.adsr?JSON.parse(JSON.stringify(source.adsr)):structuredClone(DEFAULT_ADSR);
  song.laneNames=source.laneNames?[...source.laneNames]:['Kick','Snare','Hat'];
  song.drumBars=source.drumBars||1;
  song.choke=source.choke?Object.assign({},source.choke):{2:1};
  song.automation=source.automation?JSON.parse(JSON.stringify(source.automation)):{};
  song.clips=source.clips?JSON.parse(JSON.stringify(source.clips)):rebuildClips(song.slots);
  song.latencyOffsetMs=+source.latencyOffsetMs||0;
  song.audioRef=source.audioRef||null;
  freshSessionFields(song);
  if(typeof eng!=='undefined')eng.wire();
}
async function hydrateTake(ref){
  try{
    const blob=await resolveAudioAsset(ref);
    if(!blob)return;
    const audio=await Tone.getContext().rawContext.decodeAudioData(await blob.arrayBuffer());
    storePcm(audio.getChannelData(0),audio.sampleRate);
  }catch(e){}
}
function refreshSong(){
  buildSections(); buildSlots(); buildGrid(); buildTrackStrip(); drawRoll(null); applyTrackGains();
}
function downloadBlob(blob,name){
  const link=document.createElement('a');
  link.href=URL.createObjectURL(blob);
  link.download=name;
  link.click();
  setTimeout(()=>URL.revokeObjectURL(link.href),1500);
}
function songSnapshot(){
  return{tracks:song.tracks,slots:song.slots,bars:song.bars,groups:song.groups,duck:song.duck,useLayer:song.useLayer,patch:song.patch,adsr:song.adsr,drumBars:song.drumBars,choke:song.choke,automation:song.automation,clips:song.clips,trans:song.trans,track:type=>song.track(type)};
}
async function exportWav(){
  flash('Rendering WAV...');
  const rendered=await renderSong(songSnapshot(),{bpm:+$('#bpm').value||100,swing:hum.on?hum.swing*100:0,humanize:hum.on,vocalBuffer:vocalAudio});
  const peaks=calculateAudioPeaks(rendered.left,rendered.right);
  const loud=estimateIntegratedLufs(rendered.left,rendered.right,rendered.sampleRate);
  downloadBlob(new Blob([stereoWav(rendered.left,rendered.right,rendered.sampleRate)],{type:'audio/wav'}),( $('#pname').value||'song')+'.wav');
  flash('Approximate loudness '+loud.lufs+' LUFS, peak '+peaks.truePeakDb.toFixed(1)+' dBTP');
}
async function exportStems(){
  flash('Rendering stems...');
  const listed=resolveStemTracks(song.tracks.map(track=>({id:track.type,name:track.name,kind:track.type})),{playlist:{tracks:song.tracks.filter(track=>track.notes&&track.notes.length).map(track=>({id:track.type,clips:[{id:track.id}]}))}});
  const files=[];
  for(const stem of listed){
    const rendered=await renderSong(songSnapshot(),{bpm:+$('#bpm').value||100,only:stem.id,swing:hum.on?hum.swing*100:0,humanize:hum.on,vocalBuffer:stem.id==='vocal'?vocalAudio:null});
    files.push({name:sharePackStemName($('#pname').value,stem.id),data:new Uint8Array(stereoWav(rendered.left,rendered.right,rendered.sampleRate))});
  }
  if(!files.length){flash('Nothing to export yet'); return}
  downloadBlob(new Blob([createZipArchive(files)],{type:'application/zip'}),'stems.zip');
  flash('Stems ready');
}
function exportMidiFile(){
  const bytes=encodeMidi({bpm:+$('#bpm').value||100,bars:song.bars,melody:song.track('melody').notes,chords:song.track('chords').notes,bass:song.track('bass').notes,drums:song.track('drums').notes});
  downloadBlob(new Blob([bytes],{type:'audio/midi'}),($('#pname').value||'song')+'.mid');
  flash('MIDI downloaded');
}
async function exportPack(){
  flash('Packing the song...');
  const rendered=await renderSong(songSnapshot(),{bpm:+$('#bpm').value||100,swing:hum.on?hum.swing*100:0,humanize:hum.on,vocalBuffer:vocalAudio});
  const wav=new Uint8Array(stereoWav(rendered.left,rendered.right,rendered.sampleRate));
  const midi=encodeMidi({bpm:+$('#bpm').value||100,bars:song.bars,melody:song.track('melody').notes,chords:song.track('chords').notes,bass:song.track('bass').notes,drums:song.track('drums').notes});
  const project=snap();
  const readme=generateSharePackReadme({name:project.name,bpm:project.bpm,key:KEYS[song.root]+' '+song.scale,meter:'4/4',sections:song.sections.map(section=>({name:section.name,bars:section.bars,active:{}}))});
  const zip=createZipArchive([
    {name:'master.wav',data:wav},
    {name:'song.mid',data:midi},
    {name:'project.json',data:JSON.stringify(project)},
    {name:'README.txt',data:readme}
  ]);
  downloadBlob(new Blob([zip],{type:'application/zip'}),(project.name||'song')+'-share.zip');
  flash('Share pack downloaded');
}
installProducer({
  song:()=>song,
  flash,
  save,
  togglePlay,
  refreshSong,
  applyMix:()=>{eng.wire(); applyTrackGains()},
  mountFaders,
  applyEnvelope:()=>{
    const env=song.adsr;
    eng.lead.set({envelope:{attack:env.attack,decay:env.decay,sustain:env.sustain,release:env.release}});
    eng.bassVoice.set({envelope:{attack:env.attack,decay:env.decay,sustain:env.sustain,release:env.release}});
  },
  pushUndo,
  syncClips:()=>{song.clips=rebuildClips(song.slots)},
  vocalBuffer:()=>vocalAudio,
  projectName:()=>$('#pname').value||'Untitled idea',
  projectId:()=>cur&&cur.id,
  bpm:()=>+$('#bpm').value||100,
  exportWav,
  exportStems,
  exportMidi:exportMidiFile,
  exportPack,
  restore:snapshot=>{openProject(snapshot); go('producer'); flash('Version restored')},
  back:()=>{refreshSong(); go('work')}
});
$('#producerBtn').onclick=()=>{
  if(!cur){cur={id:Date.now()}; $('#pname').value='Idea '+(projects.length+1)}
  if(!song.clips.length)song.clips=rebuildClips(song.slots);
  save();
  go('producer');
};
setInterval(()=>{
  const read=$('#peakRead');
  if(!read||!$('#v-producer').classList.contains('on'))return;
  const peak=eng.peak();
  const db=peak>0.0001?20*Math.log10(peak):-70;
  read.textContent='Peak '+db.toFixed(1)+' dB';
},250);
mountFaders(); setBpm(100); setPlay(false); setRec(0); renderLog(); resetSong(); go('home');
