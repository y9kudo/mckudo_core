import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {availableParallelism} from 'node:os';
import {OVERMIND} from '../overmindmc.js';
import {createDQN,createVectorEnvironment,createHeadlessEnvironment,createCurriculum,headlessCurriculumStages,HEADLESS_FEATURES,HEADLESS_ACTIONS,HEADLESS_FEATURE_SCHEMA,HEADLESS_ACTION_SCHEMA,trainCurriculum,curriculumEnvironment} from '../src/intelligence.js';

const flags=Object.fromEntries(process.argv.slice(2).map(a=>{const m=/^--(envs|workers|batches|seed|output|window|resume)=(.+)$/.exec(a);if(!m)throw new Error(`Unknown option: ${a}`);return [m[1],m[2]];}));
const count=Number(flags.envs??128),workers=Number(flags.workers??Math.min(2,count,availableParallelism())),batches=Number(flags.batches??4000),seed=Number(flags.seed??42),window=Number(flags.window??50),directory=resolve(flags.output??'data/arthas-curriculum');
if(flags.resume!==undefined&&!['true','false'].includes(flags.resume))throw new Error('resume: true/false');await mkdir(directory,{recursive:true});
const policy=createDQN({inputs:HEADLESS_FEATURES.length,actions:HEADLESS_ACTIONS.length,hidden:48,batchSize:64,capacity:20000,seed});
const resumed=flags.resume==='true',saved=resumed?JSON.parse(await readFile(resolve(directory,'checkpoint.json'),'utf8')):null;
if(saved){if(saved.featureSchema!==HEADLESS_FEATURE_SCHEMA||saved.actionSchema!==HEADLESS_ACTION_SCHEMA||saved.promotionPolicy!=='greedy-validation-v1')throw new Error('Checkpoint feature/action or promotion policy differs; start a fresh training run');policy.load(saved.model);}
const stages=headlessCurriculumStages(),curriculum=createCurriculum({stages,window,promoteAt:.85,demoteBelow:0,memory:saved?.curriculum}),controller=new AbortController();
let progress={stageBatches:saved?.stageBatches||0},status='incomplete';const checkpoints=[],validations=[];
const evaluate=(stage,validation=false)=>{const seedBase=validation?0x100000:0x200000;let successes=0,steps=0;for(let i=0;i<32;i++){const env=createHeadlessEnvironment({...curriculumEnvironment(stage),seed:seedBase+i});let s=env.reset();for(let t=0;t<(stage.maxSteps||160);t++){const result=env.step(policy.act(s.observation,{mask:s.actionMask}));steps++;if(result.terminated||result.truncated){successes+=+result.info.success;break;}s={observation:result.observation,actionMask:result.info.actionMask};}}return {id:stage.id,episodes:32,successes,meanSteps:steps/32,seeds:`${seedBase}..${seedBase+31}; ${validation?'promotion validation':'held-out evaluation'}`};};
const before=evaluate(curriculum.current()),pool=createVectorEnvironment({count,workers,seed});
const save=async()=>{const value={schemaVersion:1,version:OVERMIND.version,promotionPolicy:'greedy-validation-v1',featureSchema:HEADLESS_FEATURE_SCHEMA,actionSchema:HEADLESS_ACTION_SCHEMA,model:policy.export(),curriculum:curriculum.export(),stageBatches:progress.stageBatches};await writeFile(resolve(directory,'checkpoint.json.tmp'),JSON.stringify(value)+'\n');await rename(resolve(directory,'checkpoint.json.tmp'),resolve(directory,'checkpoint.json'));};
const stop=()=>controller.abort(new Error('Training stopped by user'));process.once('SIGINT',stop);process.once('SIGTERM',stop);
console.log('START',JSON.stringify({version:OVERMIND.version,versionName:OVERMIND.versionName,count,workers,totalStages:stages.length,resumed,before}));
let result,error;
try{result=await trainCurriculum({policy,environments:pool,curriculum,batches,initialStageBatches:progress.stageBatches,signal:controller.signal,
  validateStage:async stage=>{const evaluation=evaluate(stage,true),approved=evaluation.successes/evaluation.episodes>=.85;validations.push({...evaluation,approved});return approved;},
  onStageChange:async event=>{const evaluation=evaluate(event.previous.stage,true);checkpoints.push({batch:event.batch,from:event.previous.stage.id,to:event.current.stage.id,evaluation});progress={...progress,stageBatches:0};await save();console.log('STAGE',JSON.stringify(checkpoints.at(-1)));},
  onBatch:async event=>{progress=event;if(event.batch%100===0||event.batch===batches){await save();console.log('PROGRESS',JSON.stringify({batch:event.batch,stage:event.curriculum.stage.id,index:event.curriculum.index,totalStages:event.curriculum.totalStages,transitions:event.transitions,loss:event.training.loss}));}}
});status='completed';}catch(e){error=e.message;if(controller.signal.aborted)status='cancelled';else process.exitCode=1;}
finally{await pool.close();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);await save();}
const after=evaluate(curriculum.current()),curriculumComplete=curriculum.snapshot().index===stages.length-1&&after.successes/after.episodes>=.85&&curriculum.snapshot().successRate>=.85,report={schemaVersion:1,version:OVERMIND.version,versionName:OVERMIND.versionName,scope:'headless skill curriculum; not live Minecraft mastery',status,error,curriculumComplete,resumed,count,workers,seed,requestedBatches:batches,result,progress,before,after,promotionValidations:validations,stageEvaluations:checkpoints,policy:policy.snapshot(),rssMb:process.memoryUsage().rss/1048576};
await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2)+'\n');console.log('RESULT',JSON.stringify({status,stage:curriculum.current().id,index:curriculum.snapshot().index,after,report:resolve(directory,'report.json')}));if(status==='cancelled')process.exitCode=130;
