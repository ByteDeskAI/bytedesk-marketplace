export class AgentOrchestrationError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "AgentOrchestrationError";
    this.code = code;
    this.details = details;
  }
}

export function invariant(condition, code, message, details = undefined) {
  if (!condition) {
    throw new AgentOrchestrationError(code, message, details);
  }
}

export function serializeError(error) {
  return {
    code: error?.code ?? "AO_INTERNAL",
    message: error instanceof Error ? error.message : String(error),
    ...(error?.details === undefined ? {} : { details: error.details }),
  };
}
