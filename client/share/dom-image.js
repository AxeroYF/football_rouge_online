// Capture the existing card DOM with its computed styles; no second card skin.
const blobData=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('图片读取失败'));reader.readAsDataURL(blob);});
export async function renderDomPng(node,{signal}={}){
 await document.fonts?.ready;
 const copy=node.cloneNode(true),sources=[node,...node.querySelectorAll('*')],targets=[copy,...copy.querySelectorAll('*')];
 for(let i=0;i<sources.length;i++){
  const style=getComputedStyle(sources[i]);for(const key of style)targets[i].style.setProperty(key,style.getPropertyValue(key));
  targets[i].style.animation='none';targets[i].style.transition='none';
  if(i%100===0){signal?.throwIfAborted();await new Promise(r=>requestAnimationFrame(r));}
 }
 copy.style.transform='none';copy.style.margin='0';copy.style.position='relative';copy.style.left='0';copy.style.top='0';
 const cache=new Map();let missing=0;
 const embed=async img=>{
  const url=img.currentSrc||img.src;
  if(!cache.has(url))cache.set(url,(async()=>{
   const parsed=new URL(url,location.href);if(parsed.origin!==location.origin&&!url.startsWith('data:image/'))throw Error('非本地卡画');
   const response=await fetch(url,{signal:AbortSignal.any([signal??new AbortController().signal,AbortSignal.timeout(12000)])});
   if(!response.ok)throw Error('卡画不可用');const blob=await response.blob();if(blob.size>12*1024*1024)throw Error('卡画过大');return blobData(blob);
  })());
  try{img.src=await cache.get(url);img.removeAttribute('srcset');img.removeAttribute('loading');}
  catch(error){signal?.throwIfAborted();img.remove();missing++;}
 };
 const images=[...copy.querySelectorAll('img')];let index=0;
 await Promise.all(Array.from({length:4},async()=>{while(index<images.length)await embed(images[index++]);}));
 signal?.throwIfAborted();
 const width=node.offsetWidth,height=node.offsetHeight;
 const xml=new XMLSerializer().serializeToString(copy);
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${xml}</foreignObject></svg>`;
 const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await image.decode();signal?.throwIfAborted();
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d').drawImage(image,0,0);
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('图片生成失败，请使用浏览器重试');
 return {blob,missing,width,height};
}
