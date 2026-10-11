export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Action { skill: string; args?: Record<string, Json>; }
export interface Position { x: number; y: number; z: number; }
export interface NavigationBlock { name?: string; id?: string; boundingBox?: string; shapes?: number[][]; diggable?: boolean; getProperties?(): Record<string, unknown>; }
export declare function traceVisibility(options:{origin:Position;target:Position;getBlock:(position:Position)=>NavigationBlock|null;maxDistance?:number}):{visible:boolean;reason:'clear'|'blocked'|'unloaded'|'too-far';position:Position|null};
export interface ProtectedRegion {id:string;dimension:string;min:Position;max:Position;}
export interface ProtectionOptions {regions?:ProtectedRegion[];structures?:boolean;structureRadius?:number;}
export interface EditDecision {allowed:boolean;reason:string;regionId?:string;evidence?:Position;}
export declare function isStructureBlock(block:NavigationBlock|null):boolean;
export declare class KudoProtection {
  constructor(options?:ProtectionOptions);
  readonly revision:number;
  readonly regions:ProtectedRegion[];
  add(region:ProtectedRegion):ProtectedRegion;
  remove(id:string):boolean;
  remember(dimension:string,position:Position,block:NavigationBlock & {stateId?:number}):void;
  forget(dimension:string,position:Position):void;
  check(options:{operation:'dig'|'place';dimension:string;position:Position;block?:NavigationBlock|null;getBlock?:(position:Position)=>NavigationBlock|null}):EditDecision;
}
export interface KudoOptions { host?: string; port?: number; username?: string; version?: '1.21' | '1.21.1'; auth?: 'offline'; viewDistance?: number; connectTimeoutMs?: number; maxDrop?: number; fallHealthReserve?: number; maxFallDamage?: number; bridgeReserve?: number; bridgeItemValue?: (name: string,item: KudoItem) => number; protection?:ProtectionOptions; }
export interface KudoState { status: 'disconnected' | 'connecting' | 'ready' | 'dead'; entityId: number | null; position: Position | null; velocity: Position; yaw: number; pitch: number; onGround: boolean; health: number | null; food: number | null; dimension: string | null; gameMode: string | number | null; environment?: Environment; sleeping?: boolean; sprinting?: boolean; sneaking?:boolean; frozen?: boolean; horizontalCollision?: boolean; }
export interface KudoMetrics { packetsSent: number; corrections: number; actions: number; failures: number; maxTickMs: number; timing?: TickTimingSnapshot; navigation?: WorkSchedulerSnapshot; decoderWarnings: { message: string; at: number }[]; reactions: unknown[]; }
export interface KudoItem { name: string; item: string; type: number; count: number; slot: number; raw: any; }
export interface KudoTime { timeOfDay:number|null; isDay:boolean|null; age:number|null; }
export interface EyeFlight {entityId:string;dimension:string;launched:Position;origin:Position;end:Position;samples:number;at:number;}
export interface EndEvidence {eyes:EyeFlight[];crystals:{entityId:string;position:Position;confirmed:true;evidence:'explosion-and-removal';at:number}[];ownDragonHits?:number;dragonDeath?:{entityId:string;confirmed:true;evidence:'entity-death-status'|'health-zero-and-dying-phase';ownDamageConfirmed:boolean;ownHitCount:number;at:number};}
export interface PillarArgs {count?:number;block?:string;}
export interface PillarResult {ok:true;serverConfirmed:true;placed:(Position & {block:string})[];position:Position;}
export interface KudoSnapshot extends KudoState { time:KudoTime; equipment:ReturnType<KudoInventory["equipment"]>; identity: typeof KUDOCONNECT; inventory: Record<string, number>; loadedChunks: number; metrics: KudoMetrics; }
export declare const KUDOCONNECT: Readonly<{ name: 'KudoConnect'; version: '0.6.0'; author: 'y9kudo'; apiVersion: 1; minecraftVersions: readonly string[]; authentication: readonly string[] }>;
export declare const KUDO_SKILLS: readonly string[];
export interface FallPolicy { health?:number; minHealthAfter?:number; maxDamage?:number; slowFalling?:boolean; sneaking?:boolean; }
export interface FallAssessment { height:number; landing:string|null; estimatedDamage:number|null; healthAfter:number|null; survivable:boolean; allowed:boolean; reason:string; }
export declare function assessFall(options:FallPolicy & {height:number;landing:NavigationBlock|null}):FallAssessment;
export interface RouteStep {kind:'dig'|'bridge'|'walk'|'jump'|'drop';position:Position;block?:string;expected?:string;fall?:FallAssessment;}
export interface RoutePlan {status:'planned'|'blocked';reason:string;steps:RouteStep[];visited:number;unknown:Position[];cost?:number;bridgeUsed?:number;fallDamage?:number;partial?:boolean;target?:Position;}
export declare function planRoute(options:{start:Position;goal:Position;getBlock:(position:Position)=>NavigationBlock|null;occupied?:(position:Position)=>boolean;edgeCost?:(from:Position,to:Position,kind:RouteStep["kind"])=>number;range?:number;maxNodes?:number;maxDistance?:number;maxDrop?:number;fallPolicy?:FallPolicy;bridgeBudget?:number;bridgeBlock?:string;canDig?:(block:NavigationBlock,position:Position)=>boolean;canPlace?:(position:Position)=>boolean;allowPartial?:boolean;signal?:AbortSignal}):RoutePlan;
export interface RouteScheduling {sliceMs?:number;nodesPerSlice?:number;getRevision?:()=>unknown;scheduler?:WorkScheduler;}
export declare function planRouteAsync(options: Parameters<typeof planRoute>[0], scheduling?: RouteScheduling): Promise<RoutePlan>;
export declare class KudoConnect {
  constructor(options?: KudoOptions, components?: { createProtocolClient?: (options: Record<string, unknown>) => any; physics?: typeof stepPhysics });
  readonly options: Required<KudoOptions>;
  readonly registry: any;
  readonly dataLoaded: boolean;
  readonly recipeBook: WorldRecipeBook;
  readonly world: KudoWorld;
  readonly inventory: KudoInventory;
  readonly players: KudoPlayers;
  readonly containers: KudoContainers;
  readonly protection: KudoProtection;
  watchPlayer(username: string, options?: AttentionOptions): AttentionLease;
  findStorages(options?: StorageSearchOptions): Promise<StorageSearchResult>;
  readonly state: KudoState;
  readonly time: KudoTime;
  readonly endgame: EndEvidence;
  readonly metrics: KudoMetrics;
  readonly trace: ActionTrace[];
  on(event: string, listener: (...args: any[]) => void): this;
  once(event: string, listener: (...args: any[]) => void): this;
  removeListener(event: string, listener: (...args: any[]) => void): this;
  connect(): Promise<this>;
  respawn(options?: {signal?: AbortSignal;timeoutMs?: number}): Promise<KudoSnapshot>;
  lookAt(position: Position,options?: {signal?: AbortSignal;turnSpeed?: number;immediate?: boolean}): void;
  waitForLook(options?: {signal?: AbortSignal;timeoutMs?: number}): Promise<void>;
  cancelLook(): void;
  describe(): { contract: 'kudoconnect.agent'; version: 1; minecraftVersion: string; skills: string[] };
  observe(): AgentObservation;
  subscribeUrgent(listener: (event: { type: 'damage'; entityId: string }) => void): () => void;
  registerSkill(name: string, handler: (args: Record<string, Json>, context: { client: KudoConnect; signal: AbortSignal }) => unknown | Promise<unknown>): this;
  execute(action: Action, options?: { signal?: AbortSignal; priority?: number }): Promise<any>;
  snapshot(): KudoSnapshot;
  close(): Promise<void>;
}
export declare function createKudoConnect(options?: KudoOptions): KudoConnect;
export interface FoundBlock { name: string; position: Position; stateId: number; distance: number; properties: Record<string, unknown>; }
export declare class KudoWorld {
  constructor(registry: any, options?: { maxChunks?: number });
  readonly columns: Map<string, unknown>;
  readonly revision: number;
  readonly minY: number;
  readonly height: number;
  readonly dimension: string;
  on(event: 'blockUpdate' | 'chunkLoad' | 'chunkUnload', listener: (event: any) => void): this;
  registerClass(name: string, members: string[]): void;
  resolveSelectors(selectors: string[]): string[];
  blockAt(position: Position): (NavigationBlock & { position: Position; stateId: number; getProperties(): Record<string, unknown> }) | null;
  createReadView(): {blockAt(position:Position):NavigationBlock|null;isCurrent():boolean};
  stateAt(position: Position): number | null;
  findBlocks(options: { names?: string[]; classes?: string[]; properties?: Record<string, string | boolean | number>; position: Position; radius?: number; count?: number; maxVisited?: number; signal?: AbortSignal }): Promise<{ blocks: FoundBlock[]; visited: number; truncated: boolean; revision: number }>;
}
export declare class KudoInventory {
  constructor(registry: any);
  readonly slots: (KudoItem | null)[];
  readonly revision: number;
  readonly stateId: number;
  readonly selected: number;
  items(): KudoItem[];
  count(name: string): number;
  ownedCount(name: string): number;
  equipment(): Record<'head'|'chest'|'legs'|'feet', KudoItem|null>;
  held(): KudoItem | null;
  snapshot(): Record<string, number>;
}
export interface Environment { medium: 'air' | 'water' | 'lava'; contacts: string[]; support: string; flow: Position; unknown: boolean; hazardous: boolean; slipperiness: number; }
export interface PhysicsState { position: Position; velocity: Position; onGround: boolean; horizontalCollision?: boolean; frozen?: boolean; environment?: Environment; sneaking?:boolean; }
export declare function stepPhysics(state: PhysicsState, control: { x?: number; z?: number; jump?: boolean; sneak?: boolean; sprint?: boolean; usingItem?: boolean }, getBlock: (p: Position) => NavigationBlock | null): PhysicsState;
export declare function environmentAt(position: Position, getBlock: (p: Position) => NavigationBlock | null): Environment;
export declare function fluidAt(block: NavigationBlock | null): { kind: 'water' | 'lava'; height: number; level: number; falling: boolean } | null;
export declare function miningTime(registry: any, block: any, item: { type: number } | null, options?: { onGround?: boolean }): { milliseconds: number; harvestable: boolean };
export interface ActionTrace { at: number; skill: string; priority: number; outcome: 'success' | 'failure' | 'cancelled'; detail: string; durationMs: number; }
export interface AgentObservation { endgame:{eyes:EyeFlight[]}; time:KudoTime; equipment:ReturnType<KudoInventory['equipment']>; contract: 'kudoconnect.agent'; version: 1; minecraftVersion: string; self: KudoState; inventory: Record<string, number>; entities: { id: string; name: string; kind: string; position: Position; velocity: Position; health: number | null }[]; world: { dimension: string | null; revision: number; loadedChunks: number }; combat: { attackers: any[] }; drops: { id: string; item: string; count: number; position: Position }[]; }
export interface PeerEnvelope { protocol: 1; team: string; from: string; to: string | null; sequence: number; topic: string; payload: Json; expiresAt: number; }
export interface PeerClaim { resource: string; bid: number; release: boolean; from: string; sequence: number; expiresAt: number; observedAt: number; }
export declare class KudoPeer {
  constructor(options: { id: string; team: string; peers: string[]; send: (message: PeerEnvelope) => void; clock?: () => number; settleMs?: number });
  readonly id: string; readonly team: string; readonly clock: () => number;
  send(topic: string, payload: Json, options?: { to?: string | null; ttlMs?: number }): PeerEnvelope;
  receive(message: PeerEnvelope): boolean;
  claim(resource: string, options?: { bid?: number; ttlMs?: number }): PeerEnvelope;
  release(resource: string): PeerEnvelope;
  owner(resource: string): string | null;
  owns(resource: string): boolean;
  snapshot(): { id: string; team: string; claims: PeerClaim[]; messagesRemembered: number };
  on(event: 'message', listener: (message: PeerEnvelope) => void): this;
  close(): void;
}
export interface Fleet { agents: Map<string, KudoConnect>; peers: Map<string, KudoPeer>; connect(): Promise<this>; snapshot(): Record<string, { agent: KudoSnapshot; peer: ReturnType<KudoPeer['snapshot']> }>; close(): Promise<void>; }
export declare const DEFAULT_AGENT_NAMES: readonly string[];
export declare function createFleet(options?: { count?: number; names?: string[]; connection?: KudoOptions; team?: string; settleMs?: number; createClient?: (options: KudoOptions) => KudoConnect }): Fleet;
export interface ProjectileProfile { weapon: 'bow' | 'crossbow' | 'trident'; speed: number; gravity: number; drag: number; waterDrag: number; }
export declare function projectileProfile(weapon?: 'bow' | 'crossbow' | 'trident', chargeTicks?: number): ProjectileProfile;
export type ProjectileTrace = { status: 'clear'; path: Position[]; position: Position; ticks: number } | { status: 'blocked'; path: Position[]; ticks: number; collision: { t: number; cell: Position; reason: string } };
export declare function traceProjectile(options: { origin: Position; velocity: Position; profile?: ProjectileProfile; ticks?: number; getBlock: (p: Position) => NavigationBlock | null }): ProjectileTrace;
export type AimSolution = { status: 'aimed'; yaw: number; pitch: number; ticks: number; predicted: Position; error: number; velocity: Position; path: Position[]; hitConfirmed: false } | { status: 'blocked'; reason: string; hitConfirmed: false };
export declare function solveAim(options: { origin: Position; target: Position; targetVelocity?: Position; inheritedVelocity?: Position; weapon?: 'bow' | 'crossbow' | 'trident'; chargeTicks?: number; maxTicks?: number; radius?: number; getBlock: (p: Position) => NavigationBlock | null }): AimSolution;
export interface PlayerObservation { uuid: string; username: string | null; listed: boolean | null; latency: number | null; gameMode: number | null; entityId: string | null; observed: boolean; position: Position | null; yaw: number | null; headYaw: number | null; pitch: number | null; managedAgent: boolean; }
export interface PlayerEntity { id: string; uuid: string; kind: 'player'; username: string; position: Position; velocity: Position; yaw: number; headYaw: number; pitch: number; eyeHeight: number; }
export declare class KudoPlayers {
  constructor(client: KudoConnect);
  entity(usernameOrUuid: string): PlayerEntity | null;
  snapshot(): PlayerObservation[];
}
export interface AttentionOptions { durationMs?: number; maxDistance?: number; priority?: number; turnSpeed?: number; }
export interface AttentionLease { stop(): boolean; snapshot(): { id: number; username: string; uuid: string | null; expiresAt: number; maxDistance: number; priority: number; turnSpeed: number; active: boolean }; }
export interface GazeSubject { position: Position; yaw?: number; headYaw?: number; pitch?: number; eyeHeight?: number; }
export declare function gazeAngles(from: Position, to: Position): { yaw: number; pitch: number };
export declare function gazeError(observer: GazeSubject, target: GazeSubject): number | null;
export interface StorageObservation { dimension: string; position: Position; observedAt: number; contents: { item: string; count: number }[]; }
export declare class KudoContainers {
  constructor(inventory: KudoInventory, registry: any);
  readonly observations: Map<string, StorageObservation>;
  contents(): KudoItem[];
  capacity(item: KudoItem): number;
}
export declare function chooseMiningTool(registry: any, block: any, items: KudoItem[], options?: { held?: KudoItem | null; onGround?: boolean }): { item: KudoItem | null; milliseconds: number; harvestable: boolean } | null;
export interface AgentObservation { players: PlayerObservation[]; attention: { status: string; target: string | null; entityId?: string; errorDegrees?: number }; storage: StorageObservation[]; }
export interface StorageIdentity { key: string; kind: string; positions: Position[]; }
export interface StorageSearchOptions { radius?: number; count?: number; signal?: AbortSignal; }
export interface StorageSearchResult { storages: (FoundBlock & StorageIdentity)[]; visited: number; truncated: boolean; revision: number; }
export declare function isStorageBlock(name: string): boolean;
export declare function storageIdentity(world: Pick<KudoWorld,'blockAt'>, position: Position): StorageIdentity | null;
export declare function findStorages(client: KudoConnect, options?: StorageSearchOptions): Promise<StorageSearchResult>;
export interface CraftRecipe { item:string;count:number;width?:number;height?:number;table:boolean;cells:{x:number;y:number;choices:string[]}[]; }
export declare function craftingRecipes(registry:any,item:string,book?:WorldRecipeBook):CraftRecipe[];
export declare function chooseCraftingRecipe(registry:any,item:string,inventory:Record<string,number>,options?:{ingredients?:Record<string,number>;recipeBook?:WorldRecipeBook}):(Omit<CraftRecipe,'cells'>&{cells:{x:number;y:number;item:string}[]})|null;
export declare function smeltingRecipe(registry:any,item:string):{item:string;inputs:string[];ticks:number}|null;
export declare function fuelItems(item:string):number;
export declare function rotateToward(state:{yaw:number;pitch:number},angles:{yaw:number;pitch:number},options?:{turnSpeed?:number;dt?:number}):{yaw:number;pitch:number};
export interface MovementControl { x:number;z:number;jump:boolean;sprint:boolean;sneak?:boolean; }
export declare function travelControl(state:KudoState&{position:Position},target:Position,getBlock:(p:Position)=>NavigationBlock|null,options?:{sprint?:boolean;sprintJump?:boolean;guarding?:boolean;longDistance?:number}):MovementControl;
export declare function combatControl(state:KudoState&{position:Position},target:Position,mode:string,getBlock:(p:Position)=>NavigationBlock|null,options?:{guarding?:boolean;strafeSide?:number}):MovementControl;
export declare function bridgeMaterials(registry:any,items:KudoItem[],options?:{blockAtState?:(stateId:number)=>NavigationBlock;itemValue?:(name:string,item:KudoItem)=>number;reserve?:number}):{name:string;block:string;count:number;value:number;slot:number}[];
export interface RecipeBookSnapshot {source:'server'|'waiting';revision:number;announced:number;indexedOutputs:number;}
export interface WorldRecipe {id:string;type:string;output:{item:string;count:number};ingredients:{choices:string[];count:number}[];station:string|null;executable:boolean;cells:{x:number;y:number;choices:string[]}[];reason:string;}
export declare class WorldRecipeBook {constructor(registry:any);readonly received:boolean;readonly revision:number;ingest(packet:{recipes:any[]}):void;recipesFor(item:string):WorldRecipe[];snapshot():RecipeBookSnapshot;}
export declare const NATIVE_VERSIONS:readonly string[];
export interface VersionSupport {version:string;known:boolean;protocol:number|null;catalog:boolean;transport:boolean;native:boolean;liveTested:boolean;}
export declare function versionSupport(version:string):VersionSupport;
export declare function listVersionSupport():Pick<VersionSupport,'version'|'native'|'liveTested'|'transport'>[];

export interface TickTimingSnapshot {ticks:number;samples:number;meanIntervalMs:number|null;p95IntervalMs:number|null;maxIntervalMs:number|null;delayedTicks:number;effectiveHz:number|null;}

export interface WorkSchedulerSnapshot {completed:number;failed:number;cancelled:number;turns:number;maxTurnMs:number;pending:number;closed:boolean;budgetMs:number;maxJobs:number;}
export interface WorkScheduler {submit<T>(iterator:Iterator<unknown,T>, options?:{signal?:AbortSignal;sliceMs?:number;nodesPerSlice?:number;validate?:()=>void}):Promise<T>;snapshot():WorkSchedulerSnapshot;close():void;}
export declare function createWorkScheduler(options?:{budgetMs?:number;maxJobs?:number}):WorkScheduler;
