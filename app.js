let audioCtx, analyser, source, data, running=false;
let bpm=100, lastOnset=0, intervals=[], nextBeat=0, timer=null, style="rock", intensity=.75;
const $=id=>document.getElementById(id);

$("intensity").oninput=e=>{intensity=e.target.value/100;$("intensityText").textContent=e.target.value+"%"};

document.querySelectorAll(".style").forEach(b=>b.onclick=()=>{
 document.querySelectorAll(".style").forEach(x=>x.classList.remove("active"));
 b.classList.add("active"); style=b.dataset.style;
});

$("listen").onclick=async()=>{
 if(running){stop();return}
 try{
  const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
  audioCtx=new (window.AudioContext||window.webkitAudioContext)();
  await audioCtx.resume();
  source=audioCtx.createMediaStreamSource(stream);
  analyser=audioCtx.createAnalyser(); analyser.fftSize=2048; analyser.smoothingTimeConstant=.15;
  source.connect(analyser); data=new Float32Array(analyser.fftSize);
  running=true; $("listen").textContent="STOP"; $("listen").classList.add("stop");
  $("status").textContent="Listening — play your guitar";
  lastOnset=0; intervals=[]; nextBeat=performance.now()/1000;
  requestAnimationFrame(analyse); timer=setInterval(schedule,20);
 }catch(e){$("status").textContent="Microphone access is required. Please allow it in Safari.";console.error(e)}
};

function stop(){
 running=false; clearInterval(timer);
 if(source) source.mediaStream.getTracks().forEach(t=>t.stop());
 if(audioCtx) audioCtx.close();
 $("listen").textContent="LISTEN"; $("listen").classList.remove("stop");
 $("status").textContent="Ready";
}

function analyse(){
 if(!running)return;
 analyser.getFloatTimeDomainData(data);
 let sum=0,peak=0;
 for(let i=0;i<data.length;i++){let x=Math.abs(data[i]);sum+=x*x;if(x>peak)peak=x}
 let rms=Math.sqrt(sum/data.length);
 let level=Math.min(1,rms*7);
 $("level").style.width=(level*100)+"%";
 $("meter").style.setProperty("--rot",(level*300-150)+"deg");

 let now=performance.now()/1000;
 if(rms>.035 && peak>.13 && now-lastOnset>.16){
   let dt=now-lastOnset;
   if(dt<2){
     intervals.push(dt); if(intervals.length>10) intervals.shift();
     let sorted=[...intervals].sort((a,b)=>a-b), med=sorted[Math.floor(sorted.length/2)];
     let est=60/med;
     if(est>=55&&est<=180){bpm=bpm*.75+est*.25;$("bpm").textContent=Math.round(bpm)}
   }
   lastOnset=now;
 }
 requestAnimationFrame(analyse);
}

function schedule(){
 if(!running)return;
 let now=performance.now()/1000, beat=60/Math.max(55,Math.min(180,bpm));
 if(now>=nextBeat){
   playBeat(Math.round(nextBeat/beat)%4);
   nextBeat=now+beat;
 }
}

function playBeat(n){
 let kick=false,snare=false;
 if(style==="rock"||style==="blues"||style==="country"){kick=n===0||n===2;snare=n===1||n===3}
 if(style==="funk"){kick=n===0||n===1||n===3;snare=n===1||n===3}
 if(kick)drum(75,.12,.55*intensity);
 if(snare)drum(180,.10,.35*intensity);
 drum(5200,.025,.055*intensity);
}

function drum(freq,dur,amp){
 if(!audioCtx)return;
 let o=audioCtx.createOscillator(),g=audioCtx.createGain();
 o.type="sine";o.frequency.value=freq;
 let t=audioCtx.currentTime;
 g.gain.setValueAtTime(amp,t);g.gain.exponentialRampToValueAtTime(.001,t+dur);
 o.connect(g).connect(audioCtx.destination);o.start(t);o.stop(t+dur+.01);
}
