import { invariant } from "../errors.mjs";
import { LinuxRuntimeFactory } from "./linux-runtime.mjs";
import { WindowsNativeRuntimeFactory } from "./windows-native-runtime.mjs";

const factories = [new WindowsNativeRuntimeFactory(), new LinuxRuntimeFactory()];

export function registerPlatformRuntimeFactory(factory) {
  factories.unshift(factory);
}

/** Abstract Factory selector. A backend is selected once per host process. */
export function createPlatformRuntime(context = {}) {
  const requested = context.backend || process.env.AGENT_ORCHESTRATION_RUNTIME_BACKEND;
  const factory = factories.find((candidate) => candidate.supports({ ...context, backend: requested }));
  invariant(factory, "AO_PLATFORM_RUNTIME_UNAVAILABLE", "No secure orchestration runtime is available for this platform.", { platform: context.platform || process.platform, requested });
  return factory.create({ ...context, backend: requested });
}
