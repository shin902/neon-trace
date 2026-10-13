import {ContourTracker, displacement} from './edge.js';
const $=id=>document.getElementById(id), canvas=$('view'),ctx=canvas.getContext('2d'),video=$('input-video');
const analysis=document.createElement('canvas'), ac=analysis.getContext('2d',{willReadFrequently:true});
const demoCanvas=document.createElement('canvas'),dc=demoCanvas.getContext('2d');
const demoMask=document.createElement('canvas'),mc=demoMask.getContext('2d');
demoCanvas.width=demoMask.width=960;demoCanvas.height=demoMask.height=600;
const worker=new Worker('./worker.js',{type:'module'}),tracker=new ContourTracker();
const defaults={threshold:70,minLength:6,stability:65,amplitude:7,speed:1,glow:60};
let settings={...defaults},motion='flow',mode='edges',source='demo',stream=null,objectUrl=null;
let epoch=0,request=0,busy=false,paused=false,compare=false,tracks=[],lastAnalysis=0,lastClock=0,clock=0,lastFps=0,frameCount=0;
let segmenter=null,segmentPromise=null,lastVideoTime=-1,personFailed=false,analysisWidth=384,analysisHeight=240;
function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
function resizeAnalysis(w,h){analysisWidth=384;analysisHeight=Math.max(64,Math.round(384*h/w));if(analysisHeight>384){analysisWidth=Math.round(384*w/h);analysisHeight=384;}analysis.width=analysisWidth;analysis.height=analysisHeight;}
resizeAnalysis(960,600);
function resetTracking(){epoch++;tracker.reset();tracks=[];lastVideoTime=-1;lastAnalysis=0;}
function disposeInput(){
  if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
  video.pause();video.srcObject=null;video.removeAttribute('src');video.load();
  if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}
}
function setSource(name){
  source=name;paused=false;$('pause').textContent='Ⅱ';$('pause').setAttribute('aria-label','一時停止');
  for(const id of ['demo','camera','file'])$(id).classList.toggle('active',name===id);
  $('source-label').textContent={demo:'DEMO SIGNAL',camera:'CAMERA LIVE',file:'VIDEO INPUT',idle:'NO SIGNAL'}[name];
  $('stage-caption').textContent={demo:'DEMO / 動く図形から実際にエッジを抽出',camera:'LIVE / カメラ映像',file:'LOCAL / 動画ファイル',idle:'入力を選択してください'}[name];
  $('sound').hidden=name!=='file';video.muted=true;$('sound').textContent='音声 OFF';$('sound').setAttribute('aria-pressed','false');
  $('mirror').checked=name==='camera';personFailed=false;resetTracking();
}
function startDemo(){request++;disposeInput();resizeAnalysis(960,600);setSource('demo');status('デモを再生中。カメラや動画を選ぶと、その映像を解析します。');}
const errors={NotAllowedError:'許可されなかったため開始できませんでした。ブラウザの権限を確認して、もう一度入力を選んでください。',NotFoundError:'カメラが見つかりません。動画ファイルでも試せます。',NotReadableError:'カメラ映像を読み取れません。ほかのアプリで使用していないか確認してください。',AbortError:'入力の開始が中断されました。もう一度お試しください。'};
async function startCapture(){
  const kind='camera';
  if(!navigator.mediaDevices?.getUserMedia){status('この環境ではこの入力を使えません。対応ブラウザでHTTPSまたはlocalhostから開いてください。動画ファイルとデモは使用できます。',true);return;}
  const token=++request;status('カメラの許可を待っています…');
  let nextStream;
  try{
    nextStream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},facingMode:'user'},audio:false});
    if(token!==request){nextStream.getTracks().forEach(t=>t.stop());return;}
    disposeInput();stream=nextStream;video.srcObject=stream;await video.play();
    if(token!==request){nextStream.getTracks().forEach(t=>t.stop());return;}
    resizeAnalysis(video.videoWidth||1280,video.videoHeight||720);setSource(kind);
    const captured=stream;captured.getVideoTracks()[0].addEventListener('ended',()=>{if(stream===captured){request++;disposeInput();setSource('idle');status('カメラの入力が終了しました。入力を選択して再開できます。');}});
    status('カメラを解析中。映像はサーバーに送信しません。');
    if(mode==='person')preparePerson();
  }catch(error){if(token===request){if(nextStream){nextStream.getTracks().forEach(t=>t.stop());if(stream===nextStream){disposeInput();setSource('idle');}}status(errors[error.name]||`映像を開始できませんでした：${error.message}`,true);}}
}
async function startFile(file){
  if(!file)return;if(file.type&&!file.type.startsWith('video/')){status('動画ファイルを選択してください。',true);return;}
  const token=++request;disposeInput();setSource('idle');objectUrl=URL.createObjectURL(file);video.src=objectUrl;video.loop=true;
  status('動画を読み込んでいます…');
  try{await video.play();if(token!==request)return;resizeAnalysis(video.videoWidth,video.videoHeight);setSource('file');status(`${file.name} を解析中。音声は「音声 OFF」で切り替えられます。`);if(mode==='person')preparePerson();}
  catch(error){if(token===request){disposeInput();setSource('idle');status('この動画を再生できません。MP4（H.264）やWebMをお試しください。',true);}}
}

async function loadSegmenter(){
  if(segmenter)return segmenter;
  if(!segmentPromise)segmentPromise=(async()=>{
    const {FilesetResolver,ImageSegmenter}=await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/vision_bundle.mjs');
    const vision=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm');
    segmenter=await ImageSegmenter.createFromOptions(vision,{baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'},runningMode:'VIDEO',outputCategoryMask:false,outputConfidenceMasks:true});
    return segmenter;
  })().catch(e=>{segmentPromise=null;throw e;});
  return segmentPromise;
}
async function preparePerson(){
  if(source==='demo'||source==='idle'||mode!=='person')return;
  const current=epoch;status('人物抽出モデルを読み込んでいます…（初回はネット接続が必要です）');
  try{await loadSegmenter();if(epoch===current&&mode==='person')status('人物の外周を解析中。モデルは端末内で動作します。');}
  catch(error){if(epoch===current&&mode==='person'){personFailed=true;setMode('edges');status('人物モデルを取得できなかったため、全体のエッジに切り替えました。ネット接続を確認して再度お試しください。',true);}}
}
function setMode(next){
  mode=next;resetTracking();for(const id of ['edges','person']){$(id).classList.toggle('active',id===mode);$(id).setAttribute('aria-pressed',String(id===mode));}
  $('threshold').disabled=mode==='person';$('mode-note').textContent=mode==='person'?'人物領域 → 外周の抽出 → 線の選別':'ぼかし → Sobel → 細線化 → 線の選別';
  personFailed=false;if(next==='person')preparePerson();
}

function drawDemo(t){
  const w=960,h=600;dc.fillStyle='#101814';dc.fillRect(0,0,w,h);
  const gradient=dc.createRadialGradient(470,260,0,470,260,540);gradient.addColorStop(0,'#23302a');gradient.addColorStop(1,'#101814');dc.fillStyle=gradient;dc.fillRect(0,0,w,h);
  dc.strokeStyle='#2a352e';dc.lineWidth=1;for(let y=100;y<h;y+=80){dc.beginPath();dc.moveTo(0,y);dc.lineTo(w,y);dc.stroke();}
  for(let x=-300;x<1400;x+=140){dc.beginPath();dc.moveTo(480+(x-480)*.15,100);dc.lineTo(x,600);dc.stroke();}
  dc.fillStyle='#56675a';dc.font='11px monospace';dc.fillText('GENERATED TEST SCENE / NO CAMERA',38,65);
  // A moving stylized human silhouette, also used as the known foreground mask.
  mc.fillStyle='#000';mc.fillRect(0,0,w,h);mc.fillStyle='#fff';
  function figure(c,fill){
    c.save();c.translate(470+Math.sin(t*.65)*90,315+Math.sin(t*1.2)*8);c.rotate(Math.sin(t*.75)*.06);c.fillStyle=fill;
    c.beginPath();c.ellipse(0,-140,43,52,Math.sin(t)*.07,0,Math.PI*2);c.fill();
    c.beginPath();c.moveTo(-29,-93);c.lineTo(30,-93);c.quadraticCurveTo(70,-92,83,-40);c.lineTo(112,40+Math.sin(t)*22);c.lineTo(90,53+Math.sin(t)*22);c.lineTo(56,-11);c.lineTo(48,70);c.lineTo(67,208);c.lineTo(28,208);c.lineTo(0,88);c.lineTo(-24,208);c.lineTo(-66,208);c.lineTo(-47,71);c.lineTo(-56,-12);c.lineTo(-112,46+Math.cos(t)*20);c.lineTo(-131,28+Math.cos(t)*20);c.lineTo(-84,-47);c.quadraticCurveTo(-71,-89,-29,-93);c.closePath();c.fill();
    c.restore();
  }
  figure(dc,'#b0bcb2');figure(mc,'#fff');
  dc.save();dc.translate(720,220);dc.rotate(t*.18);dc.strokeStyle='#839781';dc.lineWidth=3;dc.strokeRect(-52,-52,104,104);dc.restore();
  dc.beginPath();dc.arc(230,340+Math.sin(t)*25,63,0,Math.PI*2);dc.strokeStyle='#849784';dc.lineWidth=3;dc.stroke();
  // Deliberately tiny features to exercise short-line filtering.
  dc.strokeStyle='#66776b';dc.lineWidth=2;for(let i=0;i<12;i++){dc.beginPath();dc.moveTo(55+i*20,485);dc.lineTo(59+i*20,491);dc.stroke();}
}

worker.onmessage=({data})=>{
  busy=false;if(data.epoch!==epoch)return;
  if(data.error){status(`輪郭の解析に失敗しました：${data.error}`,true);return;}
  tracks=tracker.update(data.contours,settings.stability);$('count').textContent=`${tracks.length} CONTOURS`;
};
worker.onerror=()=>{busy=false;status('解析ワーカーを開始できませんでした。HTMLを直接開かず、Webサーバーから開いてください。',true);};
function analyze(now){
  if(busy||paused||source==='idle'||now-lastAnalysis<66)return;
  if(source!=='demo'&&(video.readyState<2||video.videoWidth===0))return;
  if(mode==='person'&&source!=='demo'&&!segmenter)return;
  lastAnalysis=now;
  try{
    if(mode==='person'&&source!=='demo'){
      if(video.currentTime===lastVideoTime)return;lastVideoTime=video.currentTime;
      // Single-channel Selfie Segmenter confidence is the foreground probability.
      let pixels;
      segmenter.segmentForVideo(video,now,result=>{
        const mask=result.confidenceMasks[0], data=mask.getAsFloat32Array();
        const temp=new ImageData(mask.width,mask.height);
        // Threshold foreground confidence; keep clothes and facial detail out of the edge input.
        for(let i=0;i<data.length;i++){const v=data[i]>.55?255:0;temp.data[i*4]=temp.data[i*4+1]=temp.data[i*4+2]=v;temp.data[i*4+3]=255;}
        const c=document.createElement('canvas');c.width=mask.width;c.height=mask.height;c.getContext('2d').putImageData(temp,0,0);ac.drawImage(c,0,0,analysis.width,analysis.height);pixels=ac.getImageData(0,0,analysis.width,analysis.height);
      });
      if(!pixels)return;busy=true;worker.postMessage({buffer:pixels.data.buffer,width:analysis.width,height:analysis.height,epoch,options:{...settings,mask:true}},[pixels.data.buffer]);
    }else{
      ac.drawImage(source==='demo'?(mode==='person'?demoMask:demoCanvas):video,0,0,analysis.width,analysis.height);
      const pixels=ac.getImageData(0,0,analysis.width,analysis.height);busy=true;
      worker.postMessage({buffer:pixels.data.buffer,width:analysis.width,height:analysis.height,epoch,options:{...settings,mask:mode==='person'}},[pixels.data.buffer]);
    }
  }catch(error){busy=false;if(mode==='person'&&!personFailed){setMode('edges');personFailed=true;status('人物抽出を実行できなかったため、全体のエッジに切り替えました。',true);}else{setSource('idle');status(`映像を解析できませんでした：${error.message}`,true);}}
}

function render(now){
  requestAnimationFrame(render);
  if(!lastClock)lastClock=now;if(!paused)clock+=Math.min(now-lastClock,100)/1000;lastClock=now;
  const bounds=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2),cw=Math.round(bounds.width*dpr),ch=Math.round(bounds.height*dpr);
  if(canvas.width!==cw||canvas.height!==ch){canvas.width=cw;canvas.height=ch;}
  ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#070a08';ctx.fillRect(0,0,cw,ch);
  const iw=source==='demo'?960:video.videoWidth||960,ih=source==='demo'?600:video.videoHeight||600;
  const scale=Math.min(cw/iw,ch/ih),rw=iw*scale,rh=ih*scale,ox=(cw-rw)/2,oy=(ch-rh)/2;
  if(source==='demo')drawDemo(clock);
  ctx.save();ctx.beginPath();ctx.rect(ox,oy,rw,rh);ctx.clip();
  if($('mirror').checked){ctx.translate(cw,0);ctx.scale(-1,1);}
  if(source!=='idle'&&($('overlay').checked||compare)){
    ctx.globalAlpha=compare?1:.7;
    if(source==='demo')ctx.drawImage(demoCanvas,ox,oy,rw,rh);else if(video.readyState>=2)ctx.drawImage(video,ox,oy,rw,rh);
    ctx.globalAlpha=1;
  }
  if(!compare&&source!=='idle'){
    const sx=rw/analysisWidth,sy=rh/analysisHeight,color=$('color').value;
    for(const tr of tracks){
      const p=tr.points;let distance=0;
      ctx.beginPath();
      for(let i=0;i<p.length;i++){
        if(i)distance+=Math.hypot(p[i][0]-p[i-1][0],p[i][1]-p[i-1][1]);
        const prev=p[i===0?(tr.closed?p.length-2:0):i-1],next=p[i===p.length-1?(tr.closed?1:i):i+1];
        const dx=(next[0]-prev[0])*sx,dy=(next[1]-prev[1])*sy,len=Math.hypot(dx,dy)||1;
        // A periodic coordinate keeps the noise seam continuous on a closed contour.
        let wave=displacement(distance,clock,motion,settings.speed,tr.id*5.31);
        if(tr.closed){const blend=distance/tr.length;wave=wave*(1-blend)+displacement(distance-tr.length,clock,motion,settings.speed,tr.id*5.31)*blend;}
        const a=wave*settings.amplitude*dpr;
        const x=ox+p[i][0]*sx-dy/len*a,y=oy+p[i][1]*sy+dx/len*a;
        if(!i)ctx.moveTo(x,y);else ctx.lineTo(x,y);
      }
      if(tr.closed)ctx.closePath();
      ctx.lineJoin='round';ctx.lineCap='round';ctx.strokeStyle=color;
      // Broad halo, then crisp colored core. No displacement is fed back into tracking.
      ctx.globalAlpha=tr.alpha*.3*settings.glow/100;ctx.shadowColor=color;ctx.shadowBlur=settings.glow*.22*dpr;ctx.lineWidth=5*dpr;ctx.stroke();
      ctx.globalAlpha=tr.alpha;ctx.shadowBlur=settings.glow*.055*dpr;ctx.lineWidth=1.5*dpr;ctx.stroke();ctx.shadowBlur=0;
    }
  }
  ctx.restore();ctx.globalAlpha=1;
  if(source==='idle'){ctx.fillStyle='#81927a';ctx.font=`${14*dpr}px sans-serif`;ctx.textAlign='center';ctx.fillText('カメラ・動画から入力を選択',cw/2,ch/2);ctx.textAlign='left';}
  analyze(now);frameCount++;if(now-lastFps>1000){$('fps').textContent=`${Math.round(frameCount*1000/(now-lastFps))} FPS${paused?' / PAUSED':''}`;frameCount=0;lastFps=now;}
}

for(const key of Object.keys(defaults)){
  $(key).addEventListener('input',()=>{settings[key]=Number($(key).value);updateLabels();if(key==='minLength'||key==='threshold')resetTracking();});
}
function updateLabels(){for(const key of Object.keys(defaults))$(key+'-value').textContent=key==='speed'?settings[key].toFixed(1)+'×':['minLength','stability','glow'].includes(key)?settings[key]+'%':settings[key];}
function setMotion(next){motion=next;document.querySelectorAll('[data-motion]').forEach(b=>{b.classList.toggle('active',b.dataset.motion===motion);b.setAttribute('aria-pressed',String(b.dataset.motion===motion));});document.querySelector('.recipe strong').textContent={flow:'FLOWING NOISE',noise:'EVOLVING NOISE',vibrate:'SOFT VIBRATION'}[motion];document.querySelector('.recipe p').lastChild.textContent={flow:'輪郭に沿うノイズ ＋ 微かな振動',noise:'時間とともに滑らかに変化するノイズ',vibrate:'輪郭の法線方向に小刻みな振動'}[motion];}
document.querySelectorAll('[data-motion]').forEach(b=>b.onclick=()=>setMotion(b.dataset.motion));
$('demo').onclick=startDemo;$('camera').onclick=startCapture;
$('file').onclick=()=>$('upload').click();$('upload').onchange=()=>{startFile($('upload').files[0]);$('upload').value='';};
$('edges').onclick=()=>setMode('edges');$('person').onclick=()=>setMode('person');
$('stop').onclick=()=>{request++;disposeInput();setSource('idle');status('入力を停止しました。カメラも終了しています。');};
$('pause').onclick=async()=>{if(source==='idle')return;paused=!paused;$('pause').textContent=paused?'▶':'Ⅱ';$('pause').setAttribute('aria-label',paused?'再生':'一時停止');if(source==='file'){if(paused)video.pause();else try{await video.play();}catch{paused=true;status('再生を再開できませんでした。動画をもう一度選んでください。',true);}}status(paused?'エフェクトを一時停止中。ライブ入力は継続しています。入力を停止するとカメラを終了します。':'エフェクトを再生中。');};
$('sound').onclick=()=>{video.muted=!video.muted;$('sound').textContent=video.muted?'音声 OFF':'音声 ON';$('sound').setAttribute('aria-pressed',String(!video.muted));};
$('compare').onclick=()=>{compare=!compare;$('compare').setAttribute('aria-pressed',String(compare));$('compare').textContent=compare?'エフェクトに戻る':'元映像を比較';};
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('stage').requestFullscreen();}catch{status('このブラウザでは全画面表示を利用できません。',true);}};
$('color').oninput=()=>$('hex').textContent=$('color').value.toUpperCase();
$('reset').onclick=()=>{settings={...defaults};for(const key of Object.keys(defaults))$(key).value=settings[key];updateLabels();setMotion('flow');setMode('edges');$('overlay').checked=true;$('color').value='#76ff57';$('hex').textContent='#76FF57';compare=false;$('compare').setAttribute('aria-pressed','false');$('compare').textContent='元映像を比較';};
let dragDepth=0;
$('stage').addEventListener('dragenter',e=>{e.preventDefault();dragDepth++;$('stage').classList.add('dragging');});
$('stage').addEventListener('dragover',e=>e.preventDefault());
$('stage').addEventListener('dragleave',()=>{if(--dragDepth<=0)$('stage').classList.remove('dragging');});
$('stage').addEventListener('drop',e=>{e.preventDefault();dragDepth=0;$('stage').classList.remove('dragging');startFile(e.dataTransfer.files[0]);});
window.addEventListener('pagehide',()=>{request++;disposeInput();worker.terminate();segmenter?.close();});
updateLabels();requestAnimationFrame(render);
