export interface ControlPlaneConfig {
  readonly nodeEnv: string;
  readonly host: string;
  readonly port: number;
  readonly databaseUrl: string;
  readonly gatewayBearerSecret: string;
  readonly adminSecret: string;
  readonly gatewayTimeoutSeconds: number;
  readonly workerTimeoutSeconds: number;
  readonly maxHttpBodyBytes: number;
  readonly staleCheckIntervalSeconds: number;
  readonly schedulerEnabled: boolean;
  readonly schedulerIntervalSeconds: number;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function booleanValue(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  if (raw.trim().toLowerCase() === "true") return true;
  if (raw.trim().toLowerCase() === "false") return false;
  throw new Error(`${name} must be true or false`);
}

export function loadConfig(): ControlPlaneConfig {
  return {
    nodeEnv: process.env.NODE_ENV ?? "development",
    host: process.env.CONTROL_PLANE_HOST ?? "127.0.0.1",
    port: positiveInteger("CONTROL_PLANE_PORT", 8787),
    databaseUrl: required("DATABASE_URL"),
    gatewayBearerSecret: required("GATEWAY_BEARER_SECRET"),
    adminSecret: required("CONTROL_PLANE_ADMIN_SECRET"),
    gatewayTimeoutSeconds: positiveInteger("GATEWAY_TIMEOUT_SECONDS", 45),
    workerTimeoutSeconds: positiveInteger("WORKER_TIMEOUT_SECONDS", 45),
    maxHttpBodyBytes: positiveInteger("MAX_HTTP_BODY_BYTES", 1_048_576),
    staleCheckIntervalSeconds: positiveInteger("STALE_CHECK_INTERVAL_SECONDS", 10),
    schedulerEnabled: booleanValue("SCHEDULER_ENABLED", false),
    schedulerIntervalSeconds: positiveInteger("SCHEDULER_INTERVAL_SECONDS", 10),
  };
}
