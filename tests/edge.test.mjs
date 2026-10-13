import test from 'node:test';
import assert from 'node:assert/strict';
import {extractContours,noise,displacement,ContourTracker} from '../dist/edge.js';
function image(w,h,rects){const data=new Uint8ClampedArray(w*h*4);for(let i=0;i<w*h;i++)data[i*4+3]=255;for(const [x,y,rw,rh,v=255] of rects)for(let yy=y;yy<y+rh;yy++)for(let xx=x;xx<x+rw;xx++){const i=(yy*w+xx)*4;data[i]=data[i+1]=data[i+2]=v;}return data;}
test('blank image has no contours',()=>assert.equal(extractContours(image(100,80,[]),100,80).length,0));
test('long silhouettes survive while small isolated details are excluded',()=>{
  const data=image(160,100,[[25,15,65,65],[120,20,4,4],[130,60,3,3]]);
  const all=extractContours(data,160,100,{minLength:1});
  const filtered=extractContours(data,160,100,{minLength:15});
  assert.ok(all.length>filtered.length);assert.ok(filtered.length>=1);
  assert.ok(filtered.every(c=>c.length>=Math.hypot(160,100)*.15));
  assert.ok(filtered.some(c=>c.closed&&c.length>200));
});
test('weak contrast is removed by the threshold',()=>{
  const data=image(100,80,[[20,20,50,40,18]]);
  assert.ok(extractContours(data,100,80,{threshold:20,minLength:2}).length>0);
  assert.equal(extractContours(data,100,80,{threshold:180,minLength:2}).length,0);
});
test('noise and animation are deterministic and continuous',()=>{
  for(const motion of ['flow','noise','vibrate']){
    const a=displacement(30,2,motion,1,7);assert.equal(a,displacement(30,2,motion,1,7));
    assert.ok(Math.abs(a-displacement(30,2.0001,motion,1,7))<.005);
    assert.equal(displacement(30,2,motion,0,7),displacement(30,20,motion,0,7));
  }assert.ok(Math.abs(noise(.999999)-noise(1.000001))<.00001);
});
test('one-frame lines do not appear; stable lines fade after loss',()=>{
  const tracker=new ContourTracker(),c={points:[[0,0],[20,0],[40,0],[60,0]],length:60,closed:false};
  assert.equal(tracker.update([c],65).length,0);assert.equal(tracker.update([c],65).length,1);
  const alpha=tracker.tracks[0].alpha;tracker.update([],65);assert.ok(tracker.tracks[0].alpha<alpha);
  for(let i=0;i<5;i++)tracker.update([],65);assert.equal(tracker.tracks.length,0);
});
test('a reversed contour retains its identity and direction',()=>{
  const tracker=new ContourTracker(),c={points:[[0,0],[20,0],[40,0],[60,0]],length:60,closed:false};
  tracker.update([c],0);const id=tracker.tracks[0].id;
  tracker.update([{...c,points:[...c.points].reverse()}],65);
  assert.equal(tracker.tracks[0].id,id);assert.ok(tracker.tracks[0].points[0][0]<1);
});
