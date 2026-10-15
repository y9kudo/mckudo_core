export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface VehicleObservation {entityId:string;name:string|null;position:Position|null;serverConfirmed:true;}
export interface FallLanding {ticks:number;position:Position;support:Position;block:NavigationBlock;height:number;}
export interface PearlEscapePlan {yaw:number;pitch:number;ticks:number;landing:Position;impactBlock:Position;score:number;}
export interface FallRescueDecision {skill:'waterClutch'|'escapePearl';args:Record<string,never>;reason:string;landing?:FallLanding;plan?:PearlEscapePlan;}
export declare function perchedDragonHead(dragon:{position:Position;yaw:number;pitch?:number|null}):Position|null;
export declare function predictFallLanding(state:OMState,getBlock:(position:Position)=>NavigationBlock|null,options?:{maxTicks?:number}):FallLanding|null;
export declare function planPearlEscape(state:OMState,getBlock:(position:Position)=>NavigationBlock|null,options?:{endermen?:unknown[];maxTicks?:number}):PearlEscapePlan|null;
export declare function decideFallRescue(state:OMState,getBlock:(position:Position)=>NavigationBlock|null,inventory:{water_bucket?:number;ender_pearl?:number},options?:{highestY?:number;endermen?:unknown[]}):FallRescueDecision|null;
export interface MenuSlot {slot:number;item:string|null;count:number;name:string;lore:string[];}
export interface MenuObservation {windowId:number;type:number;kind:string;title:string;revision:number;stateId:number|null;ready:boolean;slots:MenuSlot[];}
export declare function observeMenu(containers:OMContainers):MenuObservation|null;
export declare function menuText(input:unknown):string;
export declare function findMenuSlot(menu:MenuObservation,selector:{item?:string;name?:string;contains?:string;slot?:number}):MenuSlot & {windowId:number;revision:number};
export interface SwimRouteOptions {start:Position;goal:Position;getBlock:(p:Position)=>NavigationBlock|null;signal?:AbortSignal;maxNodes?:number;maxDistance?:number;airTicks?:number;airReserveTicks?:number;ticksPerBlock?:number;waterBreathing?:boolean;}
export interface SwimRouteResult {status:'planned'|'blocked';reason:string;mode?:'swim';waypoints:Position[];visited:number;cost?:number;airRemainingTicks?:number;}
export interface VolumeResult {clear:boolean;reason:string;position?:Position;water?:boolean;submerged?:boolean;fraction?:number;submergedSamples?:number;samples?:number;}
export declare const OMVECTORIZE:Readonly<{name:'OMVectorize';author:'y9kudo';version:string;versionName:'Version Arthas';displayVersion:'v1.0.0Arthas-beta1';modes:readonly string[];predictions:readonly string[]}>;
export declare function volumeClearance(options:{position:Position;getBlock:SwimRouteOptions['getBlock'];height?:number;radius?:number}):VolumeResult;
export declare function traceVolume(options:{from:Position;to:Position;getBlock:SwimRouteOptions['getBlock'];height?:number;radius?:number}):VolumeResult;
export declare function planSwimRoute(options:SwimRouteOptions):SwimRouteResult;
export declare function planSwimRouteAsync(options:SwimRouteOptions,scheduling?:{nodesPerSlice?:number;sliceMs?:number;getRevision?:()=>unknown}):Promise<SwimRouteResult>;
export interface ElytraPrediction {position:Position;velocity:Position;yaw:number;pitch:number;}
export declare function predictElytraTick(options:ElytraPrediction & {rocket?:boolean}):ElytraPrediction;
export interface FlightPlanOptions {start:Position;goal:Position;getBlock:SwimRouteOptions['getBlock'];cruiseHeight?:number;maxDistance?:number;}
export interface FlightPlan {status:'planned'|'blocked';reason?:string;position?:Position;mode?:'elytra';landing?:Position;altitude?:number;waypoints?:Position[];}
export declare function planElytraFlight(options:FlightPlanOptions):FlightPlan;
export declare function elytraControl(options:{position:Position;velocity:Position;landing:Position;altitude:number;boosting?:boolean}):{yaw:number;pitch:number;phase:'climb'|'cruise'|'approach'|'flare';remaining:number};
export interface FlyOptions {position:Position;cruiseHeight?:number;maxDistance?:number;timeoutMs?:number;maxRockets?:number;}
export interface FlightResult {ok:true;serverConfirmed:true;start:Position;position:Position;landing:Position;landingError:number;maxY:number;travelled:number;rocketsUsed:number;takeoffs:number;attachedRockets:number;healthBefore:number;healthAfter:number;corrections:number;}
export interface SignObservation {position:Position;front:string[];back:string[];waxed:boolean;revision:number;}
export interface SignSearch {text?:string;radius?:number;position?:Position;}
export declare function findSigns(world:OMWorld,options?:SignSearch):SignObservation[];
export declare function readSign(world:OMWorld,position:Position):SignObservation|null;
export interface StorageTransferOptions extends Position {items?:string[];amounts?:Record<string,number>;all?:boolean;maxStacks?:number;}
export declare class OMVectorize {
  planGround(options:Omit<Parameters<typeof planRoute>[0],'getBlock'>&{getBlock?:Parameters<typeof planRoute>[0]['getBlock']}):RoutePlan;
  planGroundAsync(options:Omit<Parameters<typeof planRoute>[0],'getBlock'>&{getBlock?:Parameters<typeof planRoute>[0]['getBlock']},scheduling?:RouteScheduling):Promise<RoutePlan>;
  planSwim(options:Omit<SwimRouteOptions,'getBlock'>):SwimRouteResult;
  planSwimAsync(options:Omit<SwimRouteOptions,'getBlock'>):Promise<SwimRouteResult>;
  constructor(options:{getBlock:SwimRouteOptions['getBlock'];getRevision?:()=>unknown;groundBackend?:GroundNavigationBackend|null});
  plan(options:Omit<SwimRouteOptions,'getBlock'>):SwimRouteResult;
  planAsync(options:Omit<SwimRouteOptions,'getBlock'>):Promise<SwimRouteResult>;
  clearance(position:Position):VolumeResult;
  planFlight(options:Omit<FlightPlanOptions,'getBlock'>):FlightPlan;
}
export interface Action { skill: string; args?: Record<string, Json>; }
export interface Position { x: number; y: number; z: number; }
export type ActionFailureCode = 'START_UNSUPPORTED'|'NO_PATH'|'SEARCH_BUDGET'|'STALE_WORLD'|'STEP_STALLED'|'OCCUPIED'|'SERVER_CORRECTION'|'SUPPORT_CHANGED'|'ACTION_FAILED';
export interface ActionFailure {code:ActionFailureCode;evidence?:{complete:boolean;facts:Record<string,string|number|boolean|null>};}
export declare const ACTION_FAILURE_CODES:readonly ActionFailureCode[];
export declare class OMActionError extends Error {readonly code:ActionFailureCode;readonly evidence?:ActionFailure['evidence'];constructor(code:ActionFailureCode,message:string,evidence?:ActionFailure['evidence']);}
export declare function blockEvidenceValue(block:NavigationBlock|null):string|null;
export interface NavigationBlock { name?: string; id?: string; boundingBox?: string; shapes?: number[][]; diggable?: boolean; getProperties?(): Record<string, unknown>; }
export declare function traceVisibility(options:{origin:Position;target:Position;getBlock:(position:Position)=>NavigationBlock|null;maxDistance?:number}):{visible:boolean;reason:'clear'|'blocked'|'unloaded'|'too-far';position:Position|null};
export interface ProtectedRegion {id:string;dimension:string;min:Position;max:Position;}
export interface ProtectionOptions {regions?:ProtectedRegion[];structures?:boolean;structureRadius?:number;}
export interface EditDecision {allowed:boolean;reason:string;regionId?:string;evidence?:Position;}
export interface PlacementOwnershipMemory {schemaVersion:1;owned:{key:string;name:string;stateId?:number}[];}
export declare function isStructureBlock(block:NavigationBlock|null):boolean;
export declare class OMProtection {
  constructor(options?:ProtectionOptions);
  readonly revision:number;
  readonly regions:ProtectedRegion[];
  add(region:ProtectedRegion):ProtectedRegion;
  remove(id:string):boolean;
  remember(dimension:string,position:Position,block:NavigationBlock & {stateId?:number}):void;
  forget(dimension:string,position:Position):void;
  observeBlockChange(dimension:string,position:Position,previous:(NavigationBlock & {stateId?:number;getProperties?():Record<string,unknown>})|null,current:(NavigationBlock & {stateId?:number;getProperties?():Record<string,unknown>})|null):void;
  exportMemory():PlacementOwnershipMemory;
  restoreMemory(memory:PlacementOwnershipMemory):void;
  check(options:{operation:'dig'|'place';dimension:string;position:Position;block?:NavigationBlock|null;getBlock?:(position:Position)=>NavigationBlock|null}):EditDecision;
}
export interface AuthCode {user_code:string;verification_uri:string;expires_in:number;}
export interface AuthenticationState {mode:'offline'|'microsoft';status:'offline'|'pending'|'device-code'|'authenticated';profile:{name:string;uuid:string}|null;}
export interface OMOptions { host?: string; port?: number; username?: string; version?: string; auth?: 'offline'|'microsoft'; profilesFolder?:string;authTimeoutMs?:number;onMsaCode?:(code:AuthCode)=>void;realms?:{realmId:number}; viewDistance?: number; humanizeMode?:boolean; connectTimeoutMs?: number; fallSafety?:boolean; maxDrop?: number; fallHealthReserve?: number; maxFallDamage?: number; bridgeReserve?: number; bridgeItemValue?: (name: string,item: OMItem) => number; protection?:ProtectionOptions; }
export interface OMState { status: 'disconnected' | 'connecting' | 'ready' | 'dead'; entityId: number | null; position: Position | null; velocity: Position; yaw: number; pitch: number; onGround: boolean; health: number | null; food: number | null; dimension: string | null; gameMode: string | number | null; allowFlying?:boolean; creativeFlying?:boolean; flyingSpeed?:number; environment?: Environment; sleeping?: boolean; sprinting?: boolean; sneaking?:boolean; frozen?: boolean; horizontalCollision?: boolean; shield?:boolean;shieldAvailable?:boolean;shieldDisabled?:boolean; }
export interface OMMetrics { packetsSent: number; corrections: number; actions: number; failures: number; maxTickMs: number; timing?: TickTimingSnapshot; navigation?: WorkSchedulerSnapshot; decoderWarnings: { message: string; at: number }[]; reactions: unknown[]; }
export interface OMItem { name: string; item: string; type: number; count: number; slot: number; raw: any; }
export interface OMTime { timeOfDay:number|null; isDay:boolean|null; age:number|null; }
export interface EyeFlight {entityId:string;dimension:string;launched:Position;origin:Position;end:Position;samples:number;at:number;}
export interface EndEvidence {eyes:EyeFlight[];crystals:{entityId:string;position:Position;confirmed:true;evidence:'explosion-and-removal';at:number}[];ownDragonHits?:number;dragonDeath?:{entityId:string;confirmed:true;evidence:'entity-death-status'|'health-zero-and-dying-phase';ownDamageConfirmed:boolean;ownHitCount:number;at:number};}
export interface PillarArgs {count?:number;block?:string;}
export interface PillarResult {ok:true;serverConfirmed:true;placed:(Position & {block:string})[];position:Position;}
export interface OMSnapshot extends OMState { authentication:AuthenticationState; time:OMTime; equipment:ReturnType<OMInventory["equipment"]>; identity: typeof OMCONNECT; inventory: Record<string, number>; loadedChunks: number; metrics: OMMetrics; }
export declare const OMCONNECT: Readonly<{ name: 'OMConnect'; version: '1.0.0-Arthas-beta1'; versionName: 'Version Arthas'; displayVersion: 'v1.0.0Arthas-beta1'; author: 'y9kudo'; apiVersion: 1; minecraftVersions: readonly string[]; authentication: readonly string[] }>;
export declare const OM_SKILLS: readonly string[];
export interface FallPolicy { health?:number; minHealthAfter?:number; maxDamage?:number; slowFalling?:boolean; sneaking?:boolean; }
export interface FallAssessment { height:number; landing:string|null; estimatedDamage:number|null; healthAfter:number|null; survivable:boolean; allowed:boolean; reason:string; }
export declare function assessFall(options:FallPolicy & {height:number;landing:NavigationBlock|null}):FallAssessment;
export interface RouteStep {kind:'dig'|'bridge'|'walk'|'jump'|'drop';position:Position;block?:string;expected?:string;fall?:FallAssessment;}
export interface RoutePlan {status:'planned'|'blocked';reason:string;steps:RouteStep[];visited:number;unknown:Position[];cost?:number;bridgeUsed?:number;fallDamage?:number;partial?:boolean;target?:Position;failure?:ActionFailure;}
export declare function planRoute(options:{start:Position;goal:Position;getBlock:(position:Position)=>NavigationBlock|null;occupied?:(position:Position)=>boolean;edgeCost?:(from:Position,to:Position,kind:RouteStep["kind"])=>number;range?:number;maxNodes?:number;maxDistance?:number;maxDrop?:number;fallPolicy?:FallPolicy;bridgeBudget?:number;bridgeBlock?:string;canDig?:(block:NavigationBlock,position:Position)=>boolean;canPlace?:(position:Position)=>boolean;allowPartial?:boolean;signal?:AbortSignal}):RoutePlan;
export interface RouteScheduling {sliceMs?:number;nodesPerSlice?:number;getRevision?:()=>unknown;scheduler?:WorkScheduler;}
export interface GroundNavigationBackend {planGroundAsync(options:Parameters<typeof planRoute>[0]&{staticGeometry?:boolean},scheduling?:RouteScheduling):Promise<RoutePlan>;}
export declare function planRouteAsync(options: Parameters<typeof planRoute>[0], scheduling?: RouteScheduling): Promise<RoutePlan>;
export interface OMVersionProfile {version:string;experimental?:boolean;loadRegistry:(version:string)=>any;createProtocolClient:(options:Record<string,unknown>)=>any;worldOptions?:{chunkFactory?:(registry:any)=>any;blockFactory?:(registry:any)=>any};normalizeIncoming?:(name:string,packet:any,client:OMConnect)=>void;encodePacket?:(name:string,packet:any,client:OMConnect)=>{name?:string;packet?:any;skip?:boolean};install?:(client:OMConnect,transport:any)=>void;readRecipes?:(client:OMConnect,packet:any)=>void;afterTick?:(client:OMConnect)=>void;}
export declare function createJava263Profile(options:{loadRegistry:OMVersionProfile['loadRegistry'];createProtocolClient:OMVersionProfile['createProtocolClient'];chunkFactory:(registry:any)=>any;blockFactory?:(registry:any)=>any}):OMVersionProfile;
export declare function createVanillaCompatibilityProfile(version:string):OMVersionProfile;
export declare class OMConnect {
  constructor(options?: OMOptions, components?: { createProtocolClient?: (options: Record<string, unknown>) => any; physics?: typeof stepPhysics;versionProfile?:OMVersionProfile;navigationBackend?:GroundNavigationBackend|null });
  readonly options: Required<OMOptions>;
  readonly registry: any;
  readonly dataLoaded: boolean;
  readonly recipeBook: WorldRecipeBook;
  readonly world: OMWorld;
  readonly inventory: OMInventory;
  readonly players: OMPlayers;
  readonly containers: OMContainers;
  readonly protection: OMProtection;
  readonly vectorize: OMVectorize;
  readonly authentication:AuthenticationState;
  menu():MenuObservation|null;
  vehicle():VehicleObservation|null;
  watchPlayer(username: string, options?: AttentionOptions): AttentionLease;
  findStorages(options?: StorageSearchOptions): Promise<StorageSearchResult>;
  findSigns(options?:SignSearch):SignObservation[];
  signAt(position:Position):SignObservation|null;
  readonly state: OMState;
  readonly aimDebug?: {target:string;stage:string;velocity:Position;confidence:number;ageMs:number;yaw:number;pitch:number;angularError:number;tolerance:number;flightTicks:number;predicted:Position;at:number};
  readonly shieldDebug?: {target:string;anticipating:boolean;impactTicks:number;raisedAt:number;estimatedActiveAt:number;at:number};
  readonly time: OMTime;
  readonly endgame: EndEvidence;
  readonly metrics: OMMetrics;
  readonly trace: ActionTrace[];
  on(event: string, listener: (...args: any[]) => void): this;
  once(event: string, listener: (...args: any[]) => void): this;
  removeListener(event: string, listener: (...args: any[]) => void): this;
  connect(): Promise<this>;
  respawn(options?: {signal?: AbortSignal;timeoutMs?: number}): Promise<OMSnapshot>;
  lookAt(position: Position,options?: {signal?: AbortSignal;turnSpeed?: number;immediate?: boolean}): void;
  waitForLook(options?: {signal?: AbortSignal;timeoutMs?: number}): Promise<void>;
  cancelLook(): void;
  describe(): { contract: 'omconnect.agent'; version: 1; minecraftVersion: string; skills: string[] };
  observe(): AgentObservation;
  subscribeUrgent(listener: (event: { type: 'damage'; entityId: string }) => void): () => void;
  registerSkill(name: string, handler: (args: Record<string, Json>, context: { client: OMConnect; signal: AbortSignal }) => unknown | Promise<unknown>): this;
  execute(action: Action, options?: { signal?: AbortSignal; priority?: number }): Promise<any>;
  setCreativeFlying(enabled:boolean):void;
  snapshot(): OMSnapshot;
  close(): Promise<void>;
}
export declare function createOMConnect(options?: OMOptions,components?:ConstructorParameters<typeof OMConnect>[1]): OMConnect;
export interface FoundBlock { name: string; position: Position; stateId: number; distance: number; properties: Record<string, unknown>; }
export declare class OMWorld {
  constructor(registry: any, options?: { maxChunks?: number;chunkFactory?:(registry:any)=>any;blockFactory?:(registry:any)=>any });
  readonly columns: Map<string, unknown>;
  readonly blockEntities:Map<string,{position:Position;nbt:unknown;revision:number}>;
  setBlockEntity(position:Position,nbt:unknown):void;
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
export declare class OMInventory {
  constructor(registry: any);
  readonly slots: (OMItem | null)[];
  readonly revision: number;
  readonly stateId: number;
  readonly selected: number;
  items(): OMItem[];
  count(name: string): number;
  ownedCount(name: string): number;
  equipment(): Record<'head'|'chest'|'legs'|'feet', OMItem|null>;
  held(): OMItem | null;
  snapshot(): Record<string, number>;
}
export interface Environment { medium: 'air' | 'water' | 'lava'; contacts: string[]; support: string; flow: Position; unknown: boolean; hazardous: boolean; slipperiness: number; }
export interface PhysicsState { position: Position; velocity: Position; onGround: boolean; horizontalCollision?: boolean; frozen?: boolean; environment?: Environment; sneaking?:boolean; }
export declare function stepPhysics(state: PhysicsState, control: { x?: number; z?: number; jump?: boolean; sneak?: boolean; sprint?: boolean; usingItem?: boolean }, getBlock: (p: Position) => NavigationBlock | null): PhysicsState;
export declare function environmentAt(position: Position, getBlock: (p: Position) => NavigationBlock | null): Environment;
export declare function fluidAt(block: NavigationBlock | null): { kind: 'water' | 'lava'; height: number; level: number; falling: boolean } | null;
export declare function miningTime(registry: any, block: any, item: { type: number } | null, options?: { onGround?: boolean }): { milliseconds: number; harvestable: boolean };
export interface ActionTrace { at: number; skill: string; priority: number; outcome: 'success' | 'failure' | 'cancelled'; detail: string; durationMs: number; }
export interface AgentObservation { endgame:{eyes:EyeFlight[]}; time:OMTime; equipment:ReturnType<OMInventory['equipment']>; contract: 'omconnect.agent'; version: 1; minecraftVersion: string; self: OMState; inventory: Record<string, number>; entities: { id: string; name: string; kind: string; position: Position; velocity: Position; blocking:boolean; yaw:number|null;pitch:number|null;health: number | null;phase?:number|null;woolColor?:number|null;sheared?:boolean|null;isBaby?:boolean;named?:boolean;provoked?:boolean }[]; world: { dimension: string | null; revision: number; loadedChunks: number }; combat: { attackers: any[] }; drops: { id: string; item: string; count: number; position: Position }[]; }
export interface PeerEnvelope { protocol: 1; team: string; from: string; to: string | null; sequence: number; topic: string; payload: Json; expiresAt: number; }
export interface PeerClaim { resource: string; bid: number; release: boolean; from: string; sequence: number; expiresAt: number; observedAt: number; }
export declare class OMPeer {
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
export interface Fleet { agents: Map<string, OMConnect>; peers: Map<string, OMPeer>; connect(): Promise<this>; snapshot(): Record<string, { agent: OMSnapshot; peer: ReturnType<OMPeer['snapshot']> }>; close(): Promise<void>; }
export declare const DEFAULT_AGENT_NAMES: readonly string[];
export declare function createFleet(options?: { count?: number; names?: string[]; connection?: OMOptions; team?: string; settleMs?: number; createClient?: (options: OMOptions) => OMConnect }): Fleet;
export interface ProjectileProfile { weapon: 'bow' | 'crossbow' | 'trident'; speed: number; gravity: number; drag: number; waterDrag: number; }
export declare function projectileProfile(weapon?: 'bow' | 'crossbow' | 'trident', chargeTicks?: number): ProjectileProfile;
export type ProjectileTrace = { status: 'clear'; path: Position[]; position: Position; ticks: number } | { status: 'blocked'; path: Position[]; ticks: number; collision: { t: number; cell: Position; reason: string } };
export declare function traceProjectile(options: { origin: Position; velocity: Position; profile?: ProjectileProfile; ticks?: number; getBlock: (p: Position) => NavigationBlock | null }): ProjectileTrace;
export type AimSolution = { status: 'aimed'; yaw: number; pitch: number; ticks: number; predicted: Position; error: number; velocity: Position; path: Position[]; hitConfirmed: false } | { status: 'blocked'; reason: string; hitConfirmed: false };
export declare function solveAim(options: { origin: Position; target: Position; targetVelocity?: Position; inheritedVelocity?: Position; predictTarget?: (ticks:number)=>Position; weapon?: 'bow' | 'crossbow' | 'trident'; chargeTicks?: number; maxTicks?: number; radius?: number; getBlock: (p: Position) => NavigationBlock | null }): AimSolution;
export interface PlayerObservation { uuid: string; username: string | null; listed: boolean | null; latency: number | null; gameMode: number | null; entityId: string | null; observed: boolean; position: Position | null; yaw: number | null; headYaw: number | null; pitch: number | null; managedAgent: boolean; }
export interface PlayerEntity { id: string; uuid: string; kind: 'player'; username: string; position: Position; velocity: Position; yaw: number; headYaw: number; pitch: number; eyeHeight: number; }
export declare class OMPlayers {
  constructor(client: OMConnect);
  entity(usernameOrUuid: string): PlayerEntity | null;
  snapshot(): PlayerObservation[];
}
export interface AttentionOptions { durationMs?: number; maxDistance?: number; priority?: number; turnSpeed?: number; }
export interface AttentionLease { stop(): boolean; snapshot(): { id: number; username: string; uuid: string | null; expiresAt: number; maxDistance: number; priority: number; turnSpeed: number; active: boolean }; }
export interface GazeSubject { position: Position; yaw?: number; headYaw?: number; pitch?: number; eyeHeight?: number; }
export declare function gazeAngles(from: Position, to: Position): { yaw: number; pitch: number };
export declare function gazeError(observer: GazeSubject, target: GazeSubject): number | null;
export interface StorageObservation { dimension: string; position: Position; observedAt: number; contents: { item: string; count: number }[]; }
export declare class OMContainers {
  constructor(inventory: OMInventory, registry: any);
  readonly observations: Map<string, StorageObservation>;
  contents(): OMItem[];
  capacity(item: OMItem): number;
}
export declare function chooseMiningTool(registry: any, block: any, items: OMItem[], options?: { held?: OMItem | null; onGround?: boolean; preservePickaxeTier?: 1|2|3|4 }): { item: OMItem | null; milliseconds: number; harvestable: boolean } | null;
export interface AgentObservation { players: PlayerObservation[]; attention: { status: string; target: string | null; entityId?: string; errorDegrees?: number }; storage: StorageObservation[]; }
export interface StorageIdentity { key: string; kind: string; positions: Position[]; }
export interface StorageSearchOptions { radius?: number; count?: number; signal?: AbortSignal; }
export interface StorageSearchResult { storages: (FoundBlock & StorageIdentity)[]; visited: number; truncated: boolean; revision: number; }
export declare function isStorageBlock(name: string): boolean;
export declare function storageIdentity(world: Pick<OMWorld,'blockAt'>, position: Position): StorageIdentity | null;
export declare function findStorages(client: OMConnect, options?: StorageSearchOptions): Promise<StorageSearchResult>;
export interface CraftRecipe { item:string;count:number;width?:number;height?:number;table:boolean;cells:{x:number;y:number;choices:string[]}[]; }
export declare function craftingRecipes(registry:any,item:string,book?:WorldRecipeBook):CraftRecipe[];
export declare function chooseCraftingRecipe(registry:any,item:string,inventory:Record<string,number>,options?:{ingredients?:Record<string,number>;recipeBook?:WorldRecipeBook}):(Omit<CraftRecipe,'cells'>&{cells:{x:number;y:number;item:string}[]})|null;
export declare function smeltingRecipe(registry:any,item:string):{item:string;inputs:string[];ticks:number}|null;
export declare function fuelItems(item:string):number;
export declare function rotateToward(state:{yaw:number;pitch:number},angles:{yaw:number;pitch:number},options?:{turnSpeed?:number;dt?:number}):{yaw:number;pitch:number};
export interface MovementControl { x:number;z:number;jump:boolean;sprint:boolean;sneak?:boolean; }
export declare function travelControl(state:OMState&{position:Position},target:Position,getBlock:(p:Position)=>NavigationBlock|null,options?:{sprint?:boolean;sprintJump?:boolean;guarding?:boolean;longDistance?:number;brake?:boolean}):MovementControl;
export declare function combatControl(state:OMState&{position:Position},target:Position,mode:string,getBlock:(p:Position)=>NavigationBlock|null,options?:{guarding?:boolean;strafeSide?:number;spacing?:number}):MovementControl;
export declare function bridgeMaterials(registry:any,items:OMItem[],options?:{blockAtState?:(stateId:number)=>NavigationBlock;itemValue?:(name:string,item:OMItem)=>number;reserve?:number;dimension?:string}):{name:string;block:string;count:number;value:number;slot:number}[];
export interface RecipeBookSnapshot {source:'server'|'waiting'|'version-catalog';revision:number;announced:number;indexedOutputs:number;}
export interface WorldRecipe {id:string;type:string;output:{item:string;count:number};ingredients:{choices:string[];count:number}[];station:string|null;executable:boolean;cells:{x:number;y:number;choices:string[]}[];reason:string;}
export declare class WorldRecipeBook {constructor(registry:any);readonly received:boolean;readonly revision:number;ingest(packet:{recipes:any[]}):void;useVersionCatalog(announced?:number):void;recipesFor(item:string):WorldRecipe[];snapshot():RecipeBookSnapshot;}
export declare const NATIVE_VERSIONS:readonly string[];
export interface VersionSupport {version:string;known:boolean;protocol:number|null;catalog:boolean;transport:boolean;native:boolean;liveTested:boolean;}
export declare function versionSupport(version:string):VersionSupport;
export interface VersionAPI {version:string;support:VersionSupport;loadRegistry:()=>any;hasPacket:(name:string,direction?:'toServer'|'toClient')=>boolean;capabilities:()=>Record<string,boolean>;normalize:(name:string,packet:any)=>any;movement:(state:{position:Position;yaw:number;pitch:number;onGround:boolean;horizontalCollision?:boolean;eyeHeight?:number})=>{name:string;params:any};digging:(options:{position:Position;phase:'start'|'cancel'|'finish';face?:number;sequence?:number})=>{name:'block_dig';params:{status:number;location:Position;face:number;sequence?:number}};createTransport:(options:Record<string,unknown>)=>any}
export declare function createVersionAPI(version:string):VersionAPI;
export declare function normalizeSlot(raw:any):any;
export declare function registerVersionProfile(profile:OMVersionProfile):()=>boolean;
export declare function resolveVersionProfile(version:string):OMVersionProfile|null;
export declare function detectServerVersion(options?:{host?:string;port?:number;timeoutMs?:number}):Promise<{version:string;protocol:number;serverName:string;support:VersionSupport}>;
export declare function listVersionSupport():Pick<VersionSupport,'version'|'native'|'liveTested'|'transport'>[];
export declare const OFFICIAL_VERSION_MANIFEST:'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
export interface OfficialJavaVersion extends VersionSupport {type:'release'|'old_beta'|'old_alpha'|'snapshot';releaseTime:string|null;}
export declare function discoverOfficialJavaVersions(options?:{fetchImpl?:typeof fetch;includeLegacy?:boolean;includeSnapshots?:boolean}):Promise<OfficialJavaVersion[]>;
export declare function inspectOfficialJavaVersion(version:string,options?:{fetchImpl?:typeof fetch}):Promise<{version:string;type:OfficialJavaVersion['type'];releaseTime:string|null;officialServer:boolean;serverDownload:{url:string;sha1:string;size:number|null}|null;support:VersionSupport}>;
export declare function createVanillaCompatibilityProfile(version:string):OMVersionProfile;

export interface TickTimingSnapshot {ticks:number;samples:number;meanIntervalMs:number|null;p95IntervalMs:number|null;maxIntervalMs:number|null;delayedTicks:number;effectiveHz:number|null;}

export interface WorkSchedulerSnapshot {completed:number;failed:number;cancelled:number;turns:number;maxTurnMs:number;pending:number;closed:boolean;budgetMs:number;maxJobs:number;}
export interface WorkScheduler {submit<T>(iterator:Iterator<unknown,T>, options?:{signal?:AbortSignal;sliceMs?:number;nodesPerSlice?:number;validate?:()=>void}):Promise<T>;snapshot():WorkSchedulerSnapshot;close():void;}
export declare function createWorkScheduler(options?:{budgetMs?:number;maxJobs?:number}):WorkScheduler;
