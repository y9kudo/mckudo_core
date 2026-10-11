import {createMachineGraph,planMachineResources,executeMachinePlan,createCampaignJournal,KudoVectorize} from '../../mckudo_core.js';
import {KudoConnect,findMenuSlot,type AuthCode} from '../../packages/kudoconnect/index.js';
import {predictElytraTick} from '../../packages/kudoconnect/src/vectorize.js';
const client=new KudoConnect({auth:'microsoft',username:'licensed-account',onMsaCode:(code:AuthCode)=>console.log(code.user_code)});
const route=await client.vectorize.planAsync({start:{x:0,y:1,z:0},goal:{x:1,y:2,z:1}});
const vector:KudoVectorize=client.vectorize;
const menu=client.menu();if(menu?.ready){const slot=findMenuSlot(menu,{contains:'Survival'});await client.execute({skill:'menuClick',args:{windowId:slot.windowId,revision:slot.revision,slot:slot.slot}});}
const graph=createMachineGraph({schemaVersion:1,minecraftVersion:'1.21.1',recipes:[{id:'example:press',machine:'example:press',inputs:[{id:'minecraft:iron_ingot'}],outputs:[{id:'example:plate'}]}]});
const plan=planMachineResources({graph,targets:[{id:'example:plate'}],inventory:[{id:'minecraft:iron_ingot'}],executors:['example:press']});
if(plan.executable)await executeMachinePlan({plan,executors:{'example:press':async(step,{signal})=>{signal.throwIfAborted();console.log(step.batches);}},observe:()=>({revision:1,resources:[]})});
const journal=createCampaignJournal({objective:'defeat-dragon'});
predictElytraTick({position:{x:0,y:100,z:0},velocity:{x:0,y:0,z:1},yaw:0,pitch:-10,rocket:true});
console.log(route,vector,journal.snapshot());
