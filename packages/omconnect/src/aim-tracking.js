import { wrapDegrees } from './movement.js';

/** Feed forward observed angular motion into SmoothLook; release still checks actual angles. */
export class AimTracking {
  previous = null;
  update(c, solution, signal, now = performance.now()) {
    const previous = this.previous, dt = previous ? (now - previous.at) / 1000 : 0;
    const lead = error => Math.max(-6, Math.min(6, error / dt * .05));
    const moving = dt >= .01 && dt <= .15;
    const yaw = solution.yaw + (moving ? lead(wrapDegrees(solution.yaw - previous.yaw)) : 0);
    const pitch = Math.max(-89.9, Math.min(89.9, solution.pitch + (moving ? lead(solution.pitch - previous.pitch) : 0)));
    this.previous = { yaw: solution.yaw, pitch: solution.pitch, at: now };
    const y = yaw * Math.PI / 180, p = pitch * Math.PI / 180, s = c.state.position;
    c.lookAt({ x: s.x - Math.sin(y) * Math.cos(p) * 20, y: s.y + 1.62 - Math.sin(p) * 20, z: s.z + Math.cos(y) * Math.cos(p) * 20 }, { signal, turnSpeed: 720 });
    return Math.hypot(wrapDegrees(solution.yaw - c.state.yaw), solution.pitch - c.state.pitch);
  }
}
