/**
 * Vehicle model seam (impl 02 §2.5; spec plan/03 §3.3, plan/04 §4.11). FROZEN.
 */
import type { LinkStats } from './transport';

export type VehicleClass = 'copter' | 'plane' | 'rover' | 'boat' | 'sub' | 'tracker' | 'unknown';

export interface VehicleState {
  sysid: number;
  compid: number;
  /** MAV_TYPE */
  mavType: number;
  /** MAV_AUTOPILOT */
  autopilot: number;
  vehicleClass: VehicleClass;
  firmware?: string;
  armed: boolean;
  mode: string;
  attitude: { rollRad: number; pitchRad: number; yawRad: number };
  position?: { lat: number; lon: number; altRelM: number; altAmslM: number };
  velocity?: { groundMs: number; airMs?: number; climbMs: number };
  battery?: { voltageV: number; currentA?: number; remainingPct?: number; consumedmAh?: number };
  gps?: { fix: number; sats: number; hdop: number };
  ekfOk?: boolean;
  vibe?: { x: number; y: number; z: number };
  home?: { lat: number; lon: number; altM: number };
  link: LinkStats;
  lastHeartbeatMs: number;
}
