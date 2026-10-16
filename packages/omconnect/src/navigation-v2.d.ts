import type {Position,NavigationBlock,RoutePlan,RouteScheduling,planRoute,PhysicsState,stepPhysics,ActionFailureCode} from '../index.js';
export interface NavigationScope {server:string;worldId:string;dimension:string;minecraftVersion:string;}
export interface RegionalEdge {from:string;to:string;cost:number;gateway?:Position;observedAt:number;}
export interface RegionalGraphMemory {schemaVersion:1;edges:RegionalEdge[];}
export declare class RegionalRouteGraph {
  constructor(options?:{maxNodes?:number;maxEdges?:number});
  readonly maxNodes:number;readonly maxEdges:number;readonly revision:number;readonly edges:number;
  readonly nodes:Map<string,{out:Map<string,RegionalEdge>;in:Map<string,RegionalEdge>}>;
  setEdge(from:string,to:string,cost:number,options?:{gateway?:Position;observedAt?:number}):RegionalEdge;
  removeEdge(from:string,to:string):boolean;
  export():RegionalGraphMemory;
  restore(memory:RegionalGraphMemory):void;
}
export interface RegionalRouteResult {status:'planned'|'blocked';reason?:string;nodes:string[];edges?:RegionalEdge[];cost?:number;expanded:number;}
export declare class IncrementalRegionPlanner {
  constructor(graph:RegionalRouteGraph);
  plan(start:string,goal:string,options?:{maxExpansions?:number;nodesPerSlice?:number;signal?:AbortSignal}):Promise<RegionalRouteResult>;
  snapshot():{nodes:number;queued:number;totalExpanded:number;resets:number;revision:number};
}
export interface NavigationSegment extends RoutePlan {finalGoal?:Position;segmentGoal?:Position;strategy?:'hierarchical-segment'|'local-astar';cacheHit?:boolean;}
export interface NavigationSessionMemory {schemaVersion:2;scope:NavigationScope;graph:RegionalGraphMemory;routes:{key:string;at:number;route:NavigationSegment;facts:[Position,string|null][]}[];}
export interface NavigationSessionStats {searches:number;cacheHits:number;invalidations:number;segments:number;regionalExpansions:number;cancelled:number;routes:number;regions:number;connections:number;closed:boolean;regional:ReturnType<IncrementalRegionPlanner['snapshot']>;}
export interface NavigationSession {
  plan(options:Omit<Parameters<typeof planRoute>[0],'getBlock'>&{getBlock?:Parameters<typeof planRoute>[0]['getBlock'];staticGeometry?:boolean},scheduling?:RouteScheduling):Promise<NavigationSegment>;
  snapshot():NavigationSessionStats;
  exportMemory():NavigationSessionMemory;
  clear():void;
  close():void;
}
export declare function createNavigationSession(options:{getBlock:(p:Position)=>NavigationBlock|null;getRevision?:()=>unknown;scope:NavigationScope;maxRoutes?:number;maxAgeMs?:number;segmentDistance?:number;clock?:()=>number;memory?:NavigationSessionMemory;planner?:(options:Parameters<typeof planRoute>[0],scheduling?:RouteScheduling)=>Promise<RoutePlan>}):NavigationSession;
export declare const BODY_POSES:Readonly<{standing:1.8;crouching:1.5;swimming:.6;gliding:.6}>;
export declare function collisionShapes(block:NavigationBlock|null):readonly (readonly number[])[]|null;
export declare function bodyBounds(position:Position,height?:number,radius?:number):{minX:number;maxX:number;minY:number;maxY:number;minZ:number;maxZ:number};
export declare function supportAt(options:{position:Position;getBlock:(p:Position)=>NavigationBlock|null;radius?:number;tolerance?:number}):{supported:boolean;height:number|null;unknown:boolean};
export interface MotionSample {position:Position;velocity:Position;onGround:boolean;collision?:boolean;frozen:boolean;}
export declare function predictMotion(options:{state:PhysicsState;control?:Parameters<typeof stepPhysics>[1]|((state:PhysicsState,tick:number)=>Parameters<typeof stepPhysics>[1]);getBlock:(p:Position)=>NavigationBlock|null;ticks?:number}):{state:PhysicsState;samples:MotionSample[];blocked:boolean};
export declare function createMotionProgress(options?:{timeoutMs?:number;minProgress?:number;clock?:()=>number}):{update(position:Position,goal:Position):{stuck:boolean;remaining:number;stalledMs:number}};
export type NavigationFailureCode='NO_PATH'|'STUCK'|'BLOCKED'|'UNLOADED'|'SERVER_CORRECTION'|'INVALID_SUPPORT'|'INSUFFICIENT_RESOURCES'|'UNSAFE_ROUTE'|'DYNAMIC_OBSTACLE'|'ACTION_TIMEOUT';
export declare const NAVIGATION_FAILURE_CODES:readonly NavigationFailureCode[];
export interface NavigationRecoveryDecision {status:'retry'|'blocked';code:NavigationFailureCode;attempt:number;strategy:string;reason?:string;delayMs?:number;safePosition?:Position;at?:number;}
export declare function createNavigationRecovery(options?:{maxAttempts?:number;clock?:()=>number}):{confirmSafe(position:Position):void;decide(failure:{code:ActionFailureCode|NavigationFailureCode;goalId?:string;contextRevision?:string|number}):NavigationRecoveryDecision;reset():void;snapshot():{contexts:number;safePosition:Position|null;maxAttempts:number}};
