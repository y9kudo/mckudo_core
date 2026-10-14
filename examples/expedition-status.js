import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';

const args=process.argv.slice(2),file=args.find(a=>!a.startsWith('--'))??'data/full-expedition/report.json';
const watch=args.includes('--watch'),json=args.includes('--json'),stop=new AbortController();
process.once('SIGINT',()=>stop.abort());process.once('SIGTERM',()=>stop.abort());
do{
  try{
    const r=JSON.parse(await readFile(file,'utf8'));
    const status={
      player:r.player,status:r.status,stage:r.expedition?.scenario?.current,
      completed:r.expedition?.scenario?.completed??[],
      health:r.final?.health,food:r.final?.food,dimension:r.final?.dimension,position:r.final?.position,
      activeAction:r.activeAction??null,inventory:r.final?.inventory??{},
      deaths:r.totalDeaths??r.deaths?.length??0,actions:r.totalActions??r.actions?.length??0,
      learning:Object.fromEntries(['planner','navigation'].map(name=>[name,r.learning?.[name]?{
        samples:r.learning[name].samples,newSamples:r.learning[name].newSamples,
        updates:r.learning[name].updates,weightsChanged:r.learning[name].weightsChanged,
        rememberedFailures:r.learning[name].rememberedFailures
      }:null])),
      failureCounts:r.failureCounts,releaseReadiness:r.releaseReadiness,heartbeatAt:r.heartbeatAt,
      reason:r.reason??r.expedition?.scenario?.reason
    };
    if(json)console.log(JSON.stringify(status));
    else{
      const learn=name=>status.learning[name]?`${status.learning[name].samples} samples / ${status.learning[name].updates} updates`:'not recorded';
      console.log(`${r.player} | ${r.status} | ${status.stage??'finished'} | health ${status.health} / food ${status.food}`);
      console.log(`Completed: ${status.completed.join(', ')||'none'} | deaths ${status.deaths} | actions ${status.actions}`);
      console.log(`Learning: planning ${learn('planner')}; navigation ${learn('navigation')}`);
      console.log(`Current action: ${JSON.stringify(status.activeAction)} | ${status.reason??''}`);
      console.log(`Release: ${status.releaseReadiness?.status??'unverified'}; blockers: ${status.releaseReadiness?.blockers.join(', ')??'not assessed'}`);
    }
  }catch(error){
    console.error(`Cannot read ${file}: ${error.message}`);
    if(!watch){process.exitCode=1;break;}
  }
  if(watch)await delay(3000,undefined,{signal:stop.signal}).catch(error=>{if(!stop.signal.aborted)throw error;});
}while(watch&&!stop.signal.aborted);
