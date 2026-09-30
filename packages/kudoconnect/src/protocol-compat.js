import { createRequire } from 'node:module';
import protodef from 'protodef';
import nbt from 'prismarine-nbt';
const require = createRequire(import.meta.url);
let cached;

/** Isolated 1.21.1 reader: never mutate minecraft-data or the protocol library cache.
 * Upstream correction: PrismarineJS/minecraft-data#1291 (recipe serializer IDs).
 */
export function recipeProtocol(registry) {
  if (registry.version.minecraftVersion !== '1.21.1') throw new Error('Recipe compatibility: Java 1.21.1 only.');
  if (cached) return cached;
  const definition = structuredClone(registry.protocol);
  const fields = definition.play.toClient.types.packet_declare_recipes[1][0].type[1].type[1];
  const mapping = fields.find(f => f.name === 'type').type[1];
  const obsolete = 'minecraft:crafting_special_banneraddpattern';
  if (Object.values(mapping.mappings).includes(obsolete)) {
    mapping.mappings = Object.fromEntries(Object.values(mapping.mappings).filter(n => n !== obsolete).map((n, i) => [i, n]));
    delete fields.find(f => f.name === 'data').type[1].fields[obsolete];
  }
  const compiler = new protodef.Compiler.ProtoDefCompiler();
  compiler.addTypes(require('minecraft-protocol/src/datatypes/compiler-minecraft.js'));
  compiler.addProtocol(definition, ['play', 'toClient']);
  nbt.addTypesToCompiler('big', compiler);
  const proto = compiler.compileProtoDefSync();
  cached = { parser: new protodef.FullPacketParser(proto, 'packet', true), serializer: new protodef.Serializer(proto, 'packet') };
  return cached;
}
