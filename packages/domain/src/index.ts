export const domainVersion = "0.1.0" as const;

export type WorkerStatus = "ONLINE" | "OFFLINE" | "STOPPED";

export interface WorkerSnapshot {
  readonly workerId: string;
  readonly computerId: number;
  readonly status: WorkerStatus;
  readonly lastHeartbeatAt: string | null;
}
