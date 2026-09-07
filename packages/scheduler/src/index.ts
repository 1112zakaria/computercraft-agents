export const schedulerVersion = "0.1.0" as const;

export type TaskState = "BLOCKED" | "READY" | "RUNNING" | "PAUSED" | "DONE";

export interface SchedulableTask {
  readonly taskId: string;
  readonly state: TaskState;
  readonly priority: number;
}

export function selectReadyTasks(tasks: readonly SchedulableTask[]): SchedulableTask[] {
  return tasks
    .filter((task) => task.state === "READY")
    .sort((left, right) => right.priority - left.priority);
}
