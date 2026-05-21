import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getGmailClient } from '../../clients.js';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function register(server: FastMCP) {
  server.addTool({
    name: 'updateLabel',
    description:
      'Updates a Gmail label. Only the provided fields are changed (PATCH semantics). Use this to rename, change visibility, or change color. System labels (INBOX, SENT, etc.) cannot be modified.',
    parameters: z
      .object({
        id: z.string().describe('Label ID (from listLabels).'),
        name: z.string().min(1).optional().describe('New label name. Use "/" to nest.'),
        messageListVisibility: z.enum(['show', 'hide']).optional(),
        labelListVisibility: z.enum(['labelShow', 'labelShowIfUnread', 'labelHide']).optional(),
        textColor: z
          .string()
          .regex(HEX_COLOR)
          .optional()
          .describe('Text color as #RRGGBB. Must be one of Gmail\'s supported palette colors.'),
        backgroundColor: z
          .string()
          .regex(HEX_COLOR)
          .optional()
          .describe(
            'Background color as #RRGGBB. Must be from Gmail\'s palette. textColor and backgroundColor must be provided together.'
          ),
      })
      .refine(
        (v) =>
          v.name !== undefined ||
          v.messageListVisibility !== undefined ||
          v.labelListVisibility !== undefined ||
          v.textColor !== undefined ||
          v.backgroundColor !== undefined,
        { message: 'Provide at least one field to update.' }
      ),
    execute: async (args, { log }) => {
      const gmail = await getGmailClient();
      log.info(`Updating Gmail label ${args.id}`);

      if ((args.textColor && !args.backgroundColor) || (!args.textColor && args.backgroundColor)) {
        throw new UserError('Provide both textColor and backgroundColor, or neither.');
      }

      const requestBody: Record<string, unknown> = {};
      if (args.name !== undefined) requestBody.name = args.name;
      if (args.messageListVisibility !== undefined)
        requestBody.messageListVisibility = args.messageListVisibility;
      if (args.labelListVisibility !== undefined)
        requestBody.labelListVisibility = args.labelListVisibility;
      if (args.textColor && args.backgroundColor)
        requestBody.color = { textColor: args.textColor, backgroundColor: args.backgroundColor };

      try {
        const response = await gmail.users.labels.patch({
          userId: 'me',
          id: args.id,
          requestBody,
        });

        return JSON.stringify(
          {
            success: true,
            id: response.data.id,
            name: response.data.name,
            type: response.data.type,
            messageListVisibility: response.data.messageListVisibility,
            labelListVisibility: response.data.labelListVisibility,
            color: response.data.color,
          },
          null,
          2
        );
      } catch (error: any) {
        log.error(`Error updating label: ${error.message || error}`);
        if (error.code === 404) throw new UserError(`Label ${args.id} not found.`);
        if (error.code === 400)
          throw new UserError(
            `Gmail rejected the update: ${error.message || 'Bad request'}. System labels cannot be modified and color values must come from Gmail's palette.`
          );
        if (error.code === 403)
          throw new UserError('Permission denied. Confirm the gmail.labels or gmail.modify scope was granted.');
        throw new UserError(`Failed to update label: ${error.message || 'Unknown error'}`);
      }
    },
  });
}
