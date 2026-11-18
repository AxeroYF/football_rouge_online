import fs from 'node:fs';
import path from 'node:path';
const args=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split('=')));
const file=args.input??'outputs/v4-opportunities-20261117/calibration-train-5400.json';
const input=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const presets=[...new Set(input.rows.flatMap(r=>[r.home,r.away]))];
const summary=sample=>{
  const n=sample.length,wins=sample.filter(r=>r.for>r.against).length,draws=sample.filter(r=>r.for===r.against).length,p=n?wins/n:0,z=1.96;
  const centre=(p+z*z/(2*n))/(1+z*z/n),width=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/(1+z*z/n);
  return {matches:n,wins,draws,losses:n-wins-draws,winShare:p,winShareWilson95:[centre-width,centre+width],
    goalsFor:sample.reduce((sum,r)=>sum+r.for,0)/n,goalsAgainst:sample.reduce((sum,r)=>sum+r.against,0)/n};
};
const teams=Object.fromEntries(presets.map(preset=>{
  const rows=input.rows.flatMap(r=>r.home===r.away?[]:r.home===preset?[{opponent:r.away,side:'home',for:r.score[0],against:r.score[1]}]:r.away===preset?[{opponent:r.home,side:'away',for:r.score[1],against:r.score[0]}]:[]);
  return [preset,{...summary(rows),home:summary(rows.filter(r=>r.side==='home')),away:summary(rows.filter(r=>r.side==='away')),
    opponents:Object.fromEntries(presets.filter(q=>q!==preset).map(q=>[q,summary(rows.filter(r=>r.opponent===q))]))}];
}));
const warnings=Object.entries(teams).flatMap(([preset,s])=>s.winShare>.75?[`${preset}: dominant across synthetic opponent presets (${(100*s.winShare).toFixed(1)}% wins)`]:s.winShare<.05?[`${preset}: severe weakness across synthetic opponent presets (${(100*s.winShare).toFixed(1)}% wins)`]:[]);
const report={version:1,input:path.resolve(file),runs:input.rows.length,sourceHashes:input.sourceHashes,teams,warnings,
  scope:'Descriptive preset audit; excludes same-preset fixtures. Presets change several instructions together. This is not a single-factor causal estimate or real-team balance acceptance.'};
const output=args.output??'outputs/v4-opportunities-20261117/tactical-preset-audit.json';fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({output,warnings}));
