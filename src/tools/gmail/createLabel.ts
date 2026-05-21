import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getGmailClient } from '../../clients.js';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function register(server: FastMCP) {
  server.addTool({
    name: 'createLabel',
    description:
      'Creates a new custom Gmail label. Returns the new label ID, which can be used with modifyMessageLabels or as a labelIds filter in listMessages. Use a slash in the name to nest (e.g. "Clients/Acme").',
    parameters: z.object({
      name: z.string().min(1).describe('Label name. Use "/" to nest, e.g. "Clients/Acme".'),
      messageListVisibility: z
        .enum(['show', 'hide'])
        .optional()
        .describe('Whether the label appears in the message list. Defaults to "show".'),
      labelListVisibility: z
        .enum(['labelShow', 'labelShowIfUnread', 'labelHide'])
        .optional()
        .describe('Whether the label appears in the sidebar. Defaults to "labelShow".'),
      textColor: z
        .string()
        .regex(HEX_COLOR)
        .optional()
        .describe('Text color as #RRGGBB. Must be one of the Gmail-supported palette colors.'),
      backgroundColor: z
        .string()
        .regex(HEX_COLOR)
        .optional()
        .describe(
          'Background color as #RRGGBB. Must be one of the Gmail-supported palette colors. Both textColor and backgroundColor must be provided together.'
        ),
    }),
    execute: async (args, { log }) => {
      const gmail = await getGmailClient();
      log.info(`Creating Gmail label "${args.name}"`);

      if ((args.textColor && !args.backgroundColor) || (!args.textColor && args.backgroundColor)) {
        throw new UserError('Provide both textColor and backgroundColor, or neither.');
      }

      try {
        const response = await gmail.users.labels.create({
          userId: 'me',
          requestBody: {
            name: args.name,
            messageListVisibility: args.messageListVisibility,
            labelListVisibility: args.labelListVisibility,
            color:
              args.textColor && args.backgroundColor
                ? { textColor: args.textColor, backgroundColor: args.backgroundColor }
                : undefined,
          },
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
        log.error(`Error creating label: ${error.message || error}`);
        if (error.code === 409 || /already exists/i.test(error.message || ''))
          throw new UserError(`A label named "${args.name}" already exists.`);
        if (error.code === 400)
          throw new UserError(
            `Gmail rejected the label: ${error.message || 'Bad request'}. Color values must come from Gmail's supported palette.`
          );
        if (error.code === 403)
          throw new UserError('Permission denied. Confirm the gmail.labels or gmail.modify scope was granted.');
        throw new UserError(`Failed to create label: ${error.message || 'Unknown error'}`);
      }
    },
  });
}
