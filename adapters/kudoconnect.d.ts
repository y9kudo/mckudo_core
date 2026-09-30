import type { Adapter, Catalog, BlockTaxonomy } from '../mckudo_core.js';
import type { KudoConnect } from '../kudoconnect/index.js';
export interface KudoAdapterOptions { catalog?: Catalog; taxonomy?: BlockTaxonomy; searchRadius?: number; trackedBlocks?: string[]; }
export declare function createKudoAdapter(client: KudoConnect, options?: KudoAdapterOptions): Adapter;
