export interface ReadinessCheck {
  readonly name: string;
  /** Lança erro se a dependência estiver inacessível. */
  check(): Promise<void>;
}

export const READINESS_CHECKS = Symbol('READINESS_CHECKS');