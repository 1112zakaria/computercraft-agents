export const schedulerVersion = "0.1.0" as const;

export type TaskState = "BLOCKED" | "READY" | "RUNNING" | "PAUSED" | "DONE";

export interface SchedulableTask {
  readonly taskId: string;
  readonly state: TaskState;
  readonly priority: number;
  readonly requiredCapabilities?: readonly string[];
  readonly assignedWorkerId?: string | null;
}

export interface SchedulableWorker {
  readonly workerId: string;
  readonly online: boolean;
  readonly capabilities: readonly string[];
  readonly currentTaskId?: string | null;
}

export interface TaskAssignment {
  readonly taskId: string;
  readonly workerId: string;
}

export function selectReadyTasks(tasks: readonly SchedulableTask[]): SchedulableTask[] {
  return tasks
    .filter((task) => task.state === "READY")
    .sort(
      (left, right) => right.priority - left.priority || left.taskId.localeCompare(right.taskId),
    );
}

/**
 * Selects at most one task per available worker. The returned assignments are deterministic and
 * do not mutate the input, so the caller can persist/claim them transactionally.
 */
export function selectDispatchableTasks(
  tasks: readonly SchedulableTask[],
  workers: readonly SchedulableWorker[],
): readonly TaskAssignment[] {
  const availableWorkers = workers
    .filter((worker) => worker.online && !worker.currentTaskId)
    .sort((left, right) => left.workerId.localeCompare(right.workerId));
  const reservedWorkers = new Set<string>();
  const assignments: TaskAssignment[] = [];

  for (const task of selectReadyTasks(tasks)) {
    if (task.assignedWorkerId) continue;
    const required = new Set(task.requiredCapabilities ?? []);
    const worker = availableWorkers.find(
      (candidate) =>
        !reservedWorkers.has(candidate.workerId) &&
        [...required].every((capability) => candidate.capabilities.includes(capability)),
    );
    if (!worker) continue;
    reservedWorkers.add(worker.workerId);
    assignments.push({ taskId: task.taskId, workerId: worker.workerId });
  }
  return assignments;
}
