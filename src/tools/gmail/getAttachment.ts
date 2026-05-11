import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getGmailClient } from '../../clients.js';

const TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/csv',
  'text/html',
  'text/xml',
  'application/json',
  'application/xml',
  'application/csv',
]);

export function register(server: FastMCP) {
  server.addTool({
    name: 'getAttachment',
    description:
      'Downloads an email attachment from Gmail. Use getMessage first to get the attachmentId. ' +
      'For text-based files (plain text, CSV, JSON, HTML) returns decoded content directly. ' +
      'For binary files (PDF, DOCX, images, etc.) returns base64-encoded content. ' +
      'Use saveAttachmentToDrive to file the attachment in Google Drive instead.',
    parameters: z.object({
      messageId: z.string().describe('Gmail message ID containing the attachment.'),
      attachmentId: z
        .string()
        .describe('Attachment ID from getMessage results (body.attachmentId).'),
      filename: z.string().optional().describe('Original filename — used to determine content type hint.'),
      mimeType: z
        .string()
        .optional()
        .describe('MIME type from getMessage results — determines whether content is returned as text or base64.'),
    }),
    execute: async (args, { log }) => {
      const gmail = await getGmailClient();
      log.info(`Downloading attachment ${args.attachmentId} from message ${args.messageId}`);

      try {
        const response = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId: args.messageId,
          id: args.attachmentId,
        });

        const data = response.data;
        if (!data.data) {
          throw new UserError('Attachment returned no data. It may be empty or inaccessible.');
        }

        // Gmail returns base64url — convert to standard base64
        const base64 = data.data.replace(/-/g, '+').replace(/_/g, '/');
        const sizeBytes = data.size ?? Buffer.from(base64, 'base64').length;

        const isText = args.mimeType ? TEXT_MIME_TYPES.has(args.mimeType) : false;

        if (isText) {
          const text = Buffer.from(base64, 'base64').toString('utf-8');
          return JSON.stringify(
            {
              filename: args.filename ?? null,
              mimeType: args.mimeType ?? 'text/plain',
              sizeBytes,
              encoding: 'text',
              content: text,
            },
            null,
            2
          );
        }

        return JSON.stringify(
          {
            filename: args.filename ?? null,
            mimeType: args.mimeType ?? 'application/octet-stream',
            sizeBytes,
            encoding: 'base64',
            content: base64,
          },
          null,
          2
        );
      } catch (error: any) {
        log.error(`Error downloading attachment: ${error.message || error}`);
        if (error.code === 404)
          throw new UserError(
            'Attachment not found. Verify the messageId and attachmentId are correct.'
          );
        if (error.code === 403)
          throw new UserError('Permission denied accessing this attachment.');
        throw new UserError(`Failed to download attachment: ${error.message || 'Unknown error'}`);
      }
    },
  });
}
