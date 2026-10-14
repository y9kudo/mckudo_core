import {OMConnect,createJava263Profile} from '../omconnect/index.js';

const root='../data/compat263/runtime/node_modules/';
const [{default:wire},{default:registry},{default:chunks},{default:blocks}]=await Promise.all([
  import(new URL(root+'@wp2508/minecraft-protocol/src/index.js',import.meta.url)),
  import(new URL(root+'@wp2508/minecraft-data/index.js',import.meta.url)),
  import(new URL(root+'@wp2508/prismarine-chunk/index.js',import.meta.url)),
  import(new URL(root+'prismarine-block/index.js',import.meta.url))
]);
const profile=createJava263Profile({loadRegistry:version=>{
  const data=registry(version),prior=registry('26.1.2');
  // Provisional inherited metadata; live acceptance must validate every used family.
  for(const entity of data.entitiesArray)if(!entity.metadataKeys&&prior.entitiesByName[entity.name]?.metadataKeys)entity.metadataKeys=[...prior.entitiesByName[entity.name].metadataKeys];
  return data;
},createProtocolClient:options=>wire.createClient(options),chunkFactory:chunks,blockFactory:blocks});
export const create263Client=options=>new OMConnect({...options,version:'26.3'},{versionProfile:profile});

