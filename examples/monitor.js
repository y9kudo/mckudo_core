import {startExpeditionMonitor} from '../src/expedition-monitor.js';
const monitor=await startExpeditionMonitor({reportPath:process.env.MC_REPORT||'data/full-expedition/report.json',port:Number(process.env.MC_DASHBOARD_PORT||4181)});
console.log('OvermindMC expedition progress · '+monitor.url);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void monitor.close());
