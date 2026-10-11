export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Observation = { [key: string]: Json };
export type Condition = { all: Condition[] } | { any: Condition[] } | { not: Condition } | ({ fact: string } & (
  { eq: string | number | boolean | null } | { ne: string | number | boolean | null } |
  { lt: number } | { lte: number } | { gt: number } | { gte: number } | { exists: boolean }
));
export interface Action { skill: string; args?: Record<string, Json>; }
export interface Rule { id: string; priority?: number; description?: string; when?: Condition; action: Action; }
export interface WorkflowStep { id: string; dependsOn?: string[]; action: Action; until?: Condition; maxAttempts?: number; retryDelayMs?: number; }
export interface Workflow { id: string; priority?: number; description?: string; when?: Condition; steps: WorkflowStep[]; }
export interface Goal { id: string; priority?: number; description?: string; desired: Condition; maxActions?: number; }
export interface AgentConfig { $schema?: string; schemaVersion: 1 | 2 | 3 | 4; name: string; worldId: string; rules?: Rule[]; workflows?: Workflow[]; goals?: Goal[]; tickIntervalMs?: number; actionTimeoutMs?: number; failureBackoffMs?: number; maxHistory?: number; }
export interface Manifest { protocolVersion: 1; perceptionVersion?: 1; kind: string; loader: string; minecraftVersion: string; skills: readonly string[]; }
export interface Context { signal: AbortSignal; priority?: number; }
export interface Adapter { describe(): Manifest; observe(context: Context): Promise<Observation>; observeThreats?(context: Context): Promise<Observation>; subscribeUrgent?(listener: () => void): () => void; execute(action: Action, context: Context): Promise<unknown>; dispose?(): void; }
export interface Result { at: number; rule: string; skill: string; outcome: 'success' | 'failure' | 'cancelled' | 'progress'; detail: string; }
export interface StepState { status: 'pending' | 'running' | 'completed' | 'failed' | 'interrupted'; attempts: number; retryAt: number; error: string; }
export interface WorkflowState { id: string; status: 'pending' | 'active' | 'completed' | 'failed' | 'interrupted'; completed: number; total: number; steps: Record<string, StepState>; }
export interface SavedWorkflow { fingerprint: string; active: boolean; steps: Record<string, StepState>; }
export interface SavedGoal { status: 'pending' | 'active' | 'achieved' | 'blocked' | 'failed' | 'interrupted'; actions: number; reason: string; retryAt: number; inFlight: boolean; }
export interface SavedBrain { fingerprint: string; calls: number; goals: Record<string, SavedGoal>; }
export interface Memory { schemaVersion: 1 | 2 | 3; worldId: string; stats: Record<string, { successes: number; failures: number; streak: number }>; history: Result[]; workflows?: Record<string, SavedWorkflow>; brain?: SavedBrain; }
export interface Decision { id: string; kind: 'rule' | 'workflow' | 'goal' | 'reactor'; workflowId: string | null; stepId: string | null; goalId: string | null; operatorId: string | null; action: Action; priority: number; alternatives: { id: string; blocked: string | null }[]; }
export interface PluginInfo { id: string; apiVersion: 1; requires: readonly string[]; skills: string[]; }
export interface Snapshot { engine: typeof MCKUDO; name: string; worldId: string; status: 'idle' | 'observing' | 'planning' | 'acting' | 'blocked' | 'fault' | 'paused' | 'stopping'; reason: string; paused: boolean; running: boolean; adapter: Manifest; observation: Observation | null; decision: Decision | null; lastResult: Result | null; history: Result[]; workflows: WorkflowState[]; brain: BrainSnapshot | null; trace?: DecisionTrace; plugins: PluginInfo[]; listenerErrors: { event: string; message: string }[]; }
export type SkillHandler = (args: Record<string, Json>, context: Context & { observation: Observation }) => unknown | Promise<unknown>;
export type SkillValidator = (args: Record<string, Json>) => boolean | string | void | Promise<boolean | string | void>;
export interface SkillDefinition { execute: SkillHandler; validate?: SkillValidator; }
export interface Plugin { readonly id: string; readonly apiVersion: 1; readonly requires?: readonly string[]; readonly skills: Readonly<Record<string, SkillHandler | SkillDefinition>>; }
export declare function definePlugin(plugin: Plugin): Plugin;
export declare const MCKUDO: Readonly<{ name: string; id: 'mckudo_core'; version: string; author: 'y9kudo'; protocolVersion: 1 }>;
export declare class ConfigError extends Error { readonly path: string; }
export declare function validateConfig(input: unknown): AgentConfig;
export declare function matches(condition: Condition | undefined, observation: Observation): boolean;
export interface CoreOptions { config: AgentConfig; adapter: Adapter; planning?: PlanningOptions; learning?: ExperienceModel; reactors?: Reactor[]; preemptionMs?: number; memory?: Memory; clock?: () => number; }
export declare class MckudoCore {
  constructor(options: CoreOptions);
  readonly manifest: Manifest;
  registerSkill(name: string, handler: SkillHandler, options?: { validate?: SkillValidator }): this;
  use(plugin: Plugin): this;
  removePlugin(id: string): this;
  resetWorkflow(id: string): this;
  retryStep(workflowId: string, stepId: string): this;
  retryGoal(goalId: string): this;
  tick(): Promise<Snapshot>;
  start(): this;
  pause(): Promise<Snapshot>;
  resume(): this;
  stop(): Promise<void>;
  snapshot(): Snapshot;
  exportMemory(): Memory;
  on(event: 'state', listener: (snapshot: Snapshot) => void): this;
  on(event: 'action:start', listener: (decision: NonNullable<Snapshot['decision']>) => void): this;
  on(event: 'action:finish', listener: (result: Result) => void): this;
  on(event: 'decision:trace', listener: (trace: DecisionTrace) => void): this;
  on(event: 'monitor:error', listener: (error: { message: string }) => void): this;
  once(event: 'state', listener: (snapshot: Snapshot) => void): this;
  once(event: 'action:start', listener: (decision: Decision) => void): this;
  once(event: 'action:finish', listener: (result: Result) => void): this;
  once(event: 'decision:trace', listener: (trace: DecisionTrace) => void): this;
  once(event: 'monitor:error', listener: (error: { message: string }) => void): this;
  removeListener(event: string, listener: (...args: any[]) => void): this;
  removeAllListeners(event?: string): this;
}
export type Effect = { fact: string } & ({ add: number } | { set: string | number | boolean | null });
export interface Operator { id: string; cost?: number; action: Action; requires?: Condition; effects: Effect[]; }
export interface PlannerContext { perceptionVersion: number | null; observation: Observation; goal: Goal; operators: Operator[]; skills: string[]; }
export interface PlanProposal { steps: string[]; reason?: string; }
export interface Planner { id: string; apiVersion: 1; plan(context: PlannerContext, cancellation: Context): PlanProposal | Promise<PlanProposal>; }
export interface PlanningOptions { operators?: Operator[]; experience?: ExperienceModel; planner?: Planner; maxCalls?: number; minIntervalMs?: number; retryDelayMs?: number; }
export interface ExperienceSample { episodeId: string; action: Action; before: Observation; after?: Observation | null; outcome: 'success' | 'progress' | 'failure' | 'cancelled'; durationMs?: number; }
export interface ExperienceAssessment { status: string; blocked: boolean; failures: number; durationMs: number | null; confidence: number; }
export interface ExperienceModel { readonly worldId: string; record(sample: ExperienceSample): boolean; assess(action: Action, observation: Observation): ExperienceAssessment; operators(): Operator[]; snapshot(): { worldId: string; revision: number; hypotheses: Json[]; journal: Json[] }; }
export declare function createExperienceModel(options: { worldId: string; facts: string[]; contextFacts?: string[]; minEvidence?: number; retryMs?: number; clock?: () => number }): ExperienceModel;
export interface AdaptiveStrategy { id: string; when?: Condition; action: Action; resource?: string; }
export interface AdaptivePeer { id: string; clock(): number; claim(resource: string): unknown; release(resource: string): unknown; owner(resource: string): string | null; owns(resource: string): boolean; snapshot(): { claims: { resource: string; from: string; release: boolean; expiresAt: number }[] }; }
export interface AdaptiveScenario { reactor: Reactor; snapshot(): { status: string; revision: number; current: string | null; desired: Condition; journal: Json[] }; dispose(): void; }
export declare function createAdaptiveScenario(options: { id?: string; desired: Condition; strategies: AdaptiveStrategy[]; model?: ExperienceModel; priority?: number; peer?: AdaptivePeer }): AdaptiveScenario;
export interface BrainSnapshot { planner: string; calls: number; maxCalls: number; goals: (SavedGoal & { id: string; priority: number })[]; plan: { goalId: string; steps: string[]; reason: string } | null; }
export interface ConditionExplanation { matched: boolean; facts: { fact: string; found: boolean; value: Json; operator: string; expected: Json; matched: boolean }[]; }
export interface DecisionTrace { tick: number; at: number; rules: (ConditionExplanation & { id: string; priority: number })[]; candidates: { id: string; kind: string; priority: number; blocked: string | null }[]; selected: { id: string; kind: string; operatorId: string | null } | null; deferred?: string; }
export declare function createSymbolicPlanner(options?: { maxDepth?: number; maxNodes?: number }): Planner;
export declare function validateOperators(input: unknown): Operator[];
export declare function validatePlan(proposal: unknown, context: PlannerContext): PlanProposal;
export declare function buildPlannerContext(input: { observation: Observation; goal: Goal; operators: Operator[]; skills: string[] }): PlannerContext;
export declare function normalizeObservation(input: unknown): Observation;
export declare function explainCondition(condition: Condition | undefined, observation: Observation): ConditionExplanation;
export declare function createCore(options: CoreOptions): MckudoCore;
export interface RuntimeSnapshot { paused: boolean; concurrency: number; agents: Record<string, Snapshot>; }
export declare class MckudoRuntime {
  constructor(options?: { concurrency?: number });
  add(name: string, core: MckudoCore, options?: { resourceKey?: string }): this;
  remove(name: string): MckudoCore;
  snapshot(): RuntimeSnapshot;
  tick(): Promise<RuntimeSnapshot>;
  pause(): Promise<RuntimeSnapshot>;
  resume(): this;
  stop(): Promise<void>;
}

export type Reaction = { action: null; reason: string } | { action: Action; priority: number; reason: string };
export interface Reactor { id: string; apiVersion: 1; preempt?: boolean; failureScope?: 'reactor' | 'action'; react(observation: Observation): Reaction; }
export interface Position { x: number; y: number; z: number; }
export interface CatalogItem { id: string; numericId?: number; displayName?: string; stackSize?: number; maxDurability?: number | null; }
export interface CatalogBlock { id: string; numericId?: number; displayName?: string; hardness?: number | null; diggable?: boolean; boundingBox?: string | null; drops?: string[]; harvestTools?: string[]; states?: Json[]; }
export interface Recipe { id: string; type: string; output: { item: string; count: number } | null; ingredients: { choices: string[]; count: number }[]; station: string | null; executable: boolean; reason: string; cookingTime?: number; raw?: Json; }
export interface CatalogSummary { version: string; items: number; blocks: number; recipes: number; executableRecipes: number; types: Record<string, number>; }
export interface Catalog { readonly version: string; item(id: string): CatalogItem | null; block(id: string): CatalogBlock | null; recipe(id: string): Recipe | null; recipesFor(item: string): Recipe[]; items(): CatalogItem[]; blocks(): CatalogBlock[]; recipes(): Recipe[]; summary(): CatalogSummary; }
export type DataTags = Record<string, (string | { id: string; required?: boolean })[] | { values: (string | { id: string; required?: boolean })[] }>;
export interface JavaData { recipes: Record<string, Json>; tags: DataTags; blockTags: DataTags; }
export declare function readJavaDataArchive(path: string | URL): Promise<JavaData>;
export declare function importVanillaRecipes(input: Record<string, Json>, tags?: DataTags): Recipe[];
export declare function createCatalog(input: { version: string; items: CatalogItem[]; blocks: CatalogBlock[]; recipes?: Recipe[] }): Catalog;
export declare function catalogFromMinecraftData(data: any, options?: { vanillaRecipes?: Record<string, Json>; tags?: DataTags; recipeBook?: import("./kudoconnect/index.js").WorldRecipeBook }): Catalog;
export interface BlockTaxonomy { classes(): string[]; classesOf(id: string): string[]; has(id: string, className: string): boolean; members(className: string): string[]; select(query?: { all?: string[]; any?: string[]; none?: string[] }): string[]; }
export declare function createBlockTaxonomy(catalog: Catalog, options?: { classes?: Record<string, { members?: string[]; parents?: string[] }>; tags?: DataTags }): BlockTaxonomy;
export interface ResourceSource { item: string; block: string; tools?: string[]; distance?: number; }
export declare function resourceSources(catalog: Catalog, options: { availableBlocks: string[]; taxonomy?: BlockTaxonomy }): ResourceSource[];
export interface ResourceOptions { catalog: Catalog; targets: Record<string, number>; inventory?: Record<string, number>; sources?: ResourceSource[]; stations?: Record<string, true | Position>; fuel?: { item: string; itemsPerFuel: number }; maxDepth?: number; maxNodes?: number; maxActions?: number; }
export interface ResourcePlan { status: 'planned' | 'blocked'; reason: string; actions: { action: Action; until?: Condition }[]; visited: number; inventoryAfter?: Record<string, number>; stations?: string[]; resolvedTargets?: Record<string, number>; alternativesTried?: number; }
export declare function planResources(options: ResourceOptions): ResourcePlan;
export declare function planResourceClasses(options: ResourceOptions & { taxonomy?: BlockTaxonomy; maxAlternatives?: number }): ResourcePlan;
export declare function resourceWorkflow(id: string, plan: ResourcePlan, options?: { priority?: number }): Workflow;
export interface Blueprint { schemaVersion: 1; id?: string; origin?: Position; size?: { width: number; depth: number; height: number }; cells: (Position & { block: string })[]; air?: Position[]; dependent?: (Position & { block: string })[]; }
export interface ShelterBlueprint extends Blueprint { id: string; origin: Position; size: { width: number; depth: number; height: number }; air: Position[]; dependent: (Position & { block: string })[]; }
export declare function blockKey(position: Position): string;
export declare function createShelterBlueprint(options?: { origin?: Position; width?: number; depth?: number; height?: number; material?: string; door?: string }): ShelterBlueprint;
export declare function validateBlueprint(blueprint: unknown): Blueprint;
export declare function billOfMaterials(blueprint: Blueprint): Record<string, number>;
export interface ConstructionPlan { status: 'blocked' | 'needs-materials' | 'ready' | 'completed'; reason?: string; actions: Action[]; shortages?: Record<string, number>; materials?: Record<string, number>; unknown?: string[]; conflicts?: { position: string; expected: string; actual: string }[]; }
export declare function planConstruction(blueprint: Blueprint, observation: { blocks: Record<string, string | null>; inventory?: Record<string, number> }): ConstructionPlan;
export declare function createConstructionReactor(options: { blueprint: Blueprint; priority?: number }): Reactor;
export interface SurvivalStage { id: string; description?: string; desired: Condition; }
export declare function survivalStages(): SurvivalStage[];
export declare function createSurvivalProgression(options?: { stages?: SurvivalStage[]; completed?: string[] }): { update(observation: Observation): { completed: string[]; current: SurvivalStage | null; status: 'progressing' | 'completed' }; exportMemory(): { completed: string[] }; };
export declare function createDefenseReactor(options?: { attackPlayers?: boolean; retaliationHits?: number; retaliationWindowMs?: number; retreatHealth?: number; dangerRadius?: number; maxChaseDistance?: number; trustedPlayers?: string[]; clock?: () => number }): Reactor;
export declare function createFoodReactor(options?: { catalog?: Catalog; foodThreshold?: number; allowHunting?: boolean; huntRadius?: number; replant?: boolean }): Reactor;
export interface NavigationBlock { name?: string; id?: string; boundingBox?: string; shapes?: number[][]; diggable?: boolean; hardness?: number | null; }
export interface RouteStep { kind: 'dig' | 'bridge' | 'walk' | 'jump' | 'drop'; position: Position; fall?: import('./kudoconnect/index.js').FallAssessment; block?: string; expected?: string; }
export interface RoutePlan { status: 'planned' | 'blocked'; reason: string; steps: RouteStep[]; visited: number; cost?: number; fallDamage?: number; bridgeUsed?: number; unknown: Position[]; partial?:boolean; target?:Position; }
export declare function planRoute(options: { start: Position; goal: Position; getBlock(position: Position): NavigationBlock | null; occupied?(position:Position):boolean; edgeCost?(from:Position,to:Position,kind:RouteStep["kind"]):number; range?: number; maxNodes?: number; maxDistance?: number; maxDrop?: number; fallPolicy?: import('./kudoconnect/index.js').FallPolicy; bridgeBudget?: number; bridgeBlock?: string; canDig?(block: NavigationBlock, position: Position): boolean; canPlace?(position:Position):boolean; allowPartial?:boolean; signal?: AbortSignal }): RoutePlan;
export declare function planRouteAsync(options: Parameters<typeof planRoute>[0], scheduling?: import('./kudoconnect/index.js').RouteScheduling): Promise<RoutePlan>;
export interface ExplorationOptions { getBlock(position: Position): NavigationBlock | null; mode?: 'surface' | 'ores'; radius?: number; maxCandidates?: number; maxNodes?: number; }
export interface ExplorationPlan { status: 'planned' | 'blocked'; reason: string; target: Position | null; route?: RoutePlan; attempts: number; }
export declare function planExploration(options: ExplorationOptions & { position: Position; visited?: Position[];candidateCost?:(target:Position)=>number }): ExplorationPlan;
export interface CpuPoolSnapshot {completed:number;failed:number;cancelled:number;restarts:number;pending:number;threads:number;workers:number;maxQueue:number;memoryMb:number;timeoutMs:number;closed:boolean;}
export interface CpuExplorationJob {type:'exploration';voxels:{min:Position;size:Position;ids:Uint16Array;palette:(NavigationBlock|null)[]};options:Omit<ExplorationOptions,'getBlock'> & {position:Position;visited?:Position[]};costs:[string,number][];}
export interface CpuPool {run(input:CpuExplorationJob,options?:{signal?:AbortSignal}):Promise<ExplorationPlan>;snapshot():CpuPoolSnapshot;close():Promise<void>;}
export declare function createCpuPool(options?:{workers?:number;maxQueue?:number;memoryMb?:number;timeoutMs?:number}):CpuPool;
export interface ExplorationPlanner {poll(options:Omit<ExplorationOptions,'getBlock'> & {position:Position;visited?:Position[];candidateCost?:(target:Position)=>number;context?:string}):ExplorationPlan|{status:'pending'|'blocked';reason:string};invalidate():void;close():void;snapshot():{requested:number;completed:number;stale:number;failed:number;pending:boolean;cpu:CpuPoolSnapshot|null};}
export declare function createExplorationPlanner(options:{world:{dimension?:string;revision?:number;blockAt:ExplorationOptions['getBlock'];createReadView?():{blockAt:ExplorationOptions['getBlock'];isCurrent():boolean}};pool?:CpuPool;onReady?:()=>void;clock?:()=>number}):ExplorationPlanner;
export declare function createResourceReactor(options: { catalog: Catalog; targets: Record<string, number>; taxonomy?: BlockTaxonomy; stations?: Record<string, true | Position>; priority?: number; exploration?: ExplorationOptions; maxNodes?: number }): Reactor;

export interface Weapon { name?: string; item?: string; [key: string]: unknown; }
export declare function weaponProfile(name?: string): { damage: number; cooldownMs: number; kind: 'sword' | 'axe' | 'hand' };
export declare function chooseWeapon<T extends Weapon>(items: T[], options?: { shieldedTarget?: boolean; avoidSweep?:boolean }): T | null;
export interface CombatEntity { position: Position; name?: string; ranged?: boolean; charging?: boolean; blocking?: boolean; velocity?: Position | null; equipment?:Record<number,{name?:string}>; }
export declare function combatDecision(input: { self: { position: Position; health: number | null; shield?: boolean;shieldDisabledUntil?:number;onGround?:boolean;velocity?:Position;sprinting?:boolean }; target: CombatEntity; projectiles?: CombatEntity[]; nextAttackAt?: number; now?: number; retreatHealth?: number;criticalPending?:boolean;canCriticalJump?:boolean }): { mode: 'stop' | 'retreat' | 'block' | 'approach' | 'strike' | 'strafe' | 'jump' | 'wait'; reason: string;critical?:boolean };
export declare function createCombatReactor(options?: NonNullable<Parameters<typeof createDefenseReactor>[0]> & { ignoredEntities?: string[];pathRetreat?:boolean }): Reactor & {recordResult(result:{outcome:string},action?:Action):void;attach(core:MckudoCore):()=>void};
export declare function createEndSafetyReactor(): Reactor;
export interface NetherPortalBlueprint extends Blueprint { id: string; origin: Position; axis: 'x' | 'z'; air: Position[]; }
export declare function createNetherPortalBlueprint(options: { origin: Position; axis?: 'x' | 'z' }): NetherPortalBlueprint;
export declare function planNetherPortal(input: { blueprint: NetherPortalBlueprint; blocks: Record<string, string | null>; inventory?: Record<string, number> }): ConstructionPlan & { entrance?: Position };
export interface EyeFlight { dimension: string; origin: Position; end: Position; launched?: Position; at?: number; }
export type EyeEstimate = { status: 'estimated'; position: { x: number; z: number }; residual: number; baseline: number; rays: number } | { status: 'insufficient' | 'inconsistent'; reason: string; residual?: number };
export declare function triangulateEyes(observations: EyeFlight[], options?: { minBaseline?: number; maxResidual?: number }): EyeEstimate;
export declare function fortressEvidence(observation: Observation): { candidate: boolean; blocks: Json[]; blazes: Json[] };
export type BowAim = { status: 'aimed'; yaw: number; pitch: number; ticks: number; error: number; path: Position[] } | { status: 'blocked'; reason: string };
export declare function aimBow(input: { origin: Position; target: Position; speed?: number; gravity?: number; drag?: number; maxTicks?: number }): BowAim;
export declare function dragonDecision(observation: Observation): { mode: 'blocked' | 'completed' | 'evade' | 'crystal' | 'search' | 'perch' | 'dragon'; reason: string; target?: Position; entityId?: string };
export type ScenarioStep = { id: string } & (
  {type:'swim';position:Position} |
  { type:'navigate'; position:Position; range?:number; bridge?:boolean; excavate?:boolean } |
  { type: 'resources'; targets: Record<string, number> } | { type: 'collect'; item: string; count: number } |
  { type: 'netherPortal'; origin?: Position; axis?: 'x' | 'z' } | { type: 'travel'; dimension: 'minecraft:overworld' | 'minecraft:the_nether' | 'minecraft:the_end' } |
  { type: 'blazeRods' | 'enderPearls' | 'eyes'; count: number } | { type: 'stronghold' | 'endPortal' | 'dragon' });
export interface Scenario { schemaVersion: 1; name: string; steps: ScenarioStep[]; }
export interface ScenarioState { status: 'pending' | 'running' | 'blocked' | 'completed'; current: string | null; completed: string[]; reason: string; }
export interface ScenarioController { reactor: Reactor; snapshot(): ScenarioState; definition(): Scenario; recordResult(event: any, action: Action): void; }
export declare function validateScenario(input: unknown): Scenario;
export declare function createScenario(options: { scenario: Scenario; catalog: Catalog; taxonomy?: BlockTaxonomy; stations?: Record<string, true | Position>; getBlock?: ExplorationOptions['getBlock']; explorationRadius?: number; explorationPlanner?:ExplorationPlanner; resourceFactory?: (targets: Record<string, number>) => Reactor & { recordResult?(event: any, action: Action): void }; navigationFactory?:(step:Extract<ScenarioStep,{type:'navigate'}>)=>{react(o:Observation):Reaction|null;recordResult?(event:any,action:Action):void}; strongholdSearch?: (observation: Observation, estimate: {x:number;z:number}) => Reaction | null; dragonCombat?:Pick<DragonPolicy,'react'|'recordResult'> }): ScenarioController;
export {assessFall} from './kudoconnect/index.js';
export declare function endExpeditionScenario():Scenario;
export declare function dragonExpeditionScenario():Scenario;
export interface DragonPolicy {react(observation:Observation):Reaction|null;recordResult(event:{outcome:string},action:Action):void;snapshot():{tower:{entityId:string;anchor:Position;topY:number;mode:string;opened:number}|null;failures:number;reason:string};}
export declare function createDragonPolicy(options:{client:import('./kudoconnect/index.js').KudoConnect;maxTowerHeight?:number}):DragonPolicy;
export interface CampaignProgress {objective:'enter-end'|'defeat-dragon';stage:string|null;reason?:string;elapsedMs?:number;idleMs?:number;status?:'running'|'stalled'|'blocked'|'dead'|'completed'|'unverified';goalConfirmed?:boolean;entries:{at:number;stage:string|null;completed:string[];dimension:string}[];}
export declare function createCampaignJournal(options?:{clock?:()=>number;stallAfterMs?:number;maxEntries?:number;objective?:'enter-end'|'defeat-dragon'}):{observe(input:{scenario:ScenarioState;self:{dimension:string;health:number};inventory?:Record<string,number>;endgame?:{crystals?:{entityId:string}[];dragonDeath?:{confirmed:boolean;ownDamageConfirmed:boolean}}}):CampaignProgress;snapshot():CampaignProgress};
export declare function createEndExpedition(options:{client:import('./kudoconnect/index.js').KudoConnect;worldId:string;scenario?:Scenario;config?:Partial<Omit<AgentConfig,'worldId'>>;clock?:()=>number}):{brain:MinecraftBrain;controller:ScenarioController;snapshot():{scenario:ScenarioState;progress:CampaignProgress;dragon:ReturnType<DragonPolicy['snapshot']>;failures:{action:Action;attempts:number;until:number;reason:string}[]}};
export interface StorageOptions { radius?: number; recheckMs?: number; maxStacks?: number; items?: string[]; clock?: () => number; }
export declare function createStorageReactor(options?: StorageOptions): Reactor;
export interface MinecraftBrainOptions extends Omit<CoreOptions, 'config' | 'adapter'> {
  client: import('./kudoconnect/index.js').KudoConnect;
  worldId: string;
  config?: Partial<Omit<AgentConfig, 'worldId'>>;
  defense?: Parameters<typeof createCombatReactor>[0];
  storage?: StorageOptions | false;
  survival?: SurvivalOptions | false;
  loot?: LootOptions | false;
  needs?: {foodThreshold?: number; allowHunting?: boolean} | false;
  equipment?: boolean;
  neural?: false | {model?:NeuralNavigator;memory?:NeuralMemory};
  spatial?: false | {model?:SpatialMemory;memory?:SpatialMemoryData;maxEntries?:number;maxAgeMs?:number};
  cognition?: false | {model?:NeuralPlanner;memory?:CognitionMemory};
  computation?: false | {pool?:CpuPool;planner?:ExplorationPlanner};
  night?: NightOptions | false;
  hunting?: HuntingOptions | false;
  adapterOptions?: import('./adapters/kudoconnect.js').KudoAdapterOptions;
}
export declare function createMinecraftBrain(options: MinecraftBrainOptions): MinecraftBrain;
export interface NightOptions { retryMs?:number; clock?:()=>number; }
export interface HuntingOptions { targets?:Record<string,number>; foodReserve?:number; radius?:number; prepareWool?:boolean; reserveRequiresTools?:boolean; maxPursuitMs?:number; clock?:()=>number; }
export declare function createEquipmentReactor():Reactor;
export declare function createNightReactor(options?:NightOptions):Reactor & {attach(core:MckudoCore):()=>void};
export declare function createHuntingReactor(options?:HuntingOptions):Reactor & {attach(core:MckudoCore):()=>void};
export interface InteractionOptions { from: import('./kudoconnect/index.js').KudoConnect; to: import('./kudoconnect/index.js').KudoConnect; kind?: 'meet' | 'give'; item?: string; count?: number; }
export interface InteractionPlan { kind: 'meet' | 'give'; item: string | null; count: number; from: string; to: string; meeting: { from: Position; to: Position }; routes: { from: number; to: number }; }
export interface InteractionReport { id: string; plan: InteractionPlan; status: 'completed' | 'failed' | 'partial' | 'cancelled'; journal: { at: number; phase: string; evidence: Record<string, Json> }[]; before: { from: Record<string,number>; to: Record<string,number> }; after: { from: Record<string,number>; to: Record<string,number> }; reason: string; }
export declare function previewInteraction(options: InteractionOptions & { maxDistance?: number }): InteractionPlan;
export declare function runInteraction(options: InteractionOptions & { timeoutMs?: number; signal?: AbortSignal; peers?: Map<string, import('./kudoconnect/index.js').KudoPeer>; priority?: number }): Promise<InteractionReport>;

export type SurvivalTarget = 'wood' | 'stone_tools' | 'iron_pickaxe' | 'diamond_set';
export interface SurvivalOptions { spatial?:SpatialMemory|null; explorationPlanner?:ExplorationPlanner; client?: import('./kudoconnect/index.js').KudoConnect; peer?: import('./kudoconnect/index.js').KudoPeer; catalog?: Catalog; target?: SurvivalTarget; targets?: Record<string,number>; priority?: number; exploration?: boolean; digStaircase?: boolean; maxMemory?: number; maxRecipeNodes?: number; clock?: ()=>number; }
export interface LootOptions { peer?:import("./kudoconnect/index.js").KudoPeer; radius?: number; priority?: number; retryMs?: number; clock?: ()=>number; targets?: Record<string,number>; }
export interface SurvivalSnapshot { status:string; stage:string|null; reason:string; targets:Record<string,number>; completed:string[]; knownResources:number; remaining?:Record<string,number>; lastFailure:unknown; plan?:{item:string;required:number;missing:number;parent:string|null;recipeId?:string;ingredients?:{item:string;count:number}[];alternatives?:{recipeId:string;cost:number}[]}[]; }
export interface StatefulReactor extends Reactor { recordResult(result:{outcome:string;detail?:string},action?:Action):void; attach(core:MckudoCore):()=>void; }
export interface SurvivalReactor extends StatefulReactor { snapshot():SurvivalSnapshot; }
export interface MinecraftBrain extends MckudoCore { computation:ExplorationPlanner|null; spatial:SpatialMemory|null; cognition:NeuralPlanner|null; neural?:NeuralNavigator; survival:SurvivalReactor|null; loot:StatefulReactor|null; }
export declare function createSurvivalReactor(options:SurvivalOptions):SurvivalReactor;
export declare function createLootReactor(options?:LootOptions):StatefulReactor;
export declare function diamondSetTargets():Record<string,number>;
export declare function diamondSetCondition():Condition;
export interface ValueContext { inventory?:Record<string,number>; targets?:Record<string,number>; food?:number; }
export declare function itemValue(item:string,context?:ValueContext):number;
export declare function inventoryValue(inventory:Record<string,number>,context?:ValueContext):number;
export declare function survivalReserves(inventory:Record<string,number>,targets?:Record<string,number>):Record<string,number>;
export interface TradePlan { kind:'trade'|'gift'; give:{item:string;count:number}[];receive:{item:string;count:number}[];fromGain:number;toGain:number;score:number; }
export interface TradeProposalOptions { from:Record<string,number>;to:Record<string,number>;fromTargets?:Record<string,number>;toTargets?:Record<string,number>;fromFood?:number;toFood?:number;allowGift?:boolean;maxCount?:number; }
export declare function proposeTrade(options:TradeProposalOptions):TradePlan|null;
export interface TradeReport { status:'completed'|'unnecessary'|'partial'|'failed';plan:TradePlan|null;deliveries:InteractionReport[];reason:string; }
export declare function runTrade(options:Pick<InteractionOptions,'from'|'to'> & {fromTargets?:Record<string,number>;toTargets?:Record<string,number>;allowGift?:boolean;signal?:AbortSignal;peers?:Map<string,import('./kudoconnect/index.js').KudoPeer>;timeoutMs?:number}):Promise<TradeReport>;
export interface TeamSupplyOptions { clients:import('./kudoconnect/index.js').KudoConnect[];targets?:(client:import('./kudoconnect/index.js').KudoConnect)=>Record<string,number>; }
export declare function teamSupplyTargets(client:import('./kudoconnect/index.js').KudoConnect,clients:TeamSupplyOptions['clients'],goals?:Record<string,number>):Record<string,number>;
export declare function proposeTeamTransfer(options:TeamSupplyOptions & {maxDistance?:number}):({from:import('./kudoconnect/index.js').KudoConnect;to:import('./kudoconnect/index.js').KudoConnect;fromTargets:Record<string,number>;toTargets:Record<string,number>;proposal:TradePlan})|null;
export declare function shareTeamSupplies(options:TeamSupplyOptions & {peers?:Map<string,import('./kudoconnect/index.js').KudoPeer>;signal?:AbortSignal;maxTransfers?:number}):Promise<{status:TradeReport['status']|'pending';transfers:(TradeReport & {from:string;to:string})[]}>;
export interface AgentManagerOptions { brainOptions?:Omit<MinecraftBrainOptions,'client'|'worldId'>; memoryDirectory?:string; count?:number;names?:string[];connection?:import('./kudoconnect/index.js').KudoOptions;worldId?:string;createClient?:typeof import('./kudoconnect/index.js').createKudoConnect;createBrain?:typeof createMinecraftBrain; }
export interface ManagedAgent { spatial:SpatialMemorySnapshot|null; tasks:AgentTask[];taskState:TaskState[];learning:NeuralSnapshot|null;cognition:CognitionSnapshot|null;recipes:import("./kudoconnect/index.js").RecipeBookSnapshot|null; name:string;busy:boolean;error:string;goal:SurvivalTarget;state:import('./kudoconnect/index.js').KudoSnapshot;inventory:{item:string;name:string;count:number;slot:number}[];brain:Snapshot|null;survival:SurvivalSnapshot|null;skills:string[]; }
export interface ManagerSnapshot { worldId:string;agents:ManagedAgent[];log:{at:number;name:string;event:string;detail:string}[]; }
export interface AgentManager { ready:Promise<unknown>; fleet:ReturnType<typeof import('./kudoconnect/index.js').createFleet>;snapshot():ManagerSnapshot;execute(name:string,command:'connect'|'disconnect'|'respawn'|'start'|'pause'|'goal'|'action'|'give'|'trade'|'tasks'|'taskRetry',args?:Record<string,unknown>):Promise<unknown>;close():Promise<void>; }
export declare function createAgentManager(options?:AgentManagerOptions):AgentManager;
export interface MinecraftAgentOptions extends Omit<AgentManagerOptions,'count'|'names'|'worldId'> {name?:string;worldId:string;}
export type MissionStep = {get:string;count?:number} | {craft:string;count?:number} | {go:Position;range?:number;bridge?:boolean;excavate?:boolean} | {swim:Position};
export interface AgentRunOptions {timeoutMs?:number;signal?:AbortSignal;}
export declare function defineMission(steps:MissionStep[],options?:{name?:string}):Scenario;
export interface MinecraftAgent {
  readonly name:string;readonly worldId:string;readonly client:import('./kudoconnect/index.js').KudoConnect;readonly manager:AgentManager;
  snapshot():ManagedAgent;connect():Promise<ManagedAgent>;start(goal?:SurvivalTarget):Promise<ManagedAgent>;
  run(scenario:Scenario,options?:AgentRunOptions):Promise<ManagedAgent>;
  mission(steps:MissionStep[],options?:AgentRunOptions):Promise<ManagedAgent>;
  get(item:string,count?:number,options?:AgentRunOptions):Promise<ManagedAgent>;
  craft(item:string,count?:number,options?:AgentRunOptions):Promise<ManagedAgent>;
  goTo(position:Position,options?:AgentRunOptions&{range?:number;bridge?:boolean;excavate?:boolean}):Promise<ManagedAgent>;
  swimTo(position:Position,options?:AgentRunOptions):Promise<ManagedAgent>;
  pause():Promise<void>;respawn():Promise<ManagedAgent>;close():Promise<void>;
}
export declare function createMinecraftAgent(options:MinecraftAgentOptions):MinecraftAgent;
export declare function startDashboard(options?:{port?:number;manager?:AgentManager}):Promise<{url:string;manager:AgentManager;close():Promise<void>}>;

export interface NavigationExperience {from:Position;to:Position;dimension:string;kind?:string;health?:number|null;food?:number|null;nearbyPlayers?:number;healthAfter?:number|null;outcome:'success'|'failure'|'cancelled';id?:string;reason?:string;}
export interface NeuralMemory {schemaVersion:1;worldId:string;architecture:'12-16-1';samples:number;updates:number;weights:{w:number[][];b:number[];v:number[];bias:number};replay:{x:number[];y:0|1}[];failed:{key:string;until:number;count:number}[];}
export interface NeuralSnapshot {kind:'local-neural-network';architecture:'12-16-1';samples:number;updates:number;loss:number;rememberedFailures:number;journal:{at:number;from:Position;to:Position;dimension:string;outcome:string;damage:boolean;reason:string}[];}
export interface NeuralNavigator {worldId:string;record(event:NavigationExperience):boolean;assess(event:Omit<NavigationExperience,'outcome'>):{failureProbability:number;samples:number;trained:boolean;rememberedFailures:number;cost:number};snapshot():NeuralSnapshot;export():NeuralMemory;}
export declare function createNeuralNavigator(options:{worldId:string;learningRate?:number;memory?:NeuralMemory;clock?:()=>number}):NeuralNavigator;
export declare function attachNeuralNavigation(client:import('./kudoconnect/index.js').KudoConnect,model:NeuralNavigator):()=>void;
export interface CognitionMemory {schemaVersion:1;worldId:string;architecture:'24-24-1';samples:number;updates:number;weights:{w:number[][];b:number[];v:number[];bias:number};replay:{x:number[];y:0|1}[];}
export interface CognitionSnapshot {kind:'local-neural-planner';architecture:'24-24-1';samples:number;updates:number;loss:number;journal:{at:number;skill:string;item:string;outcome:string;damage:boolean;detail:string}[];}
export interface NeuralPlanner {worldId:string;assess(observation:Observation,action:Action):{failureProbability:number;trained:boolean;cost:number};record(event:{before:Observation;after?:Observation|null;action:Action;outcome:'success'|'failure'|'cancelled'|'progress';detail?:string}):boolean;snapshot():CognitionSnapshot;export():CognitionMemory;}
export declare function createNeuralPlanner(options:{worldId:string;memory?:CognitionMemory;learningRate?:number;clock?:()=>number}):NeuralPlanner;
export type AgentTask={id:string;title:string}&({type:'action';action:Action&{args:Record<string,Json>}}|{type:'scenario';scenario:Scenario});
export interface TaskState {id:string;status:'pending'|'running'|'completed'|'failed'|'blocked';reason:string;}
export interface TaskQueue {reactor:Reactor;definition():AgentTask[];snapshot():TaskState[];retry(id:string):void;attach(core:MckudoCore):()=>void;}
export declare function validateTasks(input:unknown,options?:{skills?:readonly string[]}):AgentTask[];
export declare function createTaskQueue(options?:{tasks?:AgentTask[];skills?:readonly string[];scenarioFactory?:(scenario:Scenario)=>ScenarioController;resume?:TaskState[]}):TaskQueue;
export declare function createAgentMemory(directory:string,worldId:string):{load(name:string):Promise<{schemaVersion:1;worldId:string;name:string;spatial?:SpatialMemoryData;neural?:NeuralMemory;cognition?:CognitionMemory;tasks?:AgentTask[];taskState?:TaskState[];goal?:SurvivalTarget}|null>;save(name:string,state:{spatial?:SpatialMemoryData;neural?:NeuralMemory;cognition?:CognitionMemory;tasks?:AgentTask[];taskState?:TaskState[];goal?:SurvivalTarget}):Promise<void>;flush():Promise<void>};
export interface BrewingRecipe {from:string;to:string;ingredient:string;station:string;fuel:string;bottlesPerBatch:number;brewTicks:number;}
export declare function brewingRecipes(registry:any):BrewingRecipe[];
export type BrewingPlan={status:'blocked';reason:string;steps:[]}|{status:'planned';potion:string;form:'potion'|'splash_potion'|'lingering_potion';bottles:number;steps:({from:string;to:string;ingredient:string;bottles:number;container?:string})[];ingredients:Record<string,number>;fuel:{item:string;count:number};station:string;requiresExecutor:'brew'};
export declare function planBrewing(options:{registry:any;potion:string;from?:string;bottles?:number;form?:'potion'|'splash_potion'|'lingering_potion'}):BrewingPlan;
export type NetheritePlan={status:'unsupported';reason:string}|{status:'needs-materials'|'ready';station:string;input:string;output:string;required:Record<string,number>;missing:Record<string,number>;preserveComponents:true;requiresExecutor:'smith'};
export declare function planNetheriteUpgrade(options:{registry:any;item:string;inventory?:Record<string,number>}):NetheritePlan;
export declare function dimensionTravelPolicy(dimension:string):{coordinateScale:number;waterUsable:boolean;bedsUsable:boolean;maxDrop:number;avoid:string[];ceilingSearch?:boolean;bridgeNeedsKnownSupport?:boolean};

export interface SpatialEntry {name:string;position:Position;dimension:string;lastSeen:number;observations:number;}
export interface SpatialMemoryData {schemaVersion:1;worldId:string;entries:SpatialEntry[];}
export interface SpatialMemorySnapshot {worldId:string;entries:number;maxEntries:number;maxAgeMs:number;invalidations:number;dimensions:string[];}
export interface SpatialMemory {
  worldId:string;
  observe(observation:{dimension:string;world?:{sampledBlocks?:{name:string;position:Position}[]}},options?:{getBlock?:(p:Position)=>NavigationBlock|null}):number;
  entries(query?:{dimension?:string;names?:string[];near?:Position;limit?:number}):SpatialEntry[];
  snapshot():SpatialMemorySnapshot;export():SpatialMemoryData;
}
export declare function createSpatialMemory(options:{worldId:string;maxEntries?:number;maxAgeMs?:number;memory?:SpatialMemoryData;clock?:()=>number}):SpatialMemory;
export {KUDOVECTORIZE,KudoVectorize,volumeClearance,traceVolume,planSwimRoute,planSwimRouteAsync,predictElytraTick} from './packages/kudoconnect/index.js';
export type {SwimRouteOptions,SwimRouteResult,VolumeResult,ElytraPrediction} from './packages/kudoconnect/index.js';
export interface MachineResource {kind?:'item'|'fluid';id:string;amount?:number;}
export interface MachineRecipe {id:string;machine:string;inputs?:MachineResource[];outputs:MachineResource[];catalysts?:MachineResource[];energy?:{unit:string;amount:number}|null;durationTicks?:number;}
export interface MachineGraphDocument {schemaVersion:1;minecraftVersion:string;source?:string;recipes:MachineRecipe[];}
export interface MachineStep extends MachineRecipe {batches:number;executorAvailable:boolean;}
export interface MachineGraph {readonly schemaVersion:1;readonly minecraftVersion:string;readonly source:string;recipesFor(resource:MachineResource):MachineRecipe[];snapshot():MachineGraphDocument;}
export interface MachinePlan {status:'planned'|'blocked';executable:boolean;reason?:string;steps:MachineStep[];missingExecutors:string[];remaining?:Record<string,number>;energy?:Record<string,number>;durationTicks?:number;nodes:number;}
export declare function machineResourceKey(resource:MachineResource):string;
export declare function createMachineGraph(document:MachineGraphDocument):MachineGraph;
export declare function planMachineResources(options:{graph:MachineGraph;targets:MachineResource[];inventory?:MachineResource[];executors?:string[];maxDepth?:number;maxNodes?:number;maxSteps?:number}):MachinePlan;
export declare function executeMachinePlan(options:{plan:MachinePlan;executors:Record<string,(step:MachineStep,context:{signal:AbortSignal})=>unknown|Promise<unknown>>;observe:()=>{revision:number;resources:MachineResource[]}|Promise<{revision:number;resources:MachineResource[]}>;signal?:AbortSignal;timeoutMs?:number}):Promise<{ok:true;receipts:{recipe:string;machine:string;batches:number;revision:number;confirmed:true}[]}>;
