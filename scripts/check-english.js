import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';

const ignored=new Set(['.git','node_modules','.cache','data','work','dist','coverage']);let files=0;const failures=[];
async function visit(directory){for(const entry of await readdir(directory,{withFileTypes:true})){
  if(ignored.has(entry.name))continue;
  const path=join(directory,entry.name);if(entry.isDirectory())await visit(path);
  else if(/\.(?:js|ts|mts|json|md|html|yml|c|h|py)$/.test(path)){
    files++;const lines=(await readFile(path,'utf8')).split(/\r?\n/);lines.forEach((text,i)=>{if(/[\u0400-\u04ff]/.test(text))failures.push(`${path}:${i+1}`);});
  }
}}
await visit('.');if(failures.length){console.error('Non-English source/documentation text: '+failures.join(', '));process.exitCode=1;}else console.log(`English text check passed: ${files} files. Immutable external archives and local runtime data are excluded.`);
