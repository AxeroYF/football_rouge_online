import {readFileSync,statSync} from 'node:fs';
import {gunzipSync,gzipSync} from 'node:zlib';

export class ColdJsonCache {
  constructor({maxBytes=8*1024*1024,maxEntries=16}={}) {
    this.maxBytes=Math.max(0,maxBytes);this.maxEntries=Math.max(0,maxEntries);
    this.entries=new Map();this.bytes=0;this.reads=0;this.hits=0;
  }
  read(file,{copy=false}={}) {
    const stat=statSync(file),stamp=`${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    const cached=this.entries.get(file);
    if(cached?.stamp===stamp){this.entries.delete(file);this.entries.set(file,cached);this.hits++;return copy?structuredClone(cached.value):cached.value;}
    if(cached){this.bytes-=cached.bytes;this.entries.delete(file);}
    const input=readFileSync(file),decoded=file.endsWith('.gz')?gunzipSync(input):input;
    const value=JSON.parse(decoded.toString('utf8'));this.reads++;
    if(decoded.length<=this.maxBytes&&this.maxEntries>0){
      while(this.entries.size&&(this.entries.size>=this.maxEntries||this.bytes+decoded.length>this.maxBytes)){
        const key=this.entries.keys().next().value;this.bytes-=this.entries.get(key).bytes;this.entries.delete(key);
      }
      this.entries.set(file,{stamp,value,bytes:decoded.length});this.bytes+=decoded.length;
      return copy?structuredClone(value):value;
    }
    return value;
  }
  clear(){this.entries.clear();this.bytes=0;}
  snapshot(){return{entries:this.entries.size,decodedBytes:this.bytes,maxBytes:this.maxBytes,maxEntries:this.maxEntries,reads:this.reads,hits:this.hits};}
}
export function compressColdJson(serialized) { return gzipSync(serialized,{level:3}); }
