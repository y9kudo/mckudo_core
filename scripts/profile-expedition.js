import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
const args=process.argv.slice(2),file=args.find(a=>!a.startsWith('--'))??'data/full-expedition/report.json';
const report=JSON.parse(await readFile(file,'utf8'));
const phases=Object.entries(report.performance??{}).map(([name,p])=>({name,calls:p.calls,meanMs:p.calls?p.totalMs/p.calls:0,lastMs:p.lastMs,maxMs:p.maxMs})).sort((a,b)=>b.meanMs-a.meanMs);
const result={player:report.player,recordedAt:report.heartbeatAt??report.finishedAt,phases,physics:report.final?.metrics?.timing,physicsMaxTickMs:report.final?.metrics?.maxTickMs,routeScheduler:report.final?.metrics?.navigation,runtime:report.runtime??null,
  interpretation:'Phase means are wall-clock measurements, not a flame graph. Action execution includes waits for server acknowledgements. Measure CPU hotspots and boundary-copy costs before choosing a native backend.'};
const output=args.find(a=>a.startsWith('--output='))?.slice(9);
if(output){await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2));}
console.log(JSON.stringify(result,null,2));
