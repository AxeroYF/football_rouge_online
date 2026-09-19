// Fullscreen card stages cover the map; suspend its drawing until the stage closes.
export function observeCardStage(documentRef,onChange){
 const roots=['inventory-window','scouting-selection','card-management-window'].map(id=>documentRef.getElementById(id)).filter(Boolean);
 let current=null;
 const update=()=>{const active=roots.some(r=>!r.hidden&&(r.id==='card-management-window'||r.classList.contains('inventory-opening-stage-root')));if(active!==current){current=active;onChange(active);}};
 const observer=new documentRef.defaultView.MutationObserver(update);
 for(const root of roots)observer.observe(root,{attributes:true,attributeFilter:['hidden','class']});
 update();return ()=>observer.disconnect();
}
