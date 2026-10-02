let audioCtx, analyser, source, data, running=false, stream=null;
let bpm=100, lastOnset=0, intervals=[], nextStep=0, timer=null, style="rock", intensity=.75, step=0;
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

    // A silent output keeps Web Audio active more reliably on mobile Safari.
    const keepAlive=audioCtx.createGain();
    keepAlive.gain.value=0.00001;
    keepAlive.connect(audioCtx.destination);

    source=audioCtx.createMediaStreamSource(stream);
    analyser=audioCtx.createAnalyser();
    analyser.fftSize=2048;
    analyser.smoothingTimeConstant=.12;
    source.connect(analyser);
    data=new Float32Array(analyser.fftSize);

    running=true; step=0;
    $("listen").textContent="STOP"; $("listen").classList.add("stop");
    $("status").textContent="Listening — play your guitar";
    lastOnset=0; intervals=[]; nextStep=audioCtx.currentTime+.05;
    requestAnimationFrame(analyse);
    timer=setInterval(schedule,25);
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
  let sum=0,peak=0;
  for(let i=0;i<data.length;i++){const x=Math.abs(data[i]);sum+=x*x;if(x>peak)peak=x}
  const rms=Math.sqrt(sum/data.length);
  const level=Math.min(1,rms*7);
  $("level").style.width=(level*100)+"%";
  $("meter").style.setProperty("--rot",(level*300-150)+"deg");

  const now=performance.now()/1000;
  if(rms>.035 && peak>.13 && now-lastOnset>.16){
    const dt=now-lastOnset;
    if(lastOnset && dt<2){
      intervals.push(dt);
      if(intervals.length>12) intervals.shift();
      const sorted=[...intervals].sort((a,b)=>a-b);
      let med=sorted[Math.floor(sorted.length/2)];
      let est=60/med;
      while(est<60) est*=2;
      while(est>180) est/=2;
      if(est>=55&&est<=180){
        bpm=bpm*.78+est*.22;
        $("bpm").textContent=Math.round(bpm);
      }
    }
    lastOnset=now;
  }
  requestAnimationFrame(analyse);
}

function schedule(){
  if(!running || !audioCtx)return;
  const lookAhead=.12;
  const eighth=(60/Math.max(55,Math.min(180,bpm)))/2;
  while(nextStep<audioCtx.currentTime+lookAhead){
    playStep(step,nextStep);
    nextStep+=eighth;
    step=(step+1)%8;
  }
}

function playStep(s,t){
  let k=false, sn=false, hat=true, open=false;
  if(style==="rock"){
    k=[0,4].includes(s); sn=[2,6].includes(s); open=s===7;
  }else if(style==="blues"){
    k=[0,3,4].includes(s); sn=[2,6].includes(s); hat=[0,2,4,6].includes(s);
  }else if(style==="country"){
    k=[0,4].includes(s); sn=[2,6].includes(s); hat=true;
  }else if(style==="funk"){
    k=[0,3,4,7].includes(s); sn=[2,6].includes(s); hat=true; open=s===5;
  }
  if(k) kick(t,.8*intensity);
  if(sn) snare(t,.62*intensity);
  if(hat) hiHat(t,open?.16:.045,.22*intensity);
}

function kick(t,a){
  const o=audioCtx.createOscillator(), g=audioCtx.createGain();
  o.type="sine";
  o.frequency.setValueAtTime(145,t);
  o.frequency.exponentialRampToValueAtTime(48,t+.11);
  g.gain.setValueAtTime(Math.max(.001,a),t);
  g.gain.exponentialRampToValueAtTime(.001,t+.18);
  o.connect(g).connect(audioCtx.destination);
  o.start(t); o.stop(t+.2);
}

function noiseBuffer(){
  const b=audioCtx.createBuffer(1,audioCtx.sampleRate*.3,audioCtx.sampleRate);
  const d=b.getChannelData(0);
  for(let i=0;i<d.length;i++) d[i]=Math.random()*2-1;
  return b;
}

function snare(t,a){
  const n=audioCtx.createBufferSource(), ng=audioCtx.createGain(), hp=audioCtx.createBiquadFilter();
  n.buffer=noiseBuffer(); hp.type="highpass"; hp.frequency.value=900;
  ng.gain.setValueAtTime(Math.max(.001,a*.75),t);
  ng.gain.exponentialRampToValueAtTime(.001,t+.16);
  n.connect(hp).connect(ng).connect(audioCtx.destination);
  n.start(t); n.stop(t+.18);

  const o=audioCtx.createOscillator(), g=audioCtx.createGain();
  o.type="triangle"; o.frequency.value=185;
  g.gain.setValueAtTime(Math.max(.001,a*.35),t);
  g.gain.exponentialRampToValueAtTime(.001,t+.09);
  o.connect(g).connect(audioCtx.destination);
  o.start(t); o.stop(t+.1);
}

function hiHat(t,dur,a){
  const n=audioCtx.createBufferSource(), g=audioCtx.createGain(), hp=audioCtx.createBiquadFilter();
  n.buffer=noiseBuffer(); hp.type="highpass"; hp.frequency.value=6500;
  g.gain.setValueAtTime(Math.max(.001,a),t);
  g.gain.exponentialRampToValueAtTime(.001,t+dur);
  n.connect(hp).connect(g).connect(audioCtx.destination);
  n.start(t); n.stop(t+dur+.01);
}

document.addEventListener("visibilitychange",async()=>{
  if(!document.hidden && running && audioCtx?.state==="suspended"){
    try{await audioCtx.resume()}catch(e){}
  }
});
