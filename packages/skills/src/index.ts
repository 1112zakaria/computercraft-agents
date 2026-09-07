export const skillsVersion = "0.1.0" as const;

export interface SkillDefinition {
  readonly name: string;
  readonly destructive: boolean;
  readonly description: string;
}
