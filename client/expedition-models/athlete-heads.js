import {add,ellipsoid,loft,stroke,surface} from './athlete-geometry.js';

// Facial proportions are authored separately; none of the five heads is a recolored sphere.
const FACES={
 messi:{w:.095,sy:1,jaw:.85,chin:.43,cheek:1,eyeGap:.039,eyeWidth:.0135,eyeHeight:.0038,brow:.035,noseWidth:.013,noseTip:.035,mouth:.030,lip:.004,skin:'skin',hair:'hair',style:'part',beard:true},
 ronaldo:{w:.089,sy:1.04,jaw:.88,chin:.49,cheek:1.01,eyeGap:.037,eyeWidth:.014,eyeHeight:.0038,brow:.036,noseWidth:.012,noseTip:.034,mouth:.029,lip:.004,skin:'tan',hair:'hair',style:'quiff'},
 mbappe:{w:.101,sy:.99,jaw:.88,chin:.54,cheek:1.03,eyeGap:.041,eyeWidth:.014,eyeHeight:.0043,brow:.038,noseWidth:.019,noseTip:.027,mouth:.034,lip:.006,skin:'dark',hair:'blackHair',style:'crop'},
 yamal:{w:.088,sy:1.03,jaw:.70,chin:.38,cheek:1,eyeGap:.037,eyeWidth:.0145,eyeHeight:.0046,brow:.037,noseWidth:.0145,noseTip:.029,mouth:.033,lip:.006,skin:'brown',hair:'blackHair',style:'curls'},
 haaland:{w:.101,sy:1.06,jaw:.97,chin:.58,cheek:1.07,eyeGap:.039,eyeWidth:.015,eyeHeight:.0032,brow:.035,noseWidth:.015,noseTip:.027,mouth:.033,lip:.0045,skin:'pale',hair:'blond',style:'tied'},
};
export function athleteHead(k,id,origin){
 const f=FACES[id],P=(x,y,z)=>add(origin,[x,y*f.sy,z]);
 const rings=[[-.121,f.w*f.chin,.041,.029],[-.106,f.w*f.jaw*.88,.061,.019],[-.078,f.w*f.jaw,.078,.010],[-.036,f.w*.96,.091,.002],[.001,f.w*f.cheek,.095,0],[.039,f.w,.095,-.003],[.079,f.w*.92,.090,-.006],[.109,f.w*.72,.074,-.008],[.122,f.w*.52,.056,-.009],[.131,f.w*.26,.030,-.010],[.135,.002,.003,-.010]];
 loft(k,rings.map(([y,w,d,z])=>[...P(0,y,z),w,d]),f.skin,'head',{frontPower:.40});
 for(const s of [-1,1]){ellipsoid(k,P(s*f.w*.99,-.014,-.005),1,[.014,.030,.017],f.skin,'ears',[0,0,s*-.10]);if(k.lod<2)ellipsoid(k,P(s*f.w*1.045,-.015,.007),1,[.006,.019,.006],f.skin+'Shade','ear_folds');}
 // Bridge, tip and alae form a continuous, modest projection from the face.
 loft(k,[[...P(0,-.031,.103),f.noseWidth*.68,.010],[...P(0,-.015,.106),f.noseWidth,.018],[...P(0,.016,.101),f.noseWidth*.64,.012],[...P(0,.038,.091),f.noseWidth*.63,.007]],f.skin,'nose_bridge',{sides:k.detail(12,10,8)});
 ellipsoid(k,P(0,-.018,.100+f.noseTip*.70),1,[f.noseWidth,.014,f.noseTip*.5],f.skin,'nose');
 for(const s of [-1,1]){ellipsoid(k,P(s*f.noseWidth*.87,-.026,.110),1,[f.noseWidth*.63,.008,.011],f.skin,'nose');if(k.lod===0)ellipsoid(k,P(s*f.noseWidth*.60,-.031,.118),1,[.004,.0023,.003],'nostril','nostrils');}
 for(const s of [-1,1]){
  const ex=s*f.eyeGap,ey=.026,ez=.094;
  // Small inset eyes and lids replace the large round toy pupils.
  ellipsoid(k,P(ex,ey,ez),1,[f.eyeWidth*1.23,f.eyeHeight*1.8,.006],f.skin+'Shade','eye_sockets');
  ellipsoid(k,P(ex,ey,ez+.005),1,[f.eyeWidth,f.eyeHeight*.83,.0035],'eyeWhite','eyes');
  ellipsoid(k,P(ex,ey,ez+.008),1,[.0044,f.eyeHeight*.94,.002],id==='haaland'?'irisBlue':'irisBrown','irises');
  if(k.lod<2)ellipsoid(k,P(ex,ey,ez+.0094),1,[.0024,f.eyeHeight*.88,.0008],'eye','pupils');
  stroke(k,[P(ex-s*f.eyeWidth,ey+.001,ez+.007),P(ex,ey+f.eyeHeight+.001,ez+.008),P(ex+s*f.eyeWidth,ey,ez+.007)],.0012,id==='haaland'?'paleShade':'eye','eyelids');
  stroke(k,[P(ex-s*.018,f.brow-.001,.096),P(ex,f.brow+.002,.099),P(ex+s*.018,f.brow-.001,.091)],id==='haaland'?.0019:.0027,id==='haaland'?'blondDark':f.hair,'brows');
 }
 // Lips sit on the muzzle plane, with a narrow mouth crease.
 ellipsoid(k,P(0,-.053,.092),1,[f.mouth,f.lip,.004],f.skin+'Lip','upper_lip');
 ellipsoid(k,P(0,-.060,.091),1,[f.mouth*.84,f.lip*.85,.004],f.skin+'Lip','lower_lip');
 stroke(k,[P(-f.mouth*.91,-.056,.094),P(0,-.057,.097),P(f.mouth*.91,-.056,.094)],.0014,f.skin+'Shade','mouth');
 if(f.beard){
  // Beard follows the actual jaw surface, leaving cheeks and lips exposed.
  const v=[],faces=[],n=k.detail(32,20,12),rows=8;
  for(let r=0;r<rows;r++)for(let j=0;j<=n;j++){const angle=-1.72+j/n*3.44,t=r/(rows-1),top=-.073+Math.abs(Math.sin(angle))*.055,y=top+(-.119-top)*t;
   v.push(P(...scalpPoint(rings,y,angle,.0035)));}
  for(let r=0;r<rows-1;r++)for(let j=0;j<n;j++){const a=r*(n+1)+j;faces.push([a,a+1,a+n+1],[a+1,a+n+2,a+n+1]);}surface(k,v,faces.map(([a,b,c])=>[a,c,b]),'beard','beard');
  for(const s of [-1,1])stroke(k,[P(s*.003,-.043,.111),P(s*.016,-.044,.107),P(s*.030,-.048,.099)],.0048,'beard','moustache');
  
 }
 hair(k,f,P,rings);
}
function scalpPoint(rings,y,a,offset=0){
 let low=rings[0],high=rings[1];for(let i=0;i<rings.length-1;i++)if(y>=rings[i][0]){low=rings[i];high=rings[i+1];}
 const t=Math.max(0,Math.min(1,(y-low[0])/(high[0]-low[0]))),w=low[1]+(high[1]-low[1])*t,d=low[2]+(high[2]-low[2])*t,z=low[3]+(high[3]-low[3])*t,c=Math.cos(a);
 return [Math.sin(a)*(w+offset),y,z+Math.sign(c)*Math.pow(Math.abs(c),c>0?.40:1)*(d+offset)];
}
function hair(k,f,P,rings){
 const n=k.detail(48,32,20),rows=k.detail(16,11,7),vs=[],faces=[];
 for(let r=0;r<=rows;r++)for(let j=0;j<n;j++){
  const a=j/n*Math.PI*2,front=Math.max(0,Math.cos(a)),hairline=f.style==='quiff'?.086:f.style==='crop'?.078:f.style==='curls'?.064:.081;
  const boundary=(f.style==='tied'?-.053:-.025)+(hairline+(f.style==='tied'?.053:.025))*Math.pow(front,.75);
  const y=boundary+(.135-boundary)*r/rows,pt=scalpPoint(rings,y,a,.0045);pt[1]+=.003;
  vs.push(P(...pt));
 }
 for(let r=0;r<rows;r++)for(let j=0;j<n;j++){const a=r*n+j,b=r*n+(j+1)%n;faces.push([a,b,a+n],[b,b+n,a+n]);}
 surface(k,vs,faces,f.hair,'hair_cap');
 if(f.style==='part'||f.style==='quiff'){
  const count=k.detail(9,6,4);
  for(let i=0;i<count;i++){
   const angle=-1.12+i/(count-1)*2.24,points=[];
   for(let j=0;j<=5;j++){const y=.083+j*.009,pt=scalpPoint(rings,y,angle-j*(f.style==='part'?.13:.025),.007);pt[1]+=.003+(f.style==='quiff'?.003:0);points.push(P(...pt));}
   stroke(k,points,.0024,i%3===0?'hairHighlight':f.hair,'swept_hair');
  }
  if(k.lod<2){const points=[.082,.100,.117,.127].map(y=>{const pt=scalpPoint(rings,y,.55,.007);pt[1]+=.003;return P(...pt);});stroke(k,points,.0013,'hairHighlight','hair_part');}
 }
 if(f.style==='quiff'){
  for(let i=0;i<5;i++){const x=-.057+i*.026;ellipsoid(k,P(x,.118+(.02-Math.abs(x)*.13),.044),1,[.024,.017,.035],f.hair,'quiff',[0,.22,-.20]);}
 }
 if(f.style==='curls'){
  const count=k.detail(105,60,32),golden=Math.PI*(3-Math.sqrt(5));
  for(let i=0;i<count;i++){const t=(i+.5)/count,y=.061+.072*t,a=i*golden,size=.011+(Math.sin(i*13.1)+1)*.0018,pt=scalpPoint(rings,y,a,.007);pt[1]+=.005;
   ellipsoid(k,P(...pt),size,[1,.82,1],i%9===0?'curlLight':f.hair,'curls');}
 }
 if(f.style==='tied'){
  ellipsoid(k,P(0,.034,-.111),1,[.039,.032,.030],'blondDark','hair_tie');ellipsoid(k,P(0,.039,-.133),1,[.042,.037,.036],'blond','hair_knot');
  stroke(k,[P(0,.018,-.141),P(.009,-.019,-.152),P(.014,-.050,-.140)],.017,'blond','ponytail');
  const count=k.detail(11,7,4);for(let i=0;i<count;i++){const a=-1.20+i/(count-1)*2.40,points=[.085,.104,.122,.131].map(y=>{const p=scalpPoint(rings,y,a,.006);p[1]+=.004;return P(...p);});stroke(k,points,.0011,'blondDark','hair_strands');}
 }
}
