import { performance } from 'node:perf_hooks';

/** Schedule against absolute deadlines instead of accumulating timer rounding. */
export function createTickLoop(callback, { intervalMs = 50, clock = () => performance.now(), schedule = setTimeout, cancel = clearTimeout } = {}) {
  if(typeof callback!=='function'||!Number.isFinite(intervalMs)||intervalMs<10||intervalMs>1000)throw new Error('Tick loop: callback и intervalMs 10–1000.');
  let closed=false,timer,deadline=clock()+intervalMs;
  const stop=()=>{closed=true;cancel(timer);};
  const queue=()=>{if(!closed)timer=schedule(tick,Math.max(1,Math.ceil(deadline-clock())));};
  function tick(){
    if(closed)return;
    if(clock()<deadline){queue();return;}
    try{callback();}catch(error){stop();throw error;}
    if(closed)return;
    deadline+=intervalMs;
    // A long pause does not justify a burst of simulated movement or packets.
    if(deadline<=clock())deadline=clock()+intervalMs;
    queue();
  }
  queue();return {stop};
}

/** Fixed-size recent cadence window. Measures the local scheduler, not network ping. */
export class TickTiming {
  constructor() { this.samples = []; this.cursor = 0; this.last = null; this.ticks = 0; }
  reset() { this.samples.length = 0; this.cursor = 0; this.last = null; this.ticks = 0; }
  mark(now) {
    if (this.last !== null) {
      this.samples[this.cursor] = Math.max(0, now - this.last);
      this.cursor = (this.cursor + 1) % 128;
    }
    this.last = now; this.ticks++;
  }
  snapshot() {
    const sorted = [...this.samples].sort((a, b) => a - b), n = sorted.length;
    const mean = n ? sorted.reduce((sum, ms) => sum + ms, 0) / n : null;
    return { ticks: this.ticks, samples: n, meanIntervalMs: mean, p95IntervalMs: n ? sorted[Math.ceil(n * .95) - 1] : null,
      maxIntervalMs: n ? sorted[n - 1] : null, delayedTicks: sorted.filter(ms => ms > 75).length, effectiveHz: mean > 0 ? 1000 / mean : null };
  }
}
