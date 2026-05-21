import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getGmailClient } from '../../clients.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'getLabel',
    description:
      'Gets a single Gmail label by ID, including counts (messagesTotal, messagesUnread, threadsTotal, threadsUnread) and color, which listLabels does not return.',
    parameters: z.object({
      id: z.string().describe('Label ID (from listLabels).'),
    }),
    execute: async (args, { log }) => {
      const gmail = await getGmailClient();
      log.info(`Fetching Gmail label ${args.id}`);

      try {
        const response = await gmail.users.labels.get({ userId: 'me', id: args.id });
        return JSON.stringify(
          {
            id: response.data.id,
            name: response.data.name,
            type: response.data.type,
            messageListVisibility: response.data.messageListVisibility,
            labelListVisibility: response.data.labelListVisibility,
            messagesTotal: response.data.messagesTotal,
            messagesUnread: response.data.messagesUnread,
            threadsTotal: response.data.threadsTotal,
            threadsUnread: response.data.threadsUnread,
            color: response.data.color,
          },
          null,
          2
        );
      } catch (error: any) {
        log.error(`Error fetching label: ${error.message || error}`);
        if (error.code === 404) throw new UserError(`Label ${args.id} not found.`);
        if (error.code === 403)
          throw new UserError('Permission denied. Confirm the gmail.modify scope was granted.');
        throw new UserError(`Failed to fetch label: ${error.message || 'Unknown error'}`);
      }
    },
  });
}
