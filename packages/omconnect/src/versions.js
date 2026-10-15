import minecraftData from 'minecraft-data';
import protocol from 'minecraft-protocol';

export const NATIVE_VERSIONS=Object.freeze(['1.21','1.21.1']);
export const OFFICIAL_VERSION_MANIFEST='https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
export function versionSupport(version){
  let data=null;
  try{data=minecraftData(version);}catch{/* Historical IDs can be ambiguous to the installed catalog. */}
  const record=minecraftData.versions.pc.find(v=>v.minecraftVersion===version)||data?.version;
  const transport=Boolean(data?.protocol&&(protocol.supportedVersions.includes(version)||protocol.supportedVersions.some(v=>minecraftData.versions.pc.find(r=>r.minecraftVersion===v)?.version===record?.version)));
  return {version,known:Boolean(record),protocol:record?.version??null,catalog:Boolean(data?.itemsArray&&data?.blocksArray&&data?.recipes),transport,native:NATIVE_VERSIONS.includes(version),liveTested:version==='1.21.1'};
}
export function listVersionSupport(){
  return ['26.3',...new Set([...NATIVE_VERSIONS,...protocol.supportedVersions].filter(v=>v!=='26.3'))].map(version=>({version,native:NATIVE_VERSIONS.includes(version),liveTested:version==='1.21.1',transport:protocol.supportedVersions.includes(version)||NATIVE_VERSIONS.includes(version)}));
}

/** Discover official Java release IDs without claiming that their gameplay actions work. */
async function readOfficialManifest(fetchImpl){
  if(typeof fetchImpl!=='function')throw new TypeError('fetchImpl must be a function.');
  const response=await fetchImpl(OFFICIAL_VERSION_MANIFEST);
  if(!response?.ok)throw new Error(`Official version manifest unavailable: ${response?.status??'no response'}`);
  const manifest=await response.json();
  if(!Array.isArray(manifest?.versions))throw new Error('Official version manifest has no version list.');
  return manifest;
}
export async function discoverOfficialJavaVersions({fetchImpl=globalThis.fetch,includeLegacy=true,includeSnapshots=false}={}){
  const manifest=await readOfficialManifest(fetchImpl);
  const types=includeLegacy?new Set(['release','old_beta','old_alpha']):new Set(['release']);
  if(includeSnapshots)types.add('snapshot');
  return manifest.versions.filter(entry=>types.has(entry.type)&&typeof entry.id==='string').map(entry=>({
    version:entry.id,type:entry.type,releaseTime:entry.releaseTime??null,...versionSupport(entry.id)
  }));
}
/** Check whether Mojang offers a standalone server for one exact version. */
export async function inspectOfficialJavaVersion(version,{fetchImpl=globalThis.fetch}={}){
  if(typeof version!=='string'||!/^[A-Za-z0-9._-]{1,64}$/.test(version))throw new Error('Invalid official version ID.');
  const manifest=await readOfficialManifest(fetchImpl),entry=manifest.versions.find(candidate=>candidate.id===version);
  if(!entry)throw new Error(`Version ${version} is absent from the official launcher manifest.`);
  const url=new URL(entry.url);
  if(url.protocol!=='https:'||url.hostname!=='piston-meta.mojang.com')throw new Error('Unexpected official version metadata host.');
  const response=await fetchImpl(url.href);
  if(!response?.ok)throw new Error(`Official metadata unavailable for ${version}: ${response?.status??'no response'}`);
  const metadata=await response.json(),server=metadata?.downloads?.server;
  if(server?.url){const download=new URL(server.url);if(download.protocol!=='https:'||!['piston-data.mojang.com','launcher.mojang.com'].includes(download.hostname))throw new Error('Unexpected official server download host.');}
  return {version,type:entry.type,releaseTime:entry.releaseTime??null,officialServer:Boolean(server?.url&&server?.sha1),serverDownload:server?.url&&server?.sha1?{url:server.url,sha1:server.sha1,size:server.size??null}:null,support:versionSupport(version)};
}
