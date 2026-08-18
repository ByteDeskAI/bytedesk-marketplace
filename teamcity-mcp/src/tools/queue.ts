// Queue tools: list the build queue; full mode adds cancel/reorder/pause write ops.
import { z } from 'zod';
import { paginate } from '../teamcity/client.js';
import { FIELDS_HELP, handler, LOCATOR_HELP, type RegisterTools } from './util.js';

export const register: RegisterTools = (server, client, mode) => {
  server.registerTool(
    'list_queue',
    {
      description:
        'List builds waiting in the queue. Locator example: "buildType:(id:X),personal:true". ' +
        'Suggested fields: "count,build(id,number,buildTypeId,branchName,waitReason)".',
      inputSchema: {
        locator: z.string().optional().describe(LOCATOR_HELP),
        fields: z.string().optional().describe(FIELDS_HELP),
        pageSize: z.number().int().optional().describe('Items per page (default 100).'),
        maxPages: z.number().int().optional().describe('Max pages to fetch (default 1).'),
        all: z
          .boolean()
          .optional()
          .describe('Page through the whole collection (bounded by maxPages, hard cap 50).'),
      },
    },
    handler(async (args) => paginate(client, 'buildQueue', args)),
  );

  if (mode !== 'full') return;

  server.registerTool(
    'cancel_queued_build',
    {
      description: 'Remove a build from the queue by queue id or queue locator, e.g. "id:12345".',
      inputSchema: {
        build: z.string().describe('Queue id or queue locator, e.g. "12345" or "id:12345".'),
        comment: z.string().optional().describe('Cancellation comment.'),
      },
    },
    handler(async (args) =>
      client.post(`buildQueue/${args.build}`, { comment: args.comment ?? '', readdIntoQueue: false }),
    ),
  );

  server.registerTool(
    'move_queued_build_to_top',
    {
      description:
        'Move a queued build to the top by rewriting the whole queue order, keeping the ' +
        'relative order of the rest.',
      inputSchema: {
        queueId: z.number().int().describe('Numeric build id of the queued build to move to the top.'),
      },
    },
    handler(async (args) => {
      const current = await paginate<{ id: number }>(client, 'buildQueue', {
        fields: 'count,build(id)',
        all: true,
      });
      const rest = current.items.map((b) => b.id).filter((id) => id !== args.queueId);
      const newOrder = [args.queueId, ...rest];
      await client.put('buildQueue/order', { build: newOrder.map((id) => ({ id })) });
      return { success: true, newOrder };
    }),
  );

  server.registerTool(
    'set_queue_paused',
    {
      description: 'Pause or resume the whole build queue, optionally recording a reason.',
      inputSchema: {
        paused: z.boolean().describe('true to pause the queue, false to resume it.'),
        reason: z.string().optional().describe('Why the queue is paused.'),
      },
    },
    handler(async (args) =>
      client.put('buildQueue/pausedState', {
        paused: args.paused,
        ...(args.reason && { reason: args.reason }),
      }),
    ),
  );
};
