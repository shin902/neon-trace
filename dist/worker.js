import {extractContours} from './edge.js';
self.onmessage=({data})=>{
  try{const contours=extractContours(new Uint8ClampedArray(data.buffer),data.width,data.height,data.options);self.postMessage({contours,epoch:data.epoch});}
  catch(error){self.postMessage({error:error.message,epoch:data.epoch});}
};
