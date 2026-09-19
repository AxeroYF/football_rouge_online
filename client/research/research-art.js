export function researchArt(topic){
 if(topic.branch==='biology')return '<svg viewBox="0 0 160 180" aria-hidden="true"><path d="M48 18c0 54 64 90 64 144M112 18c0 54-64 90-64 144" stroke-width="4"/><path d="M52 31h56M61 51h38M74 71h12M67 111h26M55 131h50M49 151h62" stroke-width="3"/></svg>';
 const pitch='<rect x="14" y="8" width="132" height="164" rx="3"/><path d="M14 90h132M48 8v28h64V8M48 172v-28h64v28"/><circle cx="80" cy="90" r="20"/>';
 let marks='';
 if(topic.branch==='formation'){
  const rows=[...topic.label.split('-').map(Number).reverse(),1];
  rows.forEach((n,row)=>{for(let j=0;j<n;j++)marks+=`<circle class="research-player-dot" cx="${14+132*(j+1)/(n+1)}" cy="${23+row*132/(rows.length-1)}" r="5"/>`;});
 }else if(topic.branch==='tactic'){
  const id=topic.id.split(':')[1];
  const paths={possession:'M43 124 117 124 80 57Z M43 124 80 91 117 124 M80 91V57',wingPlay:'M40 145V46l-8 10m8-10 8 10 M120 145V46l-8 10m8-10 8 10 M40 46 68 27 M120 46 92 27',longBall:'M80 144Q14 79 80 26l-5 13m5-13-14 4',counterAttack:'M46 141 110 84 62 84 105 29l-12 6m12-6-2 15',lowBlock:'M31 118h98M31 130h98M46 103h68M62 86h36',parkBus:'M31 118h98M31 130h98M46 103h68M62 86h36',roughPlay:'M43 48 117 131M117 48 43 131M35 65l25-23M100 139l25-23',defensive:'M35 118h90M47 132h66M80 105V49l-8 10m8-10 8 10',balanced:'M46 135V50l-8 10m8-10 8 10M114 45v85l-8-10m8 10 8-10',direct:'M80 146V28l-10 13m10-13 10 13'};
  marks=`<path class="research-arrow" d="${paths[id]??'M40 137V62l-8 10m8-10 8 10M80 147V43l-8 10m8-10 8 10M120 137V62l-8 10m8-10 8 10'}"/>`;
 }else return `<svg viewBox="0 0 160 180" aria-hidden="true"><path class="research-shield" d="M80 13 139 36v59c0 36-38 60-59 72-21-12-59-36-59-72V36Z"/><path d="m49 49 31-12 31 12"/><text x="80" y="111" text-anchor="middle">+${topic.target}</text><path d="m66 131 14 8 14-8"/></svg>`;
 return `<svg viewBox="0 0 160 180" aria-hidden="true">${pitch}${marks}</svg>`;
}
