const $=s=>document.querySelector(s),canvases=[$('#before'),$('#after')],contexts=canvases.map(c=>c.getContext('2d')),palette=['#9cbfac','#d0bd8e','#b3ba92','#9ebbbb','#c6b394','#a8c3a0','#adb5ca','#c5c397','#a8b8a1','#bbacaf','#aac4c2','#c5bca4'];
let data,visibleOld=[],visibleNew=[],choice='GBR',center=[-3,65],span=18,zoom=1,selected=null,down=null;
const project=(x,y)=>[x,-Math.log(Math.tan(Math.PI/4+Math.max(-84,Math.min(84,y))*Math.PI/360))*180/Math.PI];
const polys=g=>g.type==='Polygon'?[g.coordinates]:g.coordinates;
function prepare(f,index){const p=new Path2D(),polygons=polys(f.geometry).map(poly=>poly.map(ring=>ring.map(v=>project(...v))));for(const poly of polygons)for(const r of poly){r.forEach((v,i)=>i?p.lineTo(...v):p.moveTo(...v));p.closePath();}return {...f,path:p,polygons,color:palette[index%palette.length]};}
function filter(f){return choice==='europe'||choice==='south-america'?f.properties.region===choice:f.properties.code===choice;}
function fit(){
 const fixed={GBR:[-9,49,3,61],FRA:[-6,41,10,52],ITA:[6,35,19,48],europe:[-14,34,39,65],'south-america':[-83,-57,-33,13]}[choice];
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 if(fixed){[minX,minY]=project(fixed[0],fixed[3]);[maxX,maxY]=project(fixed[2],fixed[1]);}
 else for(const f of visibleOld)for(const poly of f.polygons)for(const r of poly)for(const [x,y]of r){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
 const c=canvases[0];center=[(minX+maxX)/2,(minY+maxY)/2];span=Math.max((maxX-minX)*c.clientHeight/c.clientWidth,maxY-minY)*1.1;zoom=1;render();
}
function transform(c){const w=c.clientWidth,h=c.clientHeight,s=h/span*zoom;return {w,h,s,x:w/2-center[0]*s,y:h/2-center[1]*s};}
function render(){
 canvases.forEach((c,i)=>{const ctx=contexts[i],{w,h,s,x,y}=transform(c),dpr=Math.min(devicePixelRatio,1.5);if(c.width!==Math.round(w*dpr)||c.height!==Math.round(h*dpr)){c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);}ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#dce8e1';ctx.fillRect(0,0,w,h);ctx.translate(x,y);ctx.scale(s,s);
 for(const f of i?visibleNew:visibleOld){ctx.fillStyle=f.color;ctx.fill(f.path,'evenodd');ctx.strokeStyle=i?'#486854':'#e9ead8';ctx.lineWidth=(i?1.25:.7)/s;ctx.stroke(f.path);}
 if(i&&$('#old-lines').checked){ctx.strokeStyle='#60796160';ctx.lineWidth=.55/s;for(const f of visibleOld)ctx.stroke(f.path);}
 if(selected){ctx.strokeStyle='#fff4c4';ctx.lineWidth=3/s;ctx.stroke(selected.path);}
 });
}
function pointInRing(x,y,r){let v=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])v=!v;}return v;}
function inspect(x,y){selected=visibleNew.find(f=>f.polygons.some(p=>pointInRing(x,y,p[0])&&!p.slice(1).some(r=>pointInRing(x,y,r))));
 const node=$('#info');node.replaceChildren();if(!selected){node.textContent='点击任意区域，查看哪些原地块被合并在一起。';render();return;}
 const p=selected.properties,title=document.createElement('strong');title.textContent=p.country+' · '+p.name+'及周边 — '+p.sourceCount+' 块合为 1 块';node.append(title);
 const desc=document.createElement('p');desc.textContent=p.memberNames.join('、');node.append(desc);
 if(p.cityIds.length){const note=document.createElement('div');note.textContent='保留城市标记：'+p.cityIds.join(' / ');node.append(note);}render();
}
function select(){choice=$('#region').value;visibleOld=data.original.filter(filter);visibleNew=data.proposed.filter(filter);$('#before-count').textContent=visibleOld.length+' 块';$('#after-count').textContent=visibleNew.length+' 块';selected=null;$('#info').textContent='点击任意区域，查看其合并成员。两侧视角同步；颜色一致表示属于同一候选区域。';fit();}
for(const c of canvases){
 c.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(.7,Math.min(14,zoom*Math.exp(-e.deltaY*.001)));render();},{passive:false});
 c.addEventListener('pointerdown',e=>{down={id:e.pointerId,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY};c.setPointerCapture(e.pointerId);});
 c.addEventListener('pointermove',e=>{if(!down)return;const {s}=transform(c);center[0]-=(e.clientX-down.x)/s;center[1]-=(e.clientY-down.y)/s;down.x=e.clientX;down.y=e.clientY;render();});
 c.addEventListener('pointerup',e=>{if(!down)return;const click=Math.hypot(e.clientX-down.startX,e.clientY-down.startY)<4;down=null;if(click){const b=c.getBoundingClientRect(),t=transform(c);inspect((e.clientX-b.left-t.x)/t.s,(e.clientY-b.top-t.y)/t.s);}});
 c.addEventListener('pointercancel',()=>down=null);
}
$('#fit').addEventListener('click',()=>data&&fit());$('#old-lines').addEventListener('change',()=>data&&render());$('#region').addEventListener('change',select);
try{
 const res=await fetch('./assets/territory-merge-review/proposal.json');if(!res.ok)throw Error('读取候选数据失败');data=await res.json();
 const colors=new Map();data.proposed=data.proposed.map((f,i)=>{for(const id of f.properties.members)colors.set(id,i);return prepare(f,i);});data.original=data.original.map(f=>prepare(f,colors.get(f.properties.id)));
 const proposal=data.scenarios.find(s=>s.id==='recommended');$('#total').innerHTML='1,470 → '+proposal.count+' <em>减少 '+proposal.reductionPercent+'%</em>';$('#distribution').innerHTML=proposal.regions.europe+' / '+proposal.regions['south-america']+' <em>候选分布</em>';$('#per-player').innerHTML='184 → '+proposal.perPlayer+' <em>块 / 人，不代表实际比赛场次</em>';
 const options=[{code:'europe',name:'欧洲总览'},{code:'south-america',name:'南美总览'},...data.countries];$('#region').replaceChildren(...options.map(c=>{const o=document.createElement('option');o.value=c.code;o.textContent=c.name+(c.original?' · '+c.original+' → '+c.proposed:'');return o;}));$('#region').value='GBR';$('#region').disabled=false;select();
 new ResizeObserver(()=>data&&render()).observe(canvases[0]);window.territoryMergeReview={ready:true,getState:()=>({choice,before:visibleOld.length,after:visibleNew.length,zoom,selected:selected?.properties.id??null}),data};
}catch(e){$('#info').textContent=e.message;$('#info').className='error';console.error(e);}
