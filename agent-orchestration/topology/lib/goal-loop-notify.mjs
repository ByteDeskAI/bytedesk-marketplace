// Mail owns the instruction. This one-shot safe bell only wakes its registered
// recipient; a successful key submission is never a recipient acknowledgement.
import { homedir } from 'node:os';
import { readLeadRegistration } from './lead.mjs';
import { adapterFor, loadAdapters, providerDirs } from './providers.mjs';
import { composerFormat, ringCapability, wakeForProbe } from './delivery.mjs';
import { tmuxFailureTrigger } from './launch.mjs';
import { incarnationOf } from './incarnation.mjs';
import { withServer } from './tmux.mjs';
import { shellQuote } from './util.mjs';
import { goalLoopDigest } from './goal-loop-contract.mjs';

export async function notifyGoalObligation({ loop, ...options }) {
  const held = reason => ({ state: 'held', reason });
  const registration = await (options.readLead ?? readLeadRegistration)({ ...options, consumer: loop.consumer });
  const record = registration?.record, binding = incarnationOf(record?.binding);
  if (record?.agent_id !== loop.leadId || record?.repo_id !== loop.repository.id || !binding || !record?.pane) return held('The admitted lead has no matching registered pane incarnation.');
  const bindingHash = goalLoopDigest(binding), previous = loop.obligation.notification;
  if (previous?.state === 'sent' && previous.bindingHash === bindingHash) return previous;
  const adapters = await (options.loadAdapters ?? loadAdapters)(providerDirs({ consumer: loop.consumer, home: options.home ?? homedir(), pluginRoot: options.pluginRoot, env: options.env }));
  const adapter = adapterFor({ cli: record.provider, model: null, args: [], skills: [] }, adapters);
  if (ringCapability(adapter) !== 'supported') return held('The lead provider has no measured safe composer.');
  const text = `[ao] Goal obligation ${loop.obligation.id} is durable. Read ao-topology mailbox inbox --consumer ${shellQuote(loop.consumer)} --agent ${shellQuote(loop.leadId)}, then follow this exact obligation and report through ao-topology goal-loop report. Do not repeat an already reported obligation.`;
  const result = await withServer(binding.serverKey, () => (options.wake ?? wakeForProbe)({ pane: record.pane, adapter, binding, format: composerFormat(adapter, tmuxFailureTrigger(adapter)), text }));
  return result.rang ? { state: 'sent', bindingHash } : held(result.reason ?? 'The lead composer cannot safely receive a pointer.');
}
