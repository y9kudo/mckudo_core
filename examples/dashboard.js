import { startDashboard } from '../src/dashboard.js';
import { createAgentManager } from '../src/agent-manager.js';
import {findInstalledTextureArchive} from '../src/dashboard-textures.js';
const manager=createAgentManager({memoryDirectory:'data/agents',count:3,names:['Owen','Liam','Noah'],worldId:process.env.MC_WORLD||'local-survival',connection:{host:process.env.MC_HOST||'127.0.0.1',port:Number(process.env.MC_PORT||25565),version:process.env.MC_VERSION||'1.21.1',auth:'offline'}});
const textureArchive=process.env.MC_TEXTURE_PACK||await findInstalledTextureArchive(process.env.MC_VERSION||'1.21.1');
const dashboard=await startDashboard({port:Number(process.env.MC_DASHBOARD_PORT||4180),manager,textureArchive});
console.log(`OvermindMC · developed by y9kudo · ${dashboard.url}`);
let closing;const close=()=>closing||=(async()=>{await dashboard.close();})();
process.once('SIGINT',close);process.once('SIGTERM',close);
