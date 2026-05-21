import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getGmailClient } from '../../clients.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'deleteLabel',
    description:
      'Permanently deletes a custom Gmail label and removes it from any messages or threads it was applied to. The messages themselves are not deleted. System labels cannot be deleted.',
    parameters: z.object({
      id: z.string().describe('Label ID (from listLabels).'),
    }),
    execute: async (args, { log }) => {
      const gmail = await getGmailClient();
      log.info(`Deleting Gmail label ${args.id}`);

      try {
        await gmail.users.labels.delete({ userId: 'me', id: args.id });
        return JSON.stringify(
          { success: true, id: args.id, message: `Label ${args.id} deleted.` },
          null,
          2
        );
      } catch (error: any) {
        log.error(`Error deleting label: ${error.message || error}`);
        if (error.code === 404) throw new UserError(`Label ${args.id} not found.`);
        if (error.code === 400)
          throw new UserError(
            `Gmail rejected the delete: ${error.message || 'Bad request'}. System labels cannot be deleted.`
          );
        if (error.code === 403)
          throw new UserError('Permission denied. Confirm the gmail.labels or gmail.modify scope was granted.');
        throw new UserError(`Failed to delete label: ${error.message || 'Unknown error'}`);
      }
    },
  });
}
