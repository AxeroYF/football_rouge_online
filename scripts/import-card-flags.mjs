// Explicit asset import only; never runs at game startup.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CARD_NATIONALITIES} from '../client/player-card/card-identities.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dir=path.join(root,'assets/flags');
const version='v7.3.2',base=`https://cdn.jsdelivr.net/gh/lipis/flag-icons@${version.slice(1)}`;
await fs.mkdir(dir,{recursive:true});
const codes=[...new Set(Object.values(CARD_NATIONALITIES))];
for(const code of codes){
 const file=path.join(dir,code+'.svg');
 try{await fs.access(file);continue;}catch{}
 const url=code==='su'?'https://upload.wikimedia.org/wikipedia/commons/a/a9/Flag_of_the_Soviet_Union.svg':`${base}/flags/4x3/${code}.svg`;
 const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error(`${code}: ${response.status}`);
 const svg=await response.text();if(!svg.includes('<svg')||/<script|<foreignObject|\bonload\s*=/i.test(svg))throw Error('Unexpected SVG '+code);
 await fs.writeFile(file,svg);
}
const license=await fetch(`${base}/LICENSE`,{signal:AbortSignal.timeout(20000)});if(!license.ok)throw Error('License unavailable');
await fs.writeFile(path.join(dir,'LICENSE.flag-icons'),await license.text());
await fs.writeFile(path.join(dir,'README.md'),`# Card nationality flags\n\nCountry flags: [flag-icons ${version}](https://github.com/lipis/flag-icons/tree/${version}), MIT license (included).\n\nHistorical Soviet Union flag: [Wikimedia Commons source](https://commons.wikimedia.org/wiki/File:Flag_of_the_Soviet_Union.svg), public-domain official state symbol as recorded on that page.\n\nOriginal flag artwork is kept locally. The game's nationality records remain unchanged.\n`);
console.log(`Imported ${codes.length} local nationality flags.`);
