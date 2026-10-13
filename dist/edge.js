// A small, dependency-free Canny-style pipeline. All lengths are in analysis pixels.
export function extractContours(rgba, w, h, options = {}) {
  const {threshold = 70, minLength = 6, mask = false} = options;
  const n = w * h, gray = new Float32Array(n), blur = new Float32Array(n);
  for (let i = 0; i < n; i++) gray[i] = rgba[i*4]*.299 + rgba[i*4+1]*.587 + rgba[i*4+2]*.114;
  // Separable Gaussian [1, 2, 1] / 4. Preserve boundaries; don't wrap rows.
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const i=y*w+x; blur[i]=(gray[y*w+Math.max(0,x-1)]+2*gray[i]+gray[y*w+Math.min(w-1,x+1)])/4;
  }
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const i=y*w+x; gray[i]=(blur[Math.max(0,y-1)*w+x]+2*blur[i]+blur[Math.min(h-1,y+1)*w+x])/4;
  }
  const mag = new Float32Array(n), direction = new Uint8Array(n);
  for(let y=1;y<h-1;y++) for(let x=1;x<w-1;x++) {
    const i=y*w+x;
    const gx=-gray[i-w-1]+gray[i-w+1]-2*gray[i-1]+2*gray[i+1]-gray[i+w-1]+gray[i+w+1];
    const gy=-gray[i-w-1]-2*gray[i-w]-gray[i-w+1]+gray[i+w-1]+2*gray[i+w]+gray[i+w+1];
    mag[i]=Math.hypot(gx,gy);
    let a=Math.atan2(gy,gx)*180/Math.PI; if(a<0) a+=180;
    direction[i]=a<22.5||a>=157.5?0:a<67.5?1:a<112.5?2:3;
  }
  const edges = new Uint8Array(n), stack=[], high=mask?80:threshold, low=high*.45;
  const offsets=[1,w+1,w,w-1];
  for(let y=1;y<h-1;y++) for(let x=1;x<w-1;x++) {
    const i=y*w+x, d=offsets[direction[i]], m=mag[i];
    // One strict comparison breaks flat two-pixel ridges.
    if(m>=low && m>=mag[i-d] && m>mag[i+d]) {
      edges[i]=m>=high?2:1; if(edges[i]===2) stack.push(i);
    }
  }
  while(stack.length) {
    const i=stack.pop(), x=i%w,y=(i/w)|0;
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) {
      if(x+dx<1||x+dx>=w-1||y+dy<1||y+dy>=h-1)continue;
      const j=i+dy*w+dx;if(edges[j]===1){edges[j]=2;stack.push(j);}
    }
  }
  const neighbors = i => {
    const out=[],x=i%w,y=(i/w)|0;
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) {
      if((!dx&&!dy)||x+dx<1||x+dx>=w-1||y+dy<1||y+dy>=h-1)continue;
      const j=i+dy*w+dx;if(edges[j]!==2)continue;
      // A diagonal is redundant when an orthogonal connection already exists.
      if(dx&&dy&&(edges[i+dx]===2||edges[i+dy*w]===2))continue;
      out.push(j);
    }
    return out;
  };
  const used=new Set(), result=[], minimum=Math.hypot(w,h)*minLength/100;
  const key=(a,b)=>Math.min(a,b)*n+Math.max(a,b);
  function trace(start,next){
    const points=[[start%w,Math.floor(start/w)]];let prev=start,cur=next,length=0;
    while(true){
      const k=key(prev,cur);if(used.has(k))break;used.add(k);
      length+=Math.hypot(cur%w-prev%w,Math.floor(cur/w)-Math.floor(prev/w));
      points.push([cur%w,Math.floor(cur/w)]);
      if(cur===start)break;
      const nb=neighbors(cur);if(nb.length!==2)break;
      const candidate=nb[0]===prev?nb[1]:nb[0];prev=cur;cur=candidate;
    }
    if(length>=minimum&&points.length>=4) result.push({points,length,closed:cur===start});
  }
  // Start at ends and junctions, then trace remaining loops.
  for(let i=0;i<n;i++)if(edges[i]===2){const nb=neighbors(i);if(nb.length!==2)for(const j of nb)if(!used.has(key(i,j)))trace(i,j);}
  for(let i=0;i<n;i++)if(edges[i]===2)for(const j of neighbors(i))if(!used.has(key(i,j)))trace(i,j);
  return result.sort((a,b)=>b.length-a.length).slice(0,160);
}

export function resample(points, count = 80) {
  const distances=[0];for(let i=1;i<points.length;i++)distances.push(distances[i-1]+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));
  const length=distances.at(-1);if(!length)return Array.from({length:count},()=>[...points[0]]);
  const out=[];let j=1;
  for(let i=0;i<count;i++){
    const d=length*i/(count-1);while(j<distances.length-1&&distances[j]<d)j++;
    const f=(d-distances[j-1])/(distances[j]-distances[j-1]||1);
    out.push([points[j-1][0]*(1-f)+points[j][0]*f,points[j-1][1]*(1-f)+points[j][1]*f]);
  }return out;
}

// Spatially correlated noise; it changes continuously, never randomizes per frame.
function hash(i){const v=Math.sin(i*127.1+311.7)*43758.5453;return (v-Math.floor(v))*2-1;}
export function noise(x){const i=Math.floor(x),f=x-i,t=f*f*(3-2*f);return hash(i)*(1-t)+hash(i+1)*t;}
export function displacement(s,time,motion,speed,seed){
  const t=time*speed;
  if(motion==='noise')return .75*noise(s*.095+noise(t*.7+seed)*2+seed)+.25*noise(s*.25-t*.45+seed);
  if(motion==='vibrate')return Math.sin(t*24+seed)*(.55+.3*noise(s*.1+seed))+.15*noise(s*.3-t*3);
  return .7*noise(s*.11-t*2.2+seed)+.22*noise(s*.29-t*4.2+seed)+.08*Math.sin(t*17+s*.23);
}

export class ContourTracker {
  constructor(){this.tracks=[];this.nextId=1;}
  reset(){this.tracks=[];}
  update(contours, stability=65) {
    const seen=new Set();
    for(const c of contours){
      const points=resample(c.points), cx=points.reduce((s,p)=>s+p[0],0)/points.length,cy=points.reduce((s,p)=>s+p[1],0)/points.length;
      let best=null,score=Infinity;
      for(const tr of this.tracks){
        if(seen.has(tr.id)||tr.closed!==c.closed)continue;
        const ratio=c.length/tr.length, d=Math.hypot(cx-tr.cx,cy-tr.cy);
        if(ratio<.55||ratio>1.8||d>22)continue;
        const v=d+Math.abs(Math.log(ratio))*15;if(v<score){best=tr;score=v;}
      }
      if(best){
        // Align loop phase and open-line direction before smoothing.
        let aligned=points,bestError=Infinity;
        for(const reverse of [false,true])for(let shift=0;shift<(c.closed?points.length-1:1);shift+=c.closed?4:1){
          const candidate=points.map((_,i)=>{
            if(!c.closed)return points[reverse?points.length-1-i:i];
            const m=points.length-1,k=((reverse?-i:i)+shift+m)%m;return points[k];
          });
          let error=0;for(let i=0;i<points.length;i+=8)error+=Math.hypot(candidate[i][0]-best.points[i][0],candidate[i][1]-best.points[i][1]);
          if(error<bestError){bestError=error;aligned=candidate;}
        }
        const alpha=1-stability/100*.65;
        best.points=aligned.map((p,i)=>[best.points[i][0]*(1-alpha)+p[0]*alpha,best.points[i][1]*(1-alpha)+p[1]*alpha]);
        best.cx=cx;best.cy=cy;best.length=c.length;best.hits++;best.missed=0;
      }else{best={id:this.nextId++,points,cx,cy,length:c.length,closed:c.closed,hits:1,missed:0,alpha:0};this.tracks.push(best);}
      seen.add(best.id);
      if(best.hits>=(stability>0?2:1))best.alpha=Math.min(1,best.alpha+.45);
    }
    for(const tr of this.tracks)if(!seen.has(tr.id)){tr.missed++;tr.alpha=Math.max(0,tr.alpha-.25);}
    this.tracks=this.tracks.filter(tr=>tr.missed<5).slice(-220);
    return this.tracks.filter(tr=>tr.alpha>0);
  }
}
