let ctx, analyser, mic, stream, samples, running=false;
let master, limiter, style="rock", intensity=.80, volume=1.0;
let onsetTimes=[], lastOnset=0, env=0, prevEnv=0, floor=.004;
let detected=null, confidence=0, playing=false, bpm=100, targetBpm=100;
let nextStep=0, step=0, scheduler=null, lostSince=0, lastDrumAt=-99;
let hitFlashTimer=null;
const $=x=>document.getElementById(x);

$("volume").oninput=e=>{volume=e.target.value/100;$("volumeText").textContent=e.target.value+"%";if(master)master.gain.setTargetAtTime(volume,ctx.currentTime,.03)};
$("intensity").oninput=e=>{intensity=e.target.value/100;$("intensityText").textContent=e.target.value+"%"};
document.querySelectorAll(".style").forEach(b=>b.onclick=()=>{document.querySelectorAll(".style").forEach(x=>x.classList.remove("active"));b.classList.add("active");style=b.dataset.style});

$("listen").onclick=async()=>{
 if(running){stopAll();return}
 try{
  // Let iPhone/Safari suppress some speaker feedback before our own drum guard runs.
  stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:false,autoGainControl:false,channelCount:1}});
  ctx=new (window.AudioContext||window.webkitAudioContext)({latencyHint:"interactive"});
  await ctx.resume();
  master=ctx.createGain(); master.gain.value=volume;
  limiter=ctx.createDynamicsCompressor(); limiter.threshold.value=-8; limiter.knee.value=3; limiter.ratio.value=12; limiter.attack.value=.001; limiter.release.value=.12;
  master.connect(limiter).connect(ctx.destination);
  mic=ctx.createMediaStreamSource(stream); analyser=ctx.createAnalyser(); analyser.fftSize=1024; analyser.smoothingTimeConstant=0;
  mic.connect(analyser); samples=new Float32Array(analyser.fftSize);

  running=true; playing=false; onsetTimes=[]; detected=null; confidence=0; lastOnset=0; floor=.004; env=prevEnv=0; lostSince=0; lastDrumAt=-99;
  $("listen").textContent="STOP"; $("listen").classList.add("stop");
  $("bpm").textContent="--"; $("confidence").textContent="listening";
  $("status").textContent="Listening — play a steady rhythm for a few seconds";
  $("detail").textContent="Drums will stay silent until the guitar tempo is locked.";
  setHit(false);
  requestAnimationFrame(analyse); scheduler=setInterval(schedule,20);
 }catch(e){$("status").textContent="Microphone access is required.";console.error(e)}
};

function stopAll(){
 running=false;playing=false;clearInterval(scheduler);scheduler=null;
 if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;
 if(ctx&&ctx.state!=="closed")ctx.close();
 $("listen").textContent="LISTEN";$("listen").classList.remove("stop");
 $("status").textContent="Ready";$("detail").textContent="Drums stay silent until your tempo is detected.";
 $("confidence").textContent="waiting";$("bpm").textContent="--";setHit(false);
}

function setHit(on){
 const el=$("hit"); if(!el)return;
 el.classList.toggle("on",on); el.textContent=on?"GUITAR HIT ✓":"Guitar hit";
 if(on){clearTimeout(hitFlashTimer);hitFlashTimer=setTimeout(()=>setHit(false),95)}
}

function analyse(){
 if(!running)return;
 analyser.getFloatTimeDomainData(samples);
 let sum=0,peak=0;
 for(const v of samples){let a=Math.abs(v);sum+=v*v;if(a>peak)peak=a}
 let rms=Math.sqrt(sum/samples.length), level=Math.min(1,rms*11);
 $("level").style.width=(level*100)+"%";$("meter").style.setProperty("--rot",(level*300-150)+"deg");

 // Slowly learn the quiet-room floor. Don't let loud drums immediately raise it.
 if(rms<floor*2.0)floor=floor*.995+rms*.005;
 floor=Math.max(.0018,Math.min(.018,floor));
 prevEnv=env; env=env*.38+rms*.62;
 const rise=env-prevEnv, now=performance.now()/1000;
 const gate=Math.max(.0095,floor*2.35);

 // Speaker drums arrive at the mic shortly after playback. Ignore that acoustic window.
 const drumGuard=playing && ctx && (ctx.currentTime-lastDrumAt)>-.025 && (ctx.currentTime-lastDrumAt)<.145;
 const minGap=playing?.22:.18;
 if(!drumGuard && env>gate && peak>.045 && rise>Math.max(.0022,floor*.18) && now-lastOnset>minGap){
   lastOnset=now; onsetTimes.push(now); onsetTimes=onsetTimes.filter(t=>now-t<7).slice(-20);
   setHit(true); estimateTempo();
 }

 // Don't stop the drummer merely because guarded speaker windows hid some guitar hits.
 if(lastOnset && now-lastOnset>3.2){
   if(!lostSince)lostSince=now;
   if(now-lostSince>1.2 && playing){
     playing=false; detected=null; confidence=0; onsetTimes=[];
     $("bpm").textContent="--";$("confidence").textContent="reacquiring";
     $("status").textContent="Listening again…";$("detail").textContent="Play steady quarter-note strums to bring the drummer back in.";
   }
 } else lostSince=0;

 if(playing){bpm+=(targetBpm-bpm)*.018;$("bpm").textContent=Math.round(bpm)}
 requestAnimationFrame(analyse);
}

function estimateTempo(){
 const needed=playing?6:5;
 if(onsetTimes.length<needed){$("confidence").textContent=`${onsetTimes.length}/${needed} guitar hits`;return}
 let ints=[];
 for(let i=1;i<onsetTimes.length;i++){
   const d=onsetTimes[i]-onsetTimes[i-1];
   if(d>=.28&&d<=1.10)ints.push(d);
 }
 if(ints.length<4)return;
 let bpms=ints.map(d=>60/d).map(x=>{while(x<65)x*=2;while(x>165)x/=2;return x});
 const sorted=[...bpms].sort((a,b)=>a-b), med=sorted[Math.floor(sorted.length/2)];
 const tolerance=playing?Math.max(5,med*.075):Math.max(7,med*.10);
 const good=bpms.filter(x=>Math.abs(x-med)<tolerance);
 confidence=good.length/bpms.length;
 const minConfidence=playing?.70:.62;
 if(good.length<4||confidence<minConfidence){$("confidence").textContent="keep playing";return}
 const est=good.reduce((a,b)=>a+b,0)/good.length;

 // After lock, reject sudden large jumps caused by speaker leakage/noise.
 if(playing && Math.abs(est-targetBpm)>Math.max(12,targetBpm*.12)){
   $("confidence").textContent="checking change"; return;
 }
 detected=est; targetBpm=est;
 $("confidence").textContent=Math.round(confidence*100)+"% lock";
 if(!playing){
   bpm=est; playing=true; step=0; nextStep=ctx.currentTime+.25;
   $("status").textContent="Tempo locked — drummer in";
   $("detail").textContent="Keep playing. Drum sounds are ignored briefly so they don't become fake guitar beats.";
 } else $("status").textContent="Following your guitar rhythm";
}

function schedule(){
 if(!running||!playing||!ctx)return;
 const ahead=.10;
 while(nextStep<ctx.currentTime+ahead){
   playStep(step,nextStep);
   nextStep+=(60/Math.max(65,Math.min(165,bpm)))/2;
   step=(step+1)%8;
 }
}
function markDrum(t){lastDrumAt=Math.max(lastDrumAt,t)}
function route(n){n.connect(master)}
function noise(seconds=.35){let b=ctx.createBuffer(1,Math.floor(ctx.sampleRate*seconds),ctx.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;return b}
function kick(t,a){markDrum(t);let o=ctx.createOscillator(),g=ctx.createGain(),click=ctx.createBufferSource(),cg=ctx.createGain(),hp=ctx.createBiquadFilter();o.type="sine";o.frequency.setValueAtTime(175,t);o.frequency.exponentialRampToValueAtTime(48,t+.09);g.gain.setValueAtTime(1.15*a,t);g.gain.exponentialRampToValueAtTime(.001,t+.28);o.connect(g);route(g);o.start(t);o.stop(t+.3);click.buffer=noise(.03);hp.type="highpass";hp.frequency.value=2500;cg.gain.setValueAtTime(.32*a,t);cg.gain.exponentialRampToValueAtTime(.001,t+.025);click.connect(hp).connect(cg);route(cg);click.start(t);click.stop(t+.03)}
function snare(t,a){markDrum(t);let n=ctx.createBufferSource(),f=ctx.createBiquadFilter(),g=ctx.createGain(),o=ctx.createOscillator(),og=ctx.createGain();n.buffer=noise(.25);f.type="bandpass";f.frequency.value=2100;f.Q.value=.7;g.gain.setValueAtTime(.95*a,t);g.gain.exponentialRampToValueAtTime(.001,t+.2);n.connect(f).connect(g);route(g);n.start(t);n.stop(t+.22);o.type="triangle";o.frequency.value=190;og.gain.setValueAtTime(.45*a,t);og.gain.exponentialRampToValueAtTime(.001,t+.11);o.connect(og);route(og);o.start(t);o.stop(t+.12)}
function hat(t,d,a){markDrum(t);let n=ctx.createBufferSource(),hp=ctx.createBiquadFilter(),g=ctx.createGain();n.buffer=noise(.25);hp.type="highpass";hp.frequency.value=7000;g.gain.setValueAtTime(.38*a,t);g.gain.exponentialRampToValueAtTime(.001,t+d);n.connect(hp).connect(g);route(g);n.start(t);n.stop(t+d+.02)}
function playStep(s,t){let k=false,sn=false,h=true,op=false;if(style==="rock"){k=[0,4].includes(s);sn=[2,6].includes(s);op=s===7}if(style==="blues"){k=[0,3,4].includes(s);sn=[2,6].includes(s);h=[0,2,4,6].includes(s)}if(style==="country"){k=[0,4].includes(s);sn=[2,6].includes(s)}if(style==="funk"){k=[0,3,4,7].includes(s);sn=[2,6].includes(s);op=s===5}if(k)kick(t,intensity);if(sn)snare(t,intensity);if(h)hat(t,op?.18:.055,intensity)}
document.addEventListener("visibilitychange",async()=>{if(!document.hidden&&running&&ctx?.state==="suspended")try{await ctx.resume()}catch(e){}});
