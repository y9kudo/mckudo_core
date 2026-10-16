export interface Transition { observation:number[];action:number;reward:number;nextObservation:number[];terminated:boolean;truncated:boolean;nextActionMask?:boolean[] }
export interface DQNOptions { inputs:number;actions:number;hidden?:number;capacity?:number;batchSize?:number;gamma?:number;learningRate?:number;targetEvery?:number;seed?:number;conservativeWeight?:number }
export interface DQNModel { schemaVersion:1;algorithm:'DoubleDQN';config:Required<Omit<DQNOptions,'seed'>>;updates:number;randomState:number;weights:number[];target:number[];first:number[];second:number[] }
export interface DQNPolicy {
  predict(observation:ArrayLike<number>):number[];
  act(observation:ArrayLike<number>,options?:{epsilon?:number;mask?:boolean[]}):number;
  remember(transition:Transition):void;
  train(options?:{steps?:number}):{loss:number|null;updates:number;replaySize:number};
  imitate(samples:{observation:number[];action:number}[],options?:{epochs?:number}):{loss:number;samples:number;epochs:number};
  snapshot():{algorithm:'DoubleDQN';inputs:number;actions:number;hidden:number;parameters:number;replaySize:number;capacity:number;updates:number;conservativeWeight:number};
  export():DQNModel;load(model:DQNModel):void;transfer(model:DQNModel):void;
}
export declare function createDQN(options:DQNOptions):DQNPolicy;
export interface ActorOptions {inputs:number;actions:number;hidden?:number;capacity?:number;batchSize?:number;gamma?:number;learningRate?:number;seed?:number}
export interface BehaviorSample {action:number;logProbability:number;value:number;actionMask:boolean[];revision:number}
export interface PPOTransition {observation:ArrayLike<number>;action:number;reward:number;terminated:boolean;truncated:boolean;actionMask?:boolean[];logProbability:number;value:number;nextValue:number;revision:number;envId?:string|number}
export interface ActorSnapshot {algorithm:string;inputs:number;actions:number;hidden:number;parameters:number;replaySize:number;capacity:number;updates:number}
export interface PPOPolicy {sample(observation:ArrayLike<number>,options?:{mask?:boolean[];deterministic?:boolean}):BehaviorSample;act(observation:ArrayLike<number>,options?:{mask?:boolean[]}):number;value(observation:ArrayLike<number>):number;remember(transition:PPOTransition):void;train(options?:{epochs?:number}):{loss:number|null;updates:number;replaySize:number};snapshot():ActorSnapshot;export():Record<string,unknown>;load(model:Record<string,unknown>):void}
export declare function createPPO(options:ActorOptions&{lambda?:number;clip?:number;entropy?:number;valueWeight?:number}):PPOPolicy;
export interface SACPolicy {act(observation:ArrayLike<number>,options?:{mask?:boolean[];deterministic?:boolean;epsilon?:number}):number;predict(observation:ArrayLike<number>):number[];remember(transition:Transition):void;train(options?:{steps?:number}):{loss:number|null;updates:number;replaySize:number};snapshot():ActorSnapshot;export():Record<string,unknown>;load(model:Record<string,unknown>):void}
export declare function createSAC(options:ActorOptions&{alpha?:number;tau?:number}):SACPolicy;
export interface PhysicalOptions {kind?:'physical';seed?:number;radius?:number;maxSteps?:number;ticksPerStep?:number;mobs?:number;shield?:boolean;layout?:'flat'|'stairs'|'water'|'lava'|'wall';spawnJitter?:number;spawn?:BlockPosition;goal?:BlockPosition}
export declare const PHYSICAL_ACTIONS:readonly string[],PHYSICAL_FEATURES:readonly string[];
export interface PhysicalReset {observation:number[];actionMask:boolean[];info:{ticks:number;position:BlockPosition}}
export interface PhysicalStep {observation:number[];reward:number;terminated:boolean;truncated:boolean;info:{success:boolean;ticks:number;position:BlockPosition;health:number;actionMask:boolean[];mobs:unknown[]}}
export declare function createPhysicalEnvironment(options?:PhysicalOptions):{getBlock:(p:BlockPosition)=>any;setBlock:(p:BlockPosition,name:string)=>void;reset():PhysicalReset;step(action:number):PhysicalStep;snapshot():{state:any;goal:BlockPosition;entities:any[];steps:number;ticks:number;done:boolean}};
export declare function createOMRLBridge(options:{client:import('../packages/omconnect/index.js').OMConnect;policy:DQNPolicy|PPOPolicy|SACPolicy;goal:BlockPosition;stepMs?:number;retreatHealth?:number;train?:boolean;axis?:'north'|'south'|'west'|'east'}):{step(options?:{signal?:AbortSignal;deterministic?:boolean}):Promise<{status:string;reason?:string;success?:boolean;action?:number;transition?:unknown;position?:BlockPosition}>;snapshot():{steps:number;busy:boolean;axis:string;featureSchema:string;actionSchema:string;policy:ActorSnapshot}};
export interface RewardResult {reward:number;parts:Record<string,number>}
export declare function createRewardAPI<T extends {observation:unknown;nextObservation:unknown;terminated:boolean}=Transition>(options?:{terms?:Record<string,(transition:T)=>number>;potential?:(observation:T['observation'])=>number;gamma?:number;clip?:number}):{evaluate(transition:T):RewardResult};
export declare function createNoveltyBonus(options?:{capacity?:number;scale?:number}):{visit(key:string):number;reset():void;snapshot():{entries:number;capacity:number}};
export type HeadlessTask='wood'|'table'|'wood_pickaxe'|'cobblestone'|'stone'|'furnace'|'raw_iron'|'iron_ingot'|'iron_pickaxe'|'diamond';
export declare const HEADLESS_ACTIONS:readonly string[],HEADLESS_FEATURES:readonly string[],HEADLESS_TASKS:readonly HeadlessTask[];
export declare const HEADLESS_FEATURE_SCHEMA:'headless-skills-v2',HEADLESS_ACTION_SCHEMA:'headless-actions-v2';
export interface HeadlessOptions {seed?:number;size?:number;maxSteps?:number;task?:HeadlessTask;hazards?:number;novelty?:number;resources?:Partial<Record<'tree'|'stone'|'iron'|'diamond',number>>}
export interface HeadlessCurriculumStage extends HeadlessOptions {id:string;title:string;task:HeadlessTask}
export interface MinecraftCurriculumStage {id:string;title:string;tier:'wood'|'stone'|'iron'|'diamond';targets:Record<string,number>;timeoutMs:number}
export declare function headlessCurriculumStages():HeadlessCurriculumStage[];
export declare function minecraftCurriculumStages(options?:{tier?:'wood'|'stone'|'iron'|'diamond'}):MinecraftCurriculumStage[];
export interface EnvironmentReset {observation:number[];actionMask:boolean[];info:{episode:number;task:string}}
export interface EnvironmentStep {observation:number[];reward:number;terminated:boolean;truncated:boolean;info:{episode:number;task:string;success:boolean;dead:boolean;steps:number;progress:boolean;actionMask:boolean[];rewardParts:Record<string,number>}}
export declare function createHeadlessEnvironment(options?:HeadlessOptions):{reset(options?:{seed?:number}):EnvironmentReset;step(action:number):EnvironmentStep;snapshot():{episode:number;task:string;finished:boolean;state:Record<string,unknown>}};
export interface VectorPool<R,S,O> {reset(options?:{indices?:number[]}):Promise<(R&{id:number})[]>;step(actions:number[]):Promise<(S&{id:number})[]>;setEnvironment(environment:O):Promise<(R&{id:number})[]>;snapshot():{count:number;workers:number;memoryMbPerWorker:number;steps:number;resets:number;configurations:number;closed:boolean;busy:boolean};close():Promise<void>}
export declare function createVectorEnvironment(options:{count?:number;workers?:number;seed?:number;memoryMb?:number;timeoutMs?:number;environment:PhysicalOptions&{kind:'physical'}}):VectorPool<PhysicalReset,PhysicalStep,PhysicalOptions&{kind:'physical'}>;
export declare function createVectorEnvironment(options?:{count?:number;workers?:number;seed?:number;memoryMb?:number;timeoutMs?:number;environment?:HeadlessOptions}):VectorPool<EnvironmentReset,EnvironmentStep,HeadlessOptions>;
export interface CurriculumTransition {from:number;to:number;successRate:number;episodes:number;reason:'promoted'|'demoted'}
export interface CurriculumMemory {schemaVersion:1|2;signature:string;index:number;episodes:number;results:number[];history:CurriculumTransition[]}
export declare function migrateCurriculumMemory<T>(options:{memory:CurriculumMemory;previousStages:T[];stages:T[];window?:number;promoteAt?:number;demoteBelow?:number}):CurriculumMemory;
export interface CurriculumSnapshot<T> {index:number;totalStages:number;episodes:number;samples:number;successRate:number|null;stage:T;history:CurriculumTransition[]}
export interface Curriculum<T> {record(success:boolean,options?:{allowPromotion?:boolean}):CurriculumSnapshot<T>;current():T;snapshot():CurriculumSnapshot<T>;export():CurriculumMemory}
export declare function createCurriculum<T=HeadlessCurriculumStage>(options?:{stages?:T[];window?:number;promoteAt?:number;demoteBelow?:number;memory?:CurriculumMemory}):Curriculum<T>;
export declare function curriculumEnvironment(stage:HeadlessOptions):HeadlessOptions;
export interface CurriculumTrainingProgress<T> {batch:number;stageBatches:number;epsilon:number;transitions:number;episodes:number;successes:number;training:ReturnType<DQNPolicy['train']>;curriculum:CurriculumSnapshot<T>;elapsedMs:number}
export declare function trainCurriculum<T extends HeadlessOptions>(options:{policy:DQNPolicy;environments:ReturnType<typeof createVectorEnvironment>;curriculum:Curriculum<T>;batches?:number;stepsPerBatch?:number;initialStageBatches?:number;validateStage?:(stage:T)=>boolean|Promise<boolean>;validationEvery?:number;onBatch?:(progress:CurriculumTrainingProgress<T>)=>void|Promise<void>;onStageChange?:(event:{batch:number;previous:CurriculumSnapshot<T>;current:CurriculumSnapshot<T>;transitions:number;episodes:number;successes:number})=>void|Promise<void>;onTransition?:(transition:Transition)=>void|Promise<void>;signal?:AbortSignal}):Promise<{batches:number;transitions:number;episodes:number;successes:number;stageBatches:number;elapsedMs:number;curriculum:CurriculumSnapshot<T>}>;
export interface SkillAction {skill:string;args:Record<string,unknown>}
export declare function createPolicyRunner<O>(options:{adapter:{observe(options:{signal?:AbortSignal}):Promise<O>;execute(action:SkillAction,options:{signal?:AbortSignal}):Promise<unknown>};policy:DQNPolicy;encode:(o:O)=>number[];actions:{allowed:(o:O)=>boolean;action:(o:O)=>SkillAction}[];reward:{evaluate(t:Omit<Transition,'reward'>&{before:O;after:O;outcome:string}):RewardResult};goal?:(o:O)=>boolean;trainSteps?:number;telemetry?:ReturnType<typeof createTelemetry>;recorder?:Awaited<ReturnType<typeof createReplayWriter>>}):{step(options?:{signal?:AbortSignal;epsilon?:number;truncated?:boolean}):Promise<{status:string;reason?:string;transition?:Transition;action?:SkillAction;outcome?:string;reward?:RewardResult;training?:unknown}>;snapshot():{busy:boolean;steps:number;policy:ReturnType<DQNPolicy['snapshot']>}};
export interface Goal {id:string;priority?:number;payload?:unknown;dependsOn?:string[]}
export interface GoalState extends Required<Goal> {status:'pending'|'active'|'completed'|'failed';order:number;createdAt:number;attempts:number;finishedAt?:number}
export declare function createGoalStack(options?:{capacity?:number;clock?:()=>number}):{push(goal:Goal):string;next():GoalState|null;finish(id:string,options?:{success?:boolean;retry?:boolean}):void;recover():void;setPriority(id:string,priority:number):void;snapshot():GoalState[]};
export interface HTNTask {name:string;args?:unknown}
export declare function createHTNPlanner<S>(options?:{primitives?:Record<string,{applicable:(state:S,args:unknown)=>boolean;apply:(state:S,args:unknown)=>S;action:(state:S,args:unknown)=>SkillAction}>;methods?:Record<string,{applicable:(state:S,args:unknown)=>boolean;tasks:(state:S,args:unknown)=>HTNTask[]}[]>;maxNodes?:number;maxDepth?:number;maxPlan?:number}):{plan(tasks:HTNTask[],initial:S,options?:{signal?:AbortSignal}):{status:'planned'|'budget'|'blocked';actions:SkillAction[];state?:S;visited:number}};
export declare function createMCTSPlanner<S,A>(options:{model:{actions:(state:S)=>A[];step:(state:S,action:A)=>{state:S;reward:number};terminal:(state:S)=>boolean};iterations?:number;horizon?:number;budgetMs?:number;gamma?:number;exploration?:number;seed?:number;clock?:()=>number}):{plan(initial:S,options?:{signal?:AbortSignal}):{status:'planned'|'blocked';action:A|null;iterations:number;elapsedMs:number;choices:{action:A;visits:number;value:number}[]}};
export type LLMRequest=(input:{prompt:string;signal:AbortSignal})=>Promise<string>;
export declare function createLLMProvider(options:{provider:'openai'|'anthropic'|'local';model:string;apiKey?:string;baseURL?:string;fetch?:typeof globalThis.fetch;maxTokens?:number}):LLMRequest;
export interface ProposedPlan {actions:SkillAction[];reason:string}
export declare function createLLMPlanner(options:{request:LLMRequest;skills:string[];validateAction:(action:SkillAction)=>boolean;fallback?:(goal:string,observation:unknown)=>ProposedPlan|Promise<ProposedPlan>;maxCalls?:number;timeoutMs?:number;maxActions?:number}):{plan(goal:string,observation:unknown,options?:{signal?:AbortSignal}):Promise<ProposedPlan&{source:'llm'|'fallback'}>;snapshot():{calls:number;failures:number;maxCalls:number;busy:boolean}};
export interface BlockPosition {x:number;y:number;z:number}
export interface WorldHint {name:string;position:BlockPosition;dimension:string;lastSeen:number;agent:string;requiresRevalidation:true}
export interface WorldStore {
  readonly scope:Readonly<import('../overmindmc.js').WorldAtlasScope>;
  observe(batch:{dimension:string;blocks:{name:string;position:BlockPosition}[];agent?:string;observedAt?:number}):number;
  query(options:{dimension:string;names?:string[];near:BlockPosition;radius?:number;maxAgeMs?:number;limit?:number}):WorldHint[];
  writeAtlasRecords(records:import('../overmindmc.js').AtlasRecord[]):number;
  readAtlasRecords(options:{dimension:string;kind?:'region'|'transition'|'anchor';limit?:number;maxAgeMs?:number}):import('../overmindmc.js').AtlasRecord[];
  prune(options?:{before?:number}):number;close():void;
}
export declare function openWorldStore(options:{path:string;worldId:string;serverId:string;minecraftVersion:string;clock?:()=>number}):Promise<WorldStore>;
export declare function createReplayWriter(options:{path:string;featureSchema:string;actionSchema:string;maxBytes?:number}):Promise<{append(transition:Transition):Promise<void>;snapshot():{bytes:number;transitions:number;maxBytes:number;closed:boolean};close():Promise<void>}>;
export declare function readReplay(path:string,options?:{featureSchema?:string;actionSchema?:string;maxRecords?:number;maxBytes?:number}):AsyncGenerator<Transition&{type:'transition';sequence:number}>;
export declare function trainOffline(policy:DQNPolicy,path:string,options?:{steps?:number;featureSchema?:string;actionSchema?:string;maxRecords?:number;maxBytes?:number}):Promise<{records:number;loss:number|null;updates:number;replaySize:number}>;
export interface OTelSpan {setStatus(status:{code:number}):void;recordException(error:unknown):void;end():void}
export declare function createTelemetry(options?:{tracer?:{startActiveSpan<T>(name:string,fn:(span:OTelSpan)=>Promise<T>):Promise<T>};capacity?:number;clock?:()=>number}):{increment(name:string,value:number):void;trace<T>(name:string,operation:()=>Promise<T>):Promise<T>;prometheus():string;snapshot():{metrics:Record<string,number>;spans:{name:string;traceId:string;durationMs:number;error:boolean}[]}};
export declare function createWatchdog(options:{timeoutMs?:number;maxRestarts?:number;restartWindowMs?:number;restart:()=>Promise<void>;clock?:()=>number}):{heartbeat():void;trip():void;check():Promise<{status:string;reason?:string}>;snapshot():{lastHeartbeat:number;restarts:number;busy:boolean;circuit:boolean;closed:boolean;failures:number};close():void};
export declare function reportHeartbeat(detail?:unknown):void;
export declare function createWorkerSupervisor(options:{module:URL;workerData?:unknown;timeoutMs?:number;maxRestarts?:number;restartWindowMs?:number;memoryMb?:number}):{events:import('node:events').EventEmitter;snapshot():{status:string;generation:number;memoryMb:number;lastError:string|null;watchdog:ReturnType<ReturnType<typeof createWatchdog>['snapshot']>};close():Promise<void>};
export declare function createRecoveryPolicy(options?:{maxDeaths?:number;respawnDelayMs?:number;clock?:()=>number}):{update(observation:unknown):{phase:string;action:{type:'respawn'|'rebuild';deathPosition?:BlockPosition;deathDimension?:string;revalidateGoals?:boolean}|null;deaths:number};resume():void;snapshot():{phase:string;deaths:number;maxDeaths:number;deathPosition:BlockPosition|null;deathDimension:string|null}};
export type TeamMessageType='observation'|'offer'|'request'|'role'|'danger';
export interface TeamEnvelope {id:string;agent:string;type:TeamMessageType;payload:unknown;sequence?:number}
export declare function createTeamBlackboard(options:{worldId:string;capacity?:number;ttlMs?:number;clock?:()=>number}):{publish(message:TeamEnvelope):boolean;read(options?:{type?:TeamMessageType;excludeAgent?:string}):(Required<TeamEnvelope>&{worldId:string;expiresAt:number})[];snapshot():{worldId:string;entries:number;capacity:number}};
export declare function assignRoles(agents:{id:string;skills?:Record<string,number>;load?:number}[],roles:{id:string;skills?:Record<string,number>}[]):{agent:string;role:string;score:number}[];
export interface ExchangeParty {inventory:Record<string,number>;reserves?:Record<string,number>;values?:Record<string,number>}
export declare function evaluateExchange(options:{left:ExchangeParty;right:ExchangeParty;giveLeft?:Record<string,number>;giveRight?:Record<string,number>}):{accepted:boolean;leftGain:number|null;rightGain:number|null;requiresInventoryRevalidation:true};
