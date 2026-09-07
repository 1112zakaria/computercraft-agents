export const protocolVersion = 1 as const;

export interface ProtocolEnvelope {
  readonly protocolVersion: typeof protocolVersion;
  readonly messageId: string;
  readonly sentAt: string;
}
