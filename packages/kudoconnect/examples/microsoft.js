import {createKudoConnect} from '../index.js';

if(!process.env.MC_HOST)throw new Error('Задай MC_HOST — адрес сервера Java 1.21/1.21.1.');
const client=createKudoConnect({
  host:process.env.MC_HOST,port:Number(process.env.MC_PORT??25565),version:'1.21.1',
  auth:'microsoft',username:process.env.MC_ACCOUNT??'my-account',
  profilesFolder:'.cache/kudoconnect/auth',authTimeoutMs:180000,
  onMsaCode:({verification_uri,user_code})=>console.log(`Вход Microsoft: ${verification_uri}\nКод: ${user_code}`)
});
process.once('SIGINT',()=>void client.close());
try{await client.connect();console.log({status:client.state.status,profile:client.snapshot().authentication.profile});}
finally{await client.close();}
