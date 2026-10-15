import {startDashboard} from '../src/dashboard.js';
import {createAgentManager} from '../src/agent-manager.js';
import {findInstalledTextureArchive} from '../src/dashboard-textures.js';

const name=process.env.MC_NAME||'OMCreative07';
const manager=createAgentManager({count:1,names:[name],worldId:process.env.MC_WORLD||'creative-flat-1.21.1',memoryDirectory:'data/agents',connection:{host:process.env.MC_HOST||'127.0.0.1',port:Number(process.env.MC_PORT||25565),version:'1.21.1',auth:'offline',viewDistance:24}});
const dashboard=await startDashboard({port:Number(process.env.MC_DASHBOARD_PORT||4180),manager,textureArchive:process.env.MC_TEXTURE_PACK||await findInstalledTextureArchive('1.21.1')});
console.log(`OvermindMC Creative · ${dashboard.url} · ${name}`);
try{await manager.execute(name,'connect');console.log(`${name}: connected · ${manager.snapshot().agents[0].state.gameMode}`);}catch(error){console.error(`${name}: ${error.message}`);}
let closing;const close=()=>closing||=(async()=>{await dashboard.close();})();
process.once('SIGINT',close);process.once('SIGTERM',close);
