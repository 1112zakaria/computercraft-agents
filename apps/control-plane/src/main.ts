export const controlPlaneName = "computercraft-agents-control-plane" as const;

export function describeControlPlane(): string {
  return `${controlPlaneName} bootstrap`;
}
