import type { Adapter, Catalog, BlockTaxonomy, Position } from '../mckudo_core.js';
export interface MineflayerAdapterOptions { goals: any; catalog?: Catalog; taxonomy?: BlockTaxonomy; trackedBlocks?: string[]; watchedPositions?: Position[]; searchRadius?: number; entityRadius?: number; scanIntervalMs?: number; requestedViewDistance?: number; }
export declare function createMineflayerAdapter(bot: any, options: MineflayerAdapterOptions): Adapter;
