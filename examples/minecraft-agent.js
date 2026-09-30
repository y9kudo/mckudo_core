import { createKudoConnect } from '../kudoconnect/index.js';
import { createMinecraftBrain } from '../mckudo_core.js';
// Only application lifecycle lives here; behavior is supplied by the two libraries.
const client = createKudoConnect({username:process.env.MC_USERNAME || 'Henry',host:process.env.MC_HOST || '127.0.0.1',port:Number(process.env.MC_PORT || 25565)});
const brain = createMinecraftBrain({client,worldId:process.env.MC_WORLD || 'local-world'});
let closing;
const close = () => closing ||= (async()=>{await brain.stop();await client.close();})();
process.once('SIGINT',close); process.once('SIGTERM',close);
client.once('death',close); client.once('end',close); client.once('fault',close);
client.on('warning',e=>console.log(e.message));
brain.on('action:finish',r=>console.log(`${r.skill}: ${r.outcome}`));
try {await client.connect();if(!closing)brain.start();}
catch(error){console.error(error.message);process.exitCode=1;await close();}
