let audioCtx, analyser, source, data, running=false, stream=null, master=null, compressor=null;
let bpm=100, targetBpm=100, lastOnset=0, onsetTimes=[], nextStep=0, timer=null, style="rock", intensity=.75, step=0;
let envelope=0, prevEnvelope=0, noiseFloor=.008, lastTempoUpdate=0;
const $=id=>document.getElementById(id);

$("intensity").oninput=e=>{intensity=e.target.value/100;$("intensityText").textContent=e.target.value+"%"};
document.querySelectorAll(".style").forEach(b=>b.onclick=()=>{
  document.querySelectorAll(".style").forEach(x=>x.classList.remove("active"));
  b.classList.add("active"); style=b.dataset.style;
});

$("listen").onclick=async()=>{
  if(running){stop();return}
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:{
      echoCancellation:false, noiseSuppression:false, autoGainControl:false, channelCount:1
    }});
    audioCtx=new (window.AudioContext||window.webkitAudioContext)({latencyHint:"interactive"});
    await audioCtx.resume();

    compressor=audioCtx.createDynamicsCompressor();
    compressor.threshold.value=-18;
    compressor.knee.value=12;
    compressor.ratio.value=4;
    compressor.attack.value=.003;
    compressor.release.value=.18;

    master=audioCtx.createGain();
    master.gain.value=2.25;
    master.connect(compressor).connect(audioCtx.destination);

    const keepAlive=audioCtx.createGain();
    keepAlive.gain.value=.00001;
    keepAlive.connect(audioCtx.destination);

    source=audioCtx.createMediaStreamSource(stream);
    analyser=audioCtx.createAnalyser();
    analyser.fftSize=1024;
    analyser.smoothingTimeConstant=.05;
    source.connect(analyser);
    data=new Float32Array(analyser.fftSize);

    running=true; step=0; onsetTimes=[]; lastOnset=0;
    bpm=100; targetBpm=100; noiseFloor=.008; envelope=0; prevEnvelope=0;
    $("bpm").textContent="--";
    $("listen").textContent="STOP"; $("listen").classList.add("stop");
    $("status").textContent="Listening — play a steady rhythm for a few seconds";
    nextStep=audioCtx.currentTime+.08;
    requestAnimationFrame(analyse);
    timer=setInterval(schedule,20);
  }catch(e){
    $("status").textContent="Microphone access is required. Please allow it in Safari.";
    console.error(e);
  }
};

function stop(){
  running=false;
  clearInterval(timer); timer=null;
  if(stream) stream.getTracks().forEach(t=>t.stop());
  stream=null;
  if(audioCtx && audioCtx.state!=="closed") audioCtx.close();
  $("listen").textContent="LISTEN"; $("listen").classList.remove("stop");
  $("status").textContent="Ready";
}

function analyse(){
  if(!running)return;
  analyser.getFloatTimeDomainData(data);
  let sum=0, peak=0;
  for(let i=0;i<data.length;i++){
    const x=Math.abs(data[i]); sum+=x*x; if(x>peak)peak=x;
  }
  const rms=Math.sqrt(sum/data.length);
  const level=Math.min(1,rms*8);
  $("level").style.width=(level*100)+"%";
  $("meter").style.setProperty("--rot",(level*300-150)+"deg");

  // Track background level slowly, but don't let strong playing raise it quickly.
  if(rms < noiseFloor*2.2) noiseFloor=noiseFloor*.985+rms*.015;
  noiseFloor=Math.max(.003,Math.min(.03,noiseFloor));

  prevEnvelope=envelope;
  envelope=envelope*.62+rms*.38;
  const rise=envelope-prevEnvelope;
  const threshold=Math.max(.012,noiseFloor*2.5);
  const now=performance.now()/1000;

  // Guitar attack = enough level plus a sharp rise, with a short refractory period.
  if(envelope>threshold && rise>Math.max(.0025,noiseFloor*.18) && now-lastOnset>.11){
    lastOnset=now;
    onsetTimes.push(now);
    // Only recent playing should control tempo.
    onsetTimes=onsetTimes.filter(t=>now-t<5.0).slice(-24);
    updateTempo(now);
  }

  // Smoothly chase the detected tempo.
  bpm += (targetBpm-bpm)*.035;
  if(onsetTimes.length>=4) $("bpm").textContent=Math.round(bpm);
  requestAnimationFrame(analyse);
}

function updateTempo(now){
  if(onsetTimes.length<4 || now-lastTempoUpdate<.08)return;
  lastTempoUpdate=now;

  const intervals=[];
  for(let i=1;i<onsetTimes.length;i++){
    let d=onsetTimes[i]-onsetTimes[i-1];
    if(d>=.16 && d<=1.35) intervals.push(d);
  }
  if(intervals.length<3)return;

  // Weighted candidate voting: recent intervals matter more.
  const candidates=[];
  intervals.forEach((d,i)=>{
    let x=60/d;
    while(x<60)x*=2;
    while(x>180)x/=2;
    candidates.push({b:x,w:1+i/intervals.length});
  });

  let best=targetBpm, bestScore=-1;
  for(let c=60;c<=180;c+=1){
    let score=0;
    for(const x of candidates){
      const err=Math.abs(x.b-c);
      score += x.w*Math.exp(-(err*err)/(2*7*7));
    }
    // Small continuity preference, not enough to cause lock-in.
    score += .35*Math.exp(-Math.pow(c-targetBpm,2)/(2*14*14));
    if(score>bestScore){bestScore=score;best=c}
  }

  // If recent attacks clearly shift, allow a fast catch-up.
  const delta=Math.abs(best-targetBpm);
  targetBpm = delta>18 ? targetBpm*.25+best*.75 : targetBpm*.55+best*.45;
  targetBpm=Math.max(60,Math.min(180,targetBpm));
  $("status").textContent="Following your rhythm";
}

function schedule(){
  if(!running || !audioCtx)return;
  const lookAhead=.13;
  const eighth=(60/Math.max(60,Math.min(180,bpm)))/2;
  while(nextStep<audioCtx.currentTime+lookAhead){
    playStep(step,nextStep);
    nextStep+=eighth;
    step=(step+1)%8;
  }
}

function out(node){ node.connect(master); }

function playStep(s,t){
  let k=false,sn=false,hat=true,open=false;
  if(style==="rock"){k=[0,4].includes(s);sn=[2,6].includes(s);open=s===7}
  else if(style==="blues"){k=[0,3,4].includes(s);sn=[2,6].includes(s);hat=[0,2,4,6].includes(s)}
  else if(style==="country"){k=[0,4].includes(s);sn=[2,6].includes(s);hat=true}
  else if(style==="funk"){k=[0,3,4,7].includes(s);sn=[2,6].includes(s);hat=true;open=s===5}
  if(k)kick(t,.92*intensity);
  if(sn)snare(t,.78*intensity);
  if(hat)hiHat(t,open?.18:.05,.32*intensity);
}

function kick(t,a){
  const o=audioCtx.createOscillator(),g=audioCtx.createGain();
  o.type="sine";o.frequency.setValueAtTime(155,t);o.frequency.exponentialRampToValueAtTime(48,t+.12);
  g.gain.setValueAtTime(Math.max(.001,a),t);g.gain.exponentialRampToValueAtTime(.001,t+.22);
  o.connect(g);out(g);o.start(t);o.stop(t+.23);
}
function noiseBuffer(){
  const b=audioCtx.createBuffer(1,audioCtx.sampleRate*.35,audioCtx.sampleRate),d=b.getChannelData(0);
  for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
  return b;
}
function snare(t,a){
  const n=audioCtx.createBufferSource(),ng=audioCtx.createGain(),hp=audioCtx.createBiquadFilter();
  n.buffer=noiseBuffer();hp.type="highpass";hp.frequency.value=850;
  ng.gain.setValueAtTime(Math.max(.001,a*.85),t);ng.gain.exponentialRampToValueAtTime(.001,t+.18);
  n.connect(hp).connect(ng);out(ng);n.start(t);n.stop(t+.2);
  const o=audioCtx.createOscillator(),g=audioCtx.createGain();
  o.type="triangle";o.frequency.value=190;
  g.gain.setValueAtTime(Math.max(.001,a*.4),t);g.gain.exponentialRampToValueAtTime(.001,t+.1);
  o.connect(g);out(g);o.start(t);o.stop(t+.11);
}
function hiHat(t,dur,a){
  const n=audioCtx.createBufferSource(),g=audioCtx.createGain(),hp=audioCtx.createBiquadFilter();
  n.buffer=noiseBuffer();hp.type="highpass";hp.frequency.value=6200;
  g.gain.setValueAtTime(Math.max(.001,a),t);g.gain.exponentialRampToValueAtTime(.001,t+dur);
  n.connect(hp).connect(g);out(g);n.start(t);n.stop(t+dur+.02);
}
document.addEventListener("visibilitychange",async()=>{
  if(!document.hidden&&running&&audioCtx?.state==="suspended"){try{await audioCtx.resume()}catch(e){}}
});