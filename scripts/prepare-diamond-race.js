import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sourceDigest} from '../examples/benchmark/race-metrics.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const data=path.join(root,'data');fs.mkdirSync(data,{recursive:true});
const directory=fs.mkdtempSync(path.join(data,'diamond-sources-'));
const releases=[
  {version:'0.2.0',id:'v02',name:'Atlas02',ref:'c476317'},
  {version:'0.3.0',id:'v03',name:'Brooks03',archive:path.resolve(process.env.MC_V03_ARCHIVE||path.join(root,'../mckudo_core-v0.3.0.zip'))},
  {version:'0.4.0',id:'v04',name:'Carter04',ref:'d5d0e75'},
  {version:'0.5.0',id:'v05',name:'Dylan05',ref:'6743220'},
  {version:'0.6.0',id:'v06',name:'Elliot06',ref:'v0.6.0'},
  {version:'0.7.0-dev.0',id:'v07',name:'Flynn07',ref:'v0.7.0-dev.0'}
];
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
for(const r of releases){
  const destination=path.join(directory,r.id);fs.mkdirSync(destination);
  let archive=r.archive;
  if(r.ref){
    r.commit=cp.execFileSync('git',['rev-parse',r.ref+'^{commit}'],{cwd:root,encoding:'utf8'}).trim();
    archive=path.join(directory,r.id+'.tar');
    cp.execFileSync('git',['archive','--format=tar','-o',archive,r.commit],{cwd:root});
  }
  if(!fs.existsSync(archive))throw new Error('Missing historical archive: '+archive);
  const names=cp.execFileSync('tar',['-tf',archive],{encoding:'utf8',maxBuffer:4*1024*1024}).trim().split(/\r?\n/);
  for(const name of names){
    const normalized=name.replaceAll('\\','/');
    if(path.isAbsolute(name)||/^[a-z]:/i.test(name)||normalized.split('/').includes('..'))throw new Error('Unsafe archive entry: '+name);
  }
  const details=cp.execFileSync('tar',['-tvf',archive],{encoding:'utf8',maxBuffer:4*1024*1024}).trim().split(/\r?\n/);
  if(details.some(line=>!['-','d'].includes(line[0])))throw new Error('Archive must contain only regular files and directories, without links.');
  r.archiveSHA256=hash(archive);
  cp.execFileSync('tar',['-xf',archive,'-C',destination]);
  const pkg=JSON.parse(fs.readFileSync(path.join(destination,'package.json'),'utf8'));
  if(pkg.version!==r.version)throw new Error(`Expected ${r.version}, archive contains ${pkg.version}`);
  r.directory=destination;r.sourceSHA256=sourceDigest(destination);delete r.archive;delete r.ref;
}
// All historical adapters use the same installed protocol dependencies. Their own source is immutable.
fs.symlinkSync(path.join(root,'node_modules'),path.join(directory,'node_modules'),'junction');
const dependencies=Object.fromEntries(['mineflayer','mineflayer-pathfinder','minecraft-protocol','minecraft-data'].map(name=>[name,JSON.parse(fs.readFileSync(path.join(root,'node_modules',name,'package.json'),'utf8')).version]));
const manifest={schemaVersion:1,preparedAt:new Date().toISOString(),dependencies,dependencyLockSHA256:hash(path.join(root,'package-lock.json')),releases};
fs.writeFileSync(path.join(data,'diamond-race-sources.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({manifest:'data/diamond-race-sources.json',dependencies,releases:releases.map(({version,name,commit,sourceSHA256})=>({version,name,commit,sourceSHA256}))},null,2));
