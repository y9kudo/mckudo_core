import {episodeHash,episodeNamespaceHash} from './learning/episode-provenance.js';
import {createNeuralPlanner} from './neural-planning.js';
import {jsonCopy} from './config.js';

/** Compare immutable checkpoints on separately labeled, held-out observations. No game simulation. */
export function evaluateCognitiveCheckpoint({baseline,candidate,evaluation,minSamples=16,minImprovement=.001,maxRegression=.01}={}){
  if(!Number.isInteger(minSamples)||minSamples<4||minSamples>4096||!Number.isFinite(minImprovement)||minImprovement<0||minImprovement>1||!Number.isFinite(maxRegression)||maxRegression<0||maxRegression>1)throw new Error('Cognitive evaluation thresholds are invalid.');
  const initial=jsonCopy(baseline,'baseline',2*1024*1024),proposed=jsonCopy(candidate,'candidate',2*1024*1024),dataset=jsonCopy(evaluation,'evaluation',4*1024*1024);
  if(initial.worldId!==proposed.worldId)throw new Error('Cognitive checkpoints belong to different worlds.');
  if(dataset.split!=='evaluation'||!['unit','headless','minecraft'].includes(dataset.source)||!Array.isArray(dataset.records)||dataset.records.length>4096)throw new Error('A bounded, explicitly labeled evaluation split and source are required.');
  const a=createNeuralPlanner({worldId:initial.worldId,memory:initial,mode:'evaluate'}),b=createNeuralPlanner({worldId:proposed.worldId,memory:proposed,mode:'evaluate'});
  const training=new Set([...(initial.provenance?.episodeHashes||[]),...(proposed.provenance?.episodeHashes||[])]),ids=new Set();
  const namespaces=new Set([...(initial.provenance?.namespaceHashes||[]),...(proposed.provenance?.namespaceHashes||[])]);
  const groups=new Map(),totals={baseline:0,candidate:0};let samples=0;
  for(const r of dataset.records){
    if(typeof r.episodeId!=='string'||!r.episodeId||r.episodeId.length>160||ids.has(r.episodeId)||!['success','failure','progress'].includes(r.outcome))throw new Error('Evaluation episodes must be unique and have observed outcomes.');
    if(r.after?.self?.health!=null&&!Number.isFinite(r.after.self.health)||r.verified!==undefined&&typeof r.verified!=='boolean')throw new Error('Evaluation verification or health is invalid.');
    ids.add(r.episodeId);if(training.has(episodeHash(r.episodeId))||namespaces.has(episodeNamespaceHash(r.episodeId)))throw new Error('Evaluation episode overlaps training provenance.');
    if(r.outcome==='progress'&&r.verified!==true||r.verified===false||['STALE_WORLD','SERVER_CORRECTION','OCCUPIED','SUPPORT_CHANGED','UNLOADED','DYNAMIC_OBSTACLE'].includes(r.failureCode))continue;
    const y=Number(r.outcome==='failure'||r.after?.self?.health!=null&&r.after.self.health<(r.before.self?.health??20));
    const x=a.assess(r.before,r.action).failureProbability,z=b.assess(r.before,r.action).failureProbability;
    const left=(x-y)**2,right=(z-y)**2;totals.baseline+=left;totals.candidate+=right;samples++;
    const group=r.before.dimension||'unknown';if(!groups.has(group))groups.set(group,{samples:0,baseline:0,candidate:0});const g=groups.get(group);g.samples++;g.baseline+=left;g.candidate+=right;
  }
  const metrics={samples,baselineBrier:samples?totals.baseline/samples:null,candidateBrier:samples?totals.candidate/samples:null,groups:[...groups].map(([id,g])=>({id,samples:g.samples,baselineBrier:g.baseline/g.samples,candidateBrier:g.candidate/g.samples}))};
  const provenance=a.snapshot().provenanceComplete&&b.snapshot().provenanceComplete;
  const regression=metrics.groups.some(g=>g.samples>=4&&g.candidateBrier>g.baselineBrier+maxRegression);
  const enough=samples>=minSamples&&provenance;
  const accepted=enough&&!regression&&metrics.candidateBrier+minImprovement<metrics.baselineBrier;
  return {decision:!enough?'inconclusive':accepted?'promote':'retain',accepted,source:dataset.source,split:'evaluation',metrics,
    reason:!enough?'Insufficient held-out evidence or incomplete training provenance.':regression?'A represented dimension regressed beyond its tolerance.':accepted?'The candidate improved held-out Brier error without a detected group regression.':'The candidate did not meet the required held-out improvement.',
    memory:jsonCopy(accepted?proposed:initial,'selectedCheckpoint',2*1024*1024)};
}
