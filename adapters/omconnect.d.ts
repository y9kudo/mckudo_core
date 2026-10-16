import type { Adapter, Catalog, BlockTaxonomy } from '../overmindmc.js';
import type { OMConnect } from '../omconnect/index.js';
export interface OMAdapterOptions { catalog?: Catalog; taxonomy?: BlockTaxonomy; searchRadius?: number; trackedBlocks?: string[]; verifyResults?:boolean;perception?:false|import('../overmindmc.js').PerceptionOptions; }
export declare function createOMAdapter(client: OMConnect, options?: OMAdapterOptions): Adapter;
