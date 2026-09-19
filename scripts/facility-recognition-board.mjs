import fs from 'node:fs/promises';
import path from 'node:path';

// Render at native pixel sizes, so enlarged contact sheets cannot hide readability problems.
export async function renderRecognitionBoard({root,output,catalog,sharp}){
 const W=1240,H=220+catalog.items.filter(i=>i.kind==='unit'||i.level===1).length*137,parts=[],esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
 const svg=(w,h,body)=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><style>text{font-family:Microsoft YaHei,Arial,sans-serif}</style>${body}</svg>`);
 const text=(x,y,s,size=15,color='#324939')=>`<text x="${x}" y="${y}" font-size="${size}" fill="${color}">${esc(s)}</text>`;
 parts.push({input:svg(W,144,text(36,43,'低等级设施与单位 · 第二版辨识对比',27)+text(37,76,'同尺寸比较 · 主体形状、类别主色、64px 彩色与灰度',14,'#72806d')),left:0,top:0});
 const xs=[330,530,730,935,1110];for(const [i,label]of ['旧版 LV1','新版 LV1','新版 LV2','64px 彩色','64px 灰度'].entries())parts.push({input:svg(180,32,text(0,22,label,14)),left:xs[i]-47,top:105});
 const rows=[...catalog.items.filter(i=>i.kind==='facility'&&i.level===1),...catalog.items.filter(i=>i.kind==='unit')];
 for(const [r,item]of rows.entries()){
  const y=150+r*137;parts.push({input:svg(W,137,`<path d="M36 132H1204" stroke="#d8dccc"/>`+text(36,45,item.name,18)+text(36,75,item.kind==='unit'?'独立单位':'LV1 → LV2',12,'#829078')),left:0,top:y});
  const base=path.join(root,'assets/facilities/icons'),old=path.join(output,'before-v1',item.assetId+'.png');
  const sources=[old,path.join(base,item.assetId+'.png'),item.level?path.join(base,item.type+'-lv2.png'):null,path.join(base,item.assetId+'.png'),path.join(base,item.assetId+'.png')];
  for(let c=0;c<5;c++){
   const f=sources[c];if(!f){parts.push({input:svg(90,40,text(30,25,'—',15,'#a1aa96')),left:xs[c]-45,top:y+41});continue;}
   try{await fs.access(f);}catch{parts.push({input:svg(160,40,text(0,25,'未保存旧版',12,'#a1aa96')),left:xs[c]-42,top:y+41});continue;}
   const size=c>=3?64:108,height=item.kind==='unit'&&c<3?120:size;let pipe=sharp(f).resize(size,height,{fit:'contain',background:'#00000000'});if(c===4)pipe=pipe.grayscale();parts.push({input:await pipe.png().toBuffer(),left:xs[c]-Math.floor(size/2),top:y+Math.floor((125-height)/2)});
  }
 }
 parts.push({input:svg(W,42,text(37,27,'灰度栏用于检查轮廓，不代表正式游戏配色；所有新图像均由实际 GLB 渲染。',12,'#74806d')),left:0,top:H-60});
 await sharp({create:{width:W,height:H,channels:4,background:'#f1f1e7'}}).composite(parts).png().toFile(path.join(output,'low-level-comparison.png'));
}
