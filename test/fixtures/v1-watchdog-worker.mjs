import {workerData} from 'node:worker_threads';
import {reportHeartbeat} from '../../src/platform/supervisor.js';
reportHeartbeat({phase:'started'});
if(workerData.block)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
else setInterval(()=>reportHeartbeat({phase:'progress'}),20);
