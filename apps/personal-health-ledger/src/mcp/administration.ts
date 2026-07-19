import { defineMcpServer } from '@theaiplatform/miniapp-sdk/mcp';
import type { MiniAppJsonValue } from '@theaiplatform/miniapp-sdk';
import { createAdministrationDraft } from '../administration-draft';

export const mcpServer = defineMcpServer({
  tools: {
    draft_administration: {
      description:
        'Prepare a structured Personal Health Ledger administration draft for human review. This tool never records or changes ledger data.',
      inputSchema: {
        type: 'object',
        properties: {
          itemId: { type: 'string' },
          lotId: { type: 'string' },
          plannedAt: { type: 'string' },
          actualAt: { type: 'string' },
          dose: { type: 'number', exclusiveMinimum: 0 },
          unit: { type: 'string' },
          route: { type: 'string' },
          site: { type: 'string' },
          status: {
            type: 'string',
            enum: ['taken', 'skipped', 'delayed', 'partial', 'uncertain'],
          },
          reason: { type: 'string' },
          reaction: { type: 'string' },
          instructionSource: { type: 'string' },
        },
        required: [
          'itemId',
          'actualAt',
          'dose',
          'unit',
          'route',
          'status',
          'instructionSource',
        ],
        additionalProperties: false,
      },
      execute(arguments_) {
        return createAdministrationDraft(arguments_) as unknown as MiniAppJsonValue;
      },
    },
  },
});
