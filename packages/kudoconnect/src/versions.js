import minecraftData from 'minecraft-data';
import protocol from 'minecraft-protocol';

export const NATIVE_VERSIONS=Object.freeze(['1.21','1.21.1']);
export function versionSupport(version){
  const record=minecraftData.versions.pc.find(v=>v.minecraftVersion===version),data=record&&minecraftData(version);
  return {version,known:Boolean(record),protocol:record?.version??null,catalog:Boolean(data?.itemsArray&&data?.blocksArray&&data?.recipes),transport:protocol.supportedVersions.includes(version)||NATIVE_VERSIONS.includes(version),native:NATIVE_VERSIONS.includes(version),liveTested:version==='1.21.1'};
}
export function listVersionSupport(){
  return ['26.3',...new Set([...NATIVE_VERSIONS,...protocol.supportedVersions].filter(v=>v!=='26.3'))].map(version=>({version,native:NATIVE_VERSIONS.includes(version),liveTested:version==='1.21.1',transport:protocol.supportedVersions.includes(version)||NATIVE_VERSIONS.includes(version)}));
}
