import { AgentOrchestrationError } from "../errors.mjs";

function abstractMethod(type, method) {
  throw new AgentOrchestrationError(
    "AO_PLATFORM_METHOD_NOT_IMPLEMENTED",
    `${type} must implement ${method}().`,
  );
}

/** Strategy contract for resolving trusted host executables. */
export class ExecutableResolverStrategy {
  async findAll(_command, _options) { return abstractMethod(this.constructor.name, "findAll"); }
}

/** Strategy contract for owning, limiting, and terminating worker process trees. */
export class WorkerSupervisorStrategy {
  async isAlive(_worker) { return abstractMethod(this.constructor.name, "isAlive"); }
  async terminate(_worker) { return abstractMethod(this.constructor.name, "terminate"); }
  async launch(_context) { return abstractMethod(this.constructor.name, "launch"); }
  async attach(_context) { return abstractMethod(this.constructor.name, "attach"); }
  async probe(_context) { return abstractMethod(this.constructor.name, "probe"); }
  async runProbe(_context) { return abstractMethod(this.constructor.name, "runProbe"); }
}

/** Strategy contract for the provider containment boundary. */
export class ProviderSandboxStrategy {
  get requiredExecutables() { return []; }
  async probe() { return abstractMethod(this.constructor.name, "probe"); }
}

/**
 * Facade used by the orchestration service. It exposes one stable platform API
 * while keeping compatible strategy families together.
 */
export class PlatformRuntime {
  constructor({ id, hostPlatform, executableResolver, workerSupervisor, providerSandbox, metadata = {} }) {
    this.id = id;
    this.hostPlatform = hostPlatform;
    this.executableResolver = executableResolver;
    this.workerSupervisor = workerSupervisor;
    this.providerSandbox = providerSandbox;
    this.metadata = Object.freeze({ ...metadata });
    Object.freeze(this);
  }

  describe() {
    return {
      id: this.id,
      hostPlatform: this.hostPlatform,
      sandbox: this.providerSandbox.constructor.name,
      supervisor: this.workerSupervisor.constructor.name,
      executableResolver: this.executableResolver.constructor.name,
      ...this.metadata,
    };
  }
}

/** Abstract Factory contract for creating a compatible runtime family. */
export class PlatformRuntimeFactory {
  supports(_context) { return false; }
  async create(_context) { return abstractMethod(this.constructor.name, "create"); }
}
