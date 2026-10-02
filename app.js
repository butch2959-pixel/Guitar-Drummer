let ctx, analyser, mic, stream, samples, running=false;
let master, limiter, style="rock", intensity=.80, volume=1.0;
let onsetTimes=[], lastOnset=0, env=0, prevEnv=0, floor=.006;
let detected=null, confidence=0, playing=false, bpm=100, targetBpm=100;
let nextStep=0, step=0, scheduler=null, lostSince=0;
const $=x=>document.getElementById(x);

$("volume").oninput=e=>{volume=e.target.value/100;$("volumeText").textContent=e.target.value+"%";if(master)master.gain.setTargetAtTime(volume,ctx.currentTime,.03)};
$("intensity").oninput=e=>{intensity=e.target.value/100;$("intensityText").textContent=e.target.value+"%"};
document.querySelectorAll(".style").forEach(b=>b.onclick=()=>{document.querySelectorAll(".style").forEach(x=>x.classList.remove("active"));b.classList.add("active");style=b.dataset.style});

$("listen").onclick=async()=>{
 if(running){stopAll();return}
 try{
  stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1}});
  ctx=new (window.AudioContext||window.webkitAudioContext)({latencyHint:"interactive"});
  await ctx.resume();

  master=ctx.createGain(); master.gain.value=volume;
  limiter=ctx.createDynamicsCompressor();
  limiter.threshold.value=-8; limiter.knee.value=3; limiter.ratio.value=12; limiter.attack.value=.001; limiter.release.value=.12;
  master.connect(limiter).connect(ctx.destination);

  mic=ctx.createMediaStreamSource(stream); analyser=ctx.createAnalyser();
  analyser.fftSize=1024; analyser.smoothingTimeConstant=0;
  mic.connect(analyser); samples=new Float32Array(analyser.fftSize);

  running=true; playing=false; onsetTimes=[]; detected=null; confidence=0; lastOnset=0; floor=.006; env=prevEnv=0; lostSince=0;
  $("listen").textContent="STOP"; $("listen").classList.add("stop");
  $("bpm").textContent="--"; $("confidence").textContent="listening";
  $("status").textContent="Listening…"; $("detail").textContent="Play steady quarter-note strums for a few seconds.";
  requestAnimationFrame(analyse);
  scheduler=setInterval(schedule,20);
 }catch(e){$("status").textContent="Microphone access is required.";console.error(e)}
};

function stopAll(){
 running=false;playing=false;clearInterval(scheduler);scheduler=null;
 if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;
 if(ctx&&ctx.state!=="closed")ctx.close();
 $("listen").textContent="LISTEN";$("listen").classList.remove("stop");
 $("status").textContent="Ready";$("detail").textContent="Drums stay silent until your tempo is detected.";
 $("confidence").textContent="waiting";
}

function analyse(){
 if(!running)return;
 analyser.getFloatTimeDomainData(samples);
 let sum=0,peak=0;
 for(const v of samples){let a=Math.abs(v);sum+=v*v;if(a>peak)peak=a}
 let rms=Math.sqrt(sum/samples.length), level=Math.min(1,rms*9);
 $("level").style.width=(level*100)+"%";$("meter").style.setProperty("--rot",(level*300-150)+"deg");

 if(rms<floor*1.8)floor=floor*.992+rms*.008;
 floor=Math.max(.0025,Math.min(.025,floor));
 prevEnv=env;env=env*.45+rms*.55;
 let rise=env-prevEnv, now=performance.now()/1000;
 let gate=Math.max(.014,floor*2.7);

 if(env>gate && peak>.07 && rise>Math.max(.003,floor*.22) && now-lastOnset>.18){
   lastOnset=now; onsetTimes.push(now);
   onsetTimes=onsetTimes.filter(t=>now-t<7).slice(-18);
   estimateTempo();
 }
 if(lastOnset && now-lastOnset>2.2){
   if(!lostSince)lostSince=now;
   if(now-lostSince>.8 && playing){
     playing=false; detected=null; confidence=0; onsetTimes=[];
     $("bpm").textContent="--";$("confidence").textContent="reacquiring";
     $("status").textContent="Listening again…";$("detail").textContent="Play a steady rhythm to bring the drummer back in.";
   }
 } else lostSince=0;

 if(playing){bpm += (targetBpm-bpm)*.025;$("bpm").textContent=Math.round(bpm)}
 requestAnimationFrame(analyse);
}

function estimateTempo(){
 if(onsetTimes.length<5){$("confidence").textContent=`${onsetTimes.length}/5 attacks`;return}
 let ints=[];
 for(let i=1;i<onsetTimes.length;i++){
   let d=onsetTimes[i]-onsetTimes[i-1];
   if(d>=.28&&d<=1.05)ints.push(d); // ~57–214 raw BPM
 }
 if(ints.length<4)return;
 let bpms=ints.map(d=>60/d).map(x=>{while(x<65)x*=2;while(x>165)x/=2;return x});
 let med=[...bpms].sort((a,b)=>a-b)[Math.floor(bpms.length/2)];
 let good=bpms.filter(x=>Math.abs(x-med)<Math.max(7,med*.10));
 confidence=good.length/bpms.length;
 if(good.length<4||confidence<.62){$("confidence").textContent="keep playing";return}
 let weights=good.map((_,i)=>i+1), ws=weights.reduce((a,b)=>a+b,0);
 let est=good.reduce((s,x,i)=>s+x*weights[i],0)/ws;
 detected=est; targetBpm=est;
 $("confidence").textContent=Math.round(confidence*100)+"% lock";
 if(!playing){
   bpm=est; playing=true; step=0; nextStep=ctx.currentTime+.18;
   $("status").textContent="Tempo locked — drummer in";
   $("detail").textContent="Keep playing; the groove will follow gradual tempo changes.";
 } else {
   $("status").textContent="Following your rhythm";
 }
}

function schedule(){
 if(!running||!playing||!ctx)return;
 const ahead=.12;
 while(nextStep<ctx.currentTime+ahead){
   playStep(step,nextStep);
   nextStep+=(60/Math.max(65,Math.min(165,bpm)))/2;
   step=(step+1)%8;
 }
}

function route(n){n.connect(master)}
function noise(seconds=.35){
 let b=ctx.createBuffer(1,Math.floor(ctx.sampleRate*seconds),ctx.sampleRate),d=b.getChannelData(0);
 for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;return b
}
function kick(t,a){
 let o=ctx.createOscillator(),g=ctx.createGain(),click=ctx.createBufferSource(),cg=ctx.createGain(),hp=ctx.createBiquadFilter();
 o.type="sine";o.frequency.setValueAtTime(175,t);o.frequency.exponentialRampToValueAtTime(48,t+.09);
 g.gain.setValueAtTime(1.15*a,t);g.gain.exponentialRampToValueAtTime(.001,t+.28);o.connect(g);route(g);o.start(t);o.stop(t+.3);
 click.buffer=noise(.03);hp.type="highpass";hp.frequency.value=2500;cg.gain.setValueAtTime(.32*a,t);cg.gain.exponentialRampToValueAtTime(.001,t+.025);
 click.connect(hp).connect(cg);route(cg);click.start(t);click.stop(t+.03);
}
function snare(t,a){
 let n=ctx.createBufferSource(),f=ctx.createBiquadFilter(),g=ctx.createGain(),o=ctx.createOscillator(),og=ctx.createGain();
 n.buffer=noise(.25);f.type="bandpass";f.frequency.value=2100;f.Q.value=.7;g.gain.setValueAtTime(.95*a,t);g.gain.exponentialRampToValueAtTime(.001,t+.2);
 n.connect(f).connect(g);route(g);n.start(t);n.stop(t+.22);
 o.type="triangle";o.frequency.value=190;og.gain.setValueAtTime(.45*a,t);og.gain.exponentialRampToValueAtTime(.001,t+.11);o.connect(og);route(og);o.start(t);o.stop(t+.12);
}
function hat(t,d,a){
 let n=ctx.createBufferSource(),hp=ctx.createBiquadFilter(),g=ctx.createGain();n.buffer=noise(.25);hp.type="highpass";hp.frequency.value=7000;
 g.gain.setValueAtTime(.38*a,t);g.gain.exponentialRampToValueAtTime(.001,t+d);n.connect(hp).connect(g);route(g);n.start(t);n.stop(t+d+.02);
}
function playStep(s,t){
 let k=false,sn=false,h=true,op=false;
 if(style==="rock"){k=[0,4].includes(s);sn=[2,6].includes(s);op=s===7}
 if(style==="blues"){k=[0,3,4].includes(s);sn=[2,6].includes(s);h=[0,2,4,6].includes(s)}
 if(style==="country"){k=[0,4].includes(s);sn=[2,6].includes(s)}
 if(style==="funk"){k=[0,3,4,7].includes(s);sn=[2,6].includes(s);op=s===5}
 if(k)kick(t,intensity);if(sn)snare(t,intensity);if(h)hat(t,op?.18:.055,intensity);
}
document.addEventListener("visibilitychange",async()=>{if(!document.hidden&&running&&ctx?.state==="suspended")try{await ctx.resume()}catch(e){}});
