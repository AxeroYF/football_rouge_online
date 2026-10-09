// Patch a window without discarding unchanged cards, scroll containers or focus.
// Keys are local to each parent. Deferred card bodies belong to their observer.
export function patchMarkup(root, markup) {
  const doc=root.ownerDocument;
  if(!doc?.createElement || !root.childNodes){root.innerHTML=markup;return;}
  const template=doc.createElement('template');template.innerHTML=markup;
  const key=node=>node.nodeType===1?(node.getAttribute('data-ui-key')||node.id||null):null;
  function children(parent,next,preserveSurface=false){
    const keyed=new Map([...parent.childNodes].map(n=>[key(n),n]).filter(([k])=>k));
    let cursor=parent.firstChild;
    for(const desired of [...next.childNodes]){
      const k=key(desired);
      let current=k?keyed.get(k):cursor&&!key(cursor)?cursor:null;
      if(current && (current.nodeType!==desired.nodeType || current.nodeName!==desired.nodeName))current=null;
      if(!current){current=desired.cloneNode(true);parent.insertBefore(current,cursor);}
      else{
        if(current!==cursor)parent.insertBefore(current,cursor);
        if(current.nodeType===1 && !(preserveSurface && desired.classList.contains('shield-card-surface'))){
          const payload=desired.getAttribute('data-card-render');
          if(payload && current.getAttribute('data-card-render')!==payload){
            const replacement=desired.cloneNode(true);current.replaceWith(replacement);current=replacement;
          }else{
            for(const attr of [...current.attributes])if(!desired.hasAttribute(attr.name) && !(payload && attr.name==='data-card-rendered'))current.removeAttribute(attr.name);
            for(const attr of desired.attributes)if(current.getAttribute(attr.name)!==attr.value)current.setAttribute(attr.name,attr.value);
            children(current,desired,Boolean(payload));
            if(current.tagName==='INPUT'){current.checked=desired.checked;if(current!==doc.activeElement)current.value=desired.value;}
            if(current.tagName==='SELECT' && current!==doc.activeElement)current.value=desired.value;
          }
        }else if(current.nodeValue!==desired.nodeValue)current.nodeValue=desired.nodeValue;
      }
      cursor=current.nextSibling;
    }
    while(cursor){const next=cursor.nextSibling;cursor.remove();cursor=next;}
  }
  children(root,template.content);
}
