import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,join,basename} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),args=process.argv.slice(2);
const option=(key,fallback)=>args.find(a=>a.startsWith(`--${key}=`))?.slice(key.length+3)??fallback;
const cc=option('cc',process.env.CC??join(root,'.cache/native-toolchain/tinycc/tcc/tcc.exe'));
const include=option('node-include',join(root,`.cache/native-toolchain/node-${process.version}/include/node`));
const library=option('node-lib',join(root,'.cache/native-toolchain/node.lib'));
const output=resolve(root,'native/build/om_kernel.node');await mkdir(resolve(root,'native/build'),{recursive:true});
if(!existsSync(join(include,'node_api.h')))throw new Error('Node-API headers are missing. Supply --node-include=PATH.');
const sources=[join(root,'native/node_binding.c'),join(root,'native/om_kernel.c')];
const tiny=/^tcc(?:\.exe)?$/i.test(basename(cc));
let flags;
if(tiny){
  const text=await readFile(sources[0],'utf8'),symbols=[...new Set(text.match(/\bnapi_[a-z0-9_]+(?=\()/g))].sort();
  const definition=join(root,'native/build/node.def');await writeFile(definition,'LIBRARY node.exe\nEXPORTS\n'+symbols.join('\n')+'\n');
  flags=['-shared','-I'+include,...sources,definition,'-o',output];
}else if(/^cl(?:\.exe)?$/i.test(basename(cc))){
  flags=['/nologo','/TC','/O2','/LD','/I'+include,...sources,'/link',library,'/OUT:'+output];
}else{
  flags=[.../^zig(?:\.exe)?$/i.test(basename(cc))?['cc']:[],'-std=c11','-O2','-shared',...process.platform!=='win32'?['-fPIC']:[],'-I'+include,...sources,...process.platform==='win32'?[library]:['-lm'],'-o',output];
}
const result=spawnSync(cc,flags,{cwd:join(root,'native/build'),stdio:'inherit',windowsHide:true,shell:false});
if(result.error)throw result.error;if(result.status!==0)process.exit(result.status??1);
console.log(JSON.stringify({status:'built',language:'C',abi:1,compiler:cc,output}));
