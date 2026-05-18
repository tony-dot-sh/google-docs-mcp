import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getGmailClient } from '../../clients.js';
import { fetchFreshAttachmentId, isStaleAttachmentError } from './helpers.js';

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
      'Downloads an email attachment from Gmail. ' +
      'attachmentId is optional — if omitted the tool re-fetches it internally using messageId + filename, ' +
      'which also avoids stale-token errors when calling across separate MCP turns. ' +
      'For text-based files (plain text, CSV, JSON, HTML) returns decoded content directly. ' +
      'For binary files (PDF, DOCX, images, etc.) returns base64-encoded content. ' +
      'Use saveAttachmentToDrive to file the attachment in Google Drive instead.',
    parameters: z.object({
      messageId: z.string().describe('Gmail message ID containing the attachment.'),
      attachmentId: z
        .string()
        .optional()
        .describe(
          'Attachment ID from getMessage results. Optional — if omitted the tool fetches a fresh one ' +
            'automatically using filename. Providing it saves one API call when called in the same MCP turn as getMessage.'
        ),
      filename: z
        .string()
        .optional()
        .describe(
          'Original filename from getMessage. Required when attachmentId is omitted, ' +
            'and used as a fallback to re-fetch a stale attachmentId.'
        ),
      mimeType: z
        .string()
        .optional()
        .describe(
          'MIME type from getMessage results — determines whether content is returned as text or base64.'
        ),
    }),
    execute: async (args, { log }) => {
      if (!args.attachmentId && !args.filename) {
        throw new UserError('Provide either attachmentId or filename (or both).');
      }

      const gmail = await getGmailClient();
      log.info(`Downloading attachment from message ${args.messageId}`);

      try {
        let attachmentId =
          args.attachmentId ??
          (await fetchFreshAttachmentId(gmail, args.messageId, args.filename!));

        let rawData: string;
        try {
          const res = await gmail.users.messages.attachments.get({
            userId: 'me',
            messageId: args.messageId,
            id: attachmentId,
          });
          if (!res.data.data) throw new UserError('Attachment returned no data. It may be empty or inaccessible.');
          rawData = res.data.data;
        } catch (err: any) {
          if (isStaleAttachmentError(err) && args.filename) {
            log.warn(`attachmentId stale (${err.message}); re-fetching fresh ID and retrying…`);
            attachmentId = await fetchFreshAttachmentId(gmail, args.messageId, args.filename);
            const res = await gmail.users.messages.attachments.get({
              userId: 'me',
              messageId: args.messageId,
              id: attachmentId,
            });
            if (!res.data.data) throw new UserError('Attachment returned no data after retry.');
            rawData = res.data.data;
          } else {
            throw err;
          }
        }

        // Gmail returns base64url — convert to standard base64
        const base64 = rawData.replace(/-/g, '+').replace(/_/g, '/');
        const sizeBytes = Buffer.from(base64, 'base64').length;
        const isText = args.mimeType ? TEXT_MIME_TYPES.has(args.mimeType) : false;

        if (isText) {
          return JSON.stringify(
            {
              filename: args.filename ?? null,
              mimeType: args.mimeType ?? 'text/plain',
              sizeBytes,
              encoding: 'text',
              content: Buffer.from(base64, 'base64').toString('utf-8'),
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
        if (error instanceof UserError) throw error;
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
