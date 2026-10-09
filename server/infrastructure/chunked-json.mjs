// Synchronous transaction semantics, without materializing the entire save as a string.
// Memory overhead is bounded by the output buffer, nesting and the largest scalar.
export function writeChunkedJson(value, write, {chunkChars=65536}={}) {
  let parts=[],length=0,bytes=0;const ancestors=new Set();
  const flush=()=>{if(!length)return;const text=parts.join('');write(text);bytes+=Buffer.byteLength(text);parts=[];length=0;};
  const emit=text=>{parts.push(text);length+=text.length;if(length>=chunkChars)flush();};
  const normalize=(v,key)=>{if(v&&typeof v.toJSON==='function')v=v.toJSON(key);if(v instanceof Number||v instanceof String||v instanceof Boolean)v=v.valueOf();return v;};
  const missing=v=>v===undefined||typeof v==='function'||typeof v==='symbol';
  const visit=(v,key,normalized=false)=>{
    if(!normalized)v=normalize(v,key);
    if(v===null||typeof v!=='object'){emit(JSON.stringify(v)??'null');return;}
    if(ancestors.has(v))throw new TypeError('Converting circular structure to JSON');
    ancestors.add(v);
    const array=Array.isArray(v),keys=array?null:Object.keys(v);
    // Native JSON for small flat records keeps the common event/coordinate path fast.
    if(!array&&keys.length<=64&&keys.every(k=>v[k]===null||typeof v[k]!=='object')){emit(JSON.stringify(v));ancestors.delete(v);return;}
    emit(array?'[':'{');let comma=false;
    if(array){for(let i=0;i<v.length;i++){if(i)emit(',');visit(v[i],String(i));}}
    else for(const k of keys){const item=normalize(v[k],k);if(missing(item))continue;if(comma)emit(',');comma=true;emit(JSON.stringify(k)+':');visit(item,k,true);}
    emit(array?']':'}');ancestors.delete(v);
  };
  const first=normalize(value,'');if(missing(first))return 0;visit(first,'',true);flush();return bytes;
}
