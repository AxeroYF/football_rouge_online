import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire('C:/Users/11846/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs');
const sharp=require('sharp');
const directory=path.resolve('assets/sponsors'),file=path.join(directory,'sponsors-manifest.json');
const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
fs.mkdirSync(path.join(directory,'display'),{recursive:true});
for(const brand of manifest.sponsors){
 const source=fs.readFileSync(path.join(directory,brand.icon));
 brand.sha256=crypto.createHash('sha256').update(source).digest('hex');
 if(!brand.icon.endsWith('.svg'))continue;
 const svg=source.toString(),view=svg.match(/viewBox="([^"]+)"/)[1].trim().split(/[ ,]+/).map(Number);
 const width=1024,height=Math.round(width*view[3]/view[2]);
 const {data,info}=await sharp(source).resize(width,height,{fit:'fill'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 let x0=width,y0=height,x1=0,y1=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*info.channels+info.channels-1]>8){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
 if(x1<x0||y1<y0)throw Error('Empty SVG '+brand.id);
 const sx=view[2]/width,sy=view[3]/height,pad=Math.max(view[2],view[3])*.015;
 const box=[view[0]+x0*sx-pad,view[1]+y0*sy-pad,(x1-x0+1)*sx+2*pad,(y1-y0+1)*sy+2*pad].map(v=>Number(v.toFixed(5)));
 // Preserve every vector path and color; only trim transparent canvas. Originals remain byte-identical.
 let display=svg.replace(/<svg\b[^>]*>/,tag=>tag.replace(/\s(?:width|height)="[^"]*"/g,'').replace(/viewBox="[^"]+"/,'viewBox="'+box.join(' ')+'"'));
 // The blue/white roundel needs white inside the badge, not a white rectangle outside it.
 if(brand.id==='bmw'){display=display.replace('<path ', '<circle cx="12" cy="12" r="6.182" fill="#FFFFFF"/><path ');brand.displayTreatment='Original blue artwork with opaque white inner roundel; canvas outside the badge remains transparent.';}
 brand.displayIcon='display/'+brand.icon;brand.displayViewBox=box;
 fs.writeFileSync(path.join(directory,brand.displayIcon),display);
 brand.displaySha256=crypto.createHash('sha256').update(display).digest('hex');
}
manifest.status='integrated';manifest.displayTreatment='Transparent SVG canvas trimmed with 1.5% safe margin; original paths, colors and source assets preserved; BMW inner roundel retains white quarter fields. UI uses object-fit: contain and no recoloring filters.';
fs.writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');
console.log('Prepared '+manifest.sponsors.filter(s=>s.displayIcon).length+' SVG display canvases; '+manifest.sponsors.length+' original assets retained.');
