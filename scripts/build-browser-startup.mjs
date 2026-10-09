// Build on the developer machine; the production server needs no build dependency.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {build} from '../tools/browser-build/node_modules/esbuild/lib/main.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=p=>fs.readFile(path.join(root,p),'utf8');
const hash=s=>createHash('sha256').update(s).digest('hex').slice(0,20);
const source=await read('index.html');
const entries=[...source.matchAll(/<script type="module" src="([^"?]+)[^"]*"><\/script>/g)].map(m=>m[1]);
const aliases=JSON.parse(source.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
const result=await build({absWorkingDir:root,stdin:{contents:entries.map(p=>`import ${JSON.stringify(p)};`).join('\n'),resolveDir:root},
 bundle:true,format:'esm',platform:'browser',target:'chrome110',minifyWhitespace:true,minifySyntax:true,minifyIdentifiers:false,
 write:false,metafile:true,legalComments:'inline',plugins:[{name:'original-module-paths',setup(b){
  b.onResolve({filter:/.*/},args=>{
   const spec=aliases[args.path]??args.path;
   if(!spec.startsWith('.'))return;
   return {path:path.resolve(aliases[args.path]?root:args.resolveDir,spec.split('?')[0])};
  });
  b.onLoad({filter:/\.(?:js|mjs)$/},async args=>{
   let contents=await fs.readFile(args.path,'utf8');
   // Preserve module-relative icon URLs after code moves into the startup bundle.
   if(contents.includes('import.meta.url'))contents=contents.replaceAll('import.meta.url',`new URL(${JSON.stringify('./'+path.relative(root,args.path).replaceAll('\\','/'))},document.baseURI).href`);
   return {contents,loader:'js',resolveDir:path.dirname(args.path)};
  });
 }}]});
const js=result.outputFiles[0].text;
const styles=[...source.matchAll(/<link rel="stylesheet" href="([^"?]+)[^"]*"[^>]*>/g)].map(m=>m[1]);
const css=(await Promise.all(styles.map(async p=>{
 const text=await read(p);
 return `/* ${p} */\n`+text.replace(/url\(\s*(["']?)([^\s)"']+)\1\s*\)/g,(all,quote,url)=>{
  if(/^(?:[a-z]+:|\/|#)/i.test(url))return all;
  return `url(${JSON.stringify('./'+path.posix.normalize(path.posix.join(path.posix.dirname(p),url)))})`;
 });
}))).join('\n');
let html=source.replace(/<script type="importmap">[\s\S]*?<\/script>/,'');
let first=true;
html=html.replace(/<link rel="stylesheet" href="[^" ]+"[^>]*>/g,()=>{if(!first)return '';first=false;return `<link rel="stylesheet" href="./game-startup.css?v=sha256-${hash(css)}">`;});
html=html.replace(/<script type="module" src="[^"]*"><\/script>/g,'');
html=html.replace('</body>',`<script type="module" src="./game-startup.js?v=sha256-${hash(js)}"></script>\n</body>`);
const outputs={'game-startup.js':js,'game-startup.css':css,'game.html':html};
for(const [file,contents]of Object.entries(outputs)){
 if(process.argv.includes('--check')){if(await read(file)!==contents)throw Error('Stale browser build: '+file);}
 else await fs.writeFile(path.join(root,file),contents);
}
console.log(JSON.stringify({modules:Object.keys(result.metafile.inputs).length,styles:styles.length,outputs:Object.fromEntries(Object.entries(outputs).map(([k,v])=>[k,Buffer.byteLength(v)]))}));
