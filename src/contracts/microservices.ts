/**
 * MAVLink microservice client seams (impl 02 §2.4; spec plan/03 §3.4). FROZEN.
 * All async ops accept an AbortSignal and emit progress where noted.
 */

export interface CommandClient {
  send(
    cmd: number,
    params: number[],
    opts?: { int?: boolean; frame?: number; confirm?: number; signal?: AbortSignal },
  ): Promise<{ result: number; progressPct?: number }>;
  arm(arm: boolean, force?: boolean): Promise<void>;
  setMode(mode: string): Promise<void>;
  takeoff(altM: number): Promise<void>;
  land(): Promise<void>;
  rtl(): Promise<void>;
  guidedGoto(lat: number, lon: number, altM: number): Promise<void>;
  setRoi(lat: number, lon: number, altM: number): Promise<void>;
  clearRoi(): Promise<void>;
  setCurrentWp(seq: number): Promise<void>;
}

export interface ParamMeta {
  units?: string;
  min?: number;
  max?: number;
  increment?: number;
  values?: Record<number, string>;
  bitmask?: Record<number, string>;
  rebootRequired?: boolean;
  description?: string;
}

export interface Param {
  name: string;
  value: number;
  /** MAV_PARAM_TYPE */
  type: number;
  meta?: ParamMeta;
}

export interface ParamClient {
  fetchAll(
    onProgress?: (done: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<Param[]>;
  get(name: string): Param | undefined;
  set(name: string, value: number): Promise<void>;
  onChange(cb: (p: Param) => void): () => void;
}

export type MissionType = 'mission' | 'fence' | 'rally';

export interface MissionItem {
  seq: number;
  frame: number;
  command: number;
  current: number;
  autocontinue: number;
  params: [number, number, number, number];
  x: number;
  y: number;
  z: number;
}

export interface Mission {
  type: MissionType;
  items: MissionItem[];
}

export interface MissionClient {
  download(
    type: MissionType,
    onProgress?: (i: number, n: number) => void,
    signal?: AbortSignal,
  ): Promise<Mission>;
  upload(
    m: Mission,
    opts?: { verify?: boolean; onProgress?: (i: number, n: number) => void; signal?: AbortSignal },
  ): Promise<void>;
  clear(type: MissionType): Promise<void>;
  setCurrent(seq: number): Promise<void>;
  onCurrent(cb: (seq: number) => void): () => void;
  onReached(cb: (seq: number) => void): () => void;
}

export interface FtpEntry {
  name: string;
  size: number;
  dir: boolean;
}

export interface FtpClient {
  list(path: string): Promise<FtpEntry[]>;
  read(
    path: string,
    onProgress?: (done: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<Uint8Array>;
  write(path: string, data: Uint8Array, signal?: AbortSignal): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface LogEntry {
  id: number;
  sizeBytes: number;
  utc?: number;
}

export interface LogClient {
  list(signal?: AbortSignal): Promise<LogEntry[]>;
  download(
    id: number,
    onProgress?: (done: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<Blob>;
  erase(): Promise<void>;
}

export interface CalibrationClient {
  accel6Point(step: (face: string) => Promise<void>, signal?: AbortSignal): Promise<void>;
  level(signal?: AbortSignal): Promise<void>;
  compass(
    onProgress: (pct: number, fitness?: number) => void,
    signal?: AbortSignal,
  ): Promise<{ offsets: number[] }>;
  gyro(signal?: AbortSignal): Promise<void>;
  radio(onChannels: (ch: number[]) => void, signal?: AbortSignal): Promise<void>;
}
