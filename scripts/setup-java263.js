import {mkdir,copyFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url)),prefix=fileURLToPath(new URL('../data/compat263/runtime/',import.meta.url));
await mkdir(prefix,{recursive:true});
await copyFile(new URL('../examples/compat263-runtime.package.json',import.meta.url),new URL('../data/compat263/runtime/package.json',import.meta.url));
const args=['install','--prefix',prefix,'--ignore-scripts','--no-audit','--no-fund'];
// npm.cmd is fixed; neither the command nor the package list comes from user input.
const child=process.platform==='win32'?spawn('cmd.exe',['/d','/s','/c',`npm.cmd install --prefix "${prefix}" --ignore-scripts --no-audit --no-fund`],{cwd:root,stdio:'inherit',windowsHide:true,env:{...process.env,npm_config_cache:fileURLToPath(new URL('../data/npm-cache/',import.meta.url))}}):spawn('npm',args,{cwd:root,stdio:'inherit'});
process.exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>resolve(code??1));});
