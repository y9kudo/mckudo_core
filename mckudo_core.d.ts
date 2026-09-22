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
export interface AgentConfig { $schema?: string; schemaVersion: 1 | 2 | 3; name: string; worldId: string; rules?: Rule[]; workflows?: Workflow[]; goals?: Goal[]; tickIntervalMs?: number; actionTimeoutMs?: number; failureBackoffMs?: number; maxHistory?: number; }
export interface Manifest { protocolVersion: 1; perceptionVersion?: 1; kind: string; loader: string; minecraftVersion: string; skills: readonly string[]; }
export interface Context { signal: AbortSignal; }
export interface Adapter { describe(): Manifest; observe(context: Context): Promise<Observation>; execute(action: Action, context: Context): Promise<unknown>; }
export interface Result { at: number; rule: string; skill: string; outcome: 'success' | 'failure' | 'cancelled' | 'progress'; detail: string; }
export interface StepState { status: 'pending' | 'running' | 'completed' | 'failed' | 'interrupted'; attempts: number; retryAt: number; error: string; }
export interface WorkflowState { id: string; status: 'pending' | 'active' | 'completed' | 'failed' | 'interrupted'; completed: number; total: number; steps: Record<string, StepState>; }
export interface SavedWorkflow { fingerprint: string; active: boolean; steps: Record<string, StepState>; }
export interface SavedGoal { status: 'pending' | 'active' | 'achieved' | 'blocked' | 'failed' | 'interrupted'; actions: number; reason: string; retryAt: number; inFlight: boolean; }
export interface SavedBrain { fingerprint: string; calls: number; goals: Record<string, SavedGoal>; }
export interface Memory { schemaVersion: 1 | 2 | 3; worldId: string; stats: Record<string, { successes: number; failures: number; streak: number }>; history: Result[]; workflows?: Record<string, SavedWorkflow>; brain?: SavedBrain; }
export interface Decision { id: string; kind: 'rule' | 'workflow' | 'goal'; workflowId: string | null; stepId: string | null; goalId: string | null; operatorId: string | null; action: Action; priority: number; alternatives: { id: string; blocked: string | null }[]; }
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
export interface CoreOptions { config: AgentConfig; adapter: Adapter; planning?: PlanningOptions; memory?: Memory; clock?: () => number; }
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
  once(event: 'state', listener: (snapshot: Snapshot) => void): this;
  once(event: 'action:start', listener: (decision: Decision) => void): this;
  once(event: 'action:finish', listener: (result: Result) => void): this;
  once(event: 'decision:trace', listener: (trace: DecisionTrace) => void): this;
  removeListener(event: string, listener: (...args: any[]) => void): this;
  removeAllListeners(event?: string): this;
}
export type Effect = { fact: string } & ({ add: number } | { set: string | number | boolean | null });
export interface Operator { id: string; cost?: number; action: Action; requires?: Condition; effects: Effect[]; }
export interface PlannerContext { perceptionVersion: number | null; observation: Observation; goal: Goal; operators: Operator[]; skills: string[]; }
export interface PlanProposal { steps: string[]; reason?: string; }
export interface Planner { id: string; apiVersion: 1; plan(context: PlannerContext, cancellation: Context): PlanProposal | Promise<PlanProposal>; }
export interface PlanningOptions { operators: Operator[]; planner?: Planner; maxCalls?: number; minIntervalMs?: number; retryDelayMs?: number; }
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
