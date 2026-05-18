import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { Readable } from 'stream';
import { getGmailClient, getDriveClient } from '../../clients.js';
import { fetchFreshAttachmentId, isStaleAttachmentError } from './helpers.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'saveAttachmentToDrive',
    description:
      'Downloads a Gmail attachment and saves it directly to a Google Drive folder in one step. ' +
      'Use getMessage first to get the messageId and attachmentId. ' +
      'attachmentId is optional — if omitted the tool re-fetches it internally using messageId + filename, ' +
      'which also avoids stale-token errors when calling across separate MCP turns. ' +
      'Ideal for filing transaction documents (inspection reports, disclosures, closing docs) into the correct Drive folder.',
    parameters: z.object({
      messageId: z.string().describe('Gmail message ID containing the attachment.'),
      filename: z
        .string()
        .describe(
          'Filename to use in Drive (e.g. "Inspection Report - 123 Main St.pdf"). ' +
            'Must match the filename from getMessage exactly when attachmentId is omitted.'
        ),
      mimeType: z
        .string()
        .default('application/octet-stream')
        .describe('MIME type from getMessage results (e.g. "application/pdf").'),
      folderId: z
        .string()
        .describe(
          'Google Drive folder ID where the file should be saved. ' +
            'Find the folder ID from listFolderContents or getFolderInfo.'
        ),
      attachmentId: z
        .string()
        .optional()
        .describe(
          'Attachment ID from getMessage results. Optional — if omitted the tool fetches a fresh one ' +
            'automatically. Providing it saves one API call when called in the same MCP turn as getMessage.'
        ),
    }),
    execute: async (args, { log }) => {
      const gmail = await getGmailClient();
      const drive = await getDriveClient();

      log.info(
        `Saving attachment "${args.filename}" from message ${args.messageId} → Drive folder ${args.folderId}`
      );

      try {
        // Resolve attachmentId — use provided value or fetch fresh from the message.
        // Fetching fresh here also guarantees the ID is valid for the current OAuth
        // session, avoiding stale-token errors that occur when the access token
        // refreshed between the getMessage call and this call.
        let attachmentId =
          args.attachmentId ?? (await fetchFreshAttachmentId(gmail, args.messageId, args.filename));

        let attachmentData: string;
        try {
          const res = await gmail.users.messages.attachments.get({
            userId: 'me',
            messageId: args.messageId,
            id: attachmentId,
          });
          if (!res.data.data) throw new UserError('Attachment returned no data. It may be empty or inaccessible.');
          attachmentData = res.data.data;
        } catch (err: any) {
          if (isStaleAttachmentError(err)) {
            // Token was stale — re-fetch a fresh attachmentId and retry once
            log.warn(`attachmentId stale (${err.message}); re-fetching fresh ID and retrying…`);
            attachmentId = await fetchFreshAttachmentId(gmail, args.messageId, args.filename);
            const res = await gmail.users.messages.attachments.get({
              userId: 'me',
              messageId: args.messageId,
              id: attachmentId,
            });
            if (!res.data.data) throw new UserError('Attachment returned no data after retry.');
            attachmentData = res.data.data;
          } else {
            throw err;
          }
        }

        // Gmail uses base64url — decode to raw bytes
        const buffer = Buffer.from(attachmentData.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
        log.info(`Attachment decoded (${buffer.length} bytes), uploading to Drive as "${args.filename}"`);

        const uploadResponse = await drive.files.create({
          requestBody: {
            name: args.filename,
            mimeType: args.mimeType,
            parents: [args.folderId],
          },
          media: {
            mimeType: args.mimeType,
            body: Readable.from(buffer),
          },
          fields: 'id,name,webViewLink,size',
          supportsAllDrives: true,
        });

        const file = uploadResponse.data;
        log.info(`Saved to Drive: ${file.id}`);

        return JSON.stringify(
          {
            id: file.id,
            name: file.name,
            url: file.webViewLink,
            sizeBytes: buffer.length,
            folderId: args.folderId,
          },
          null,
          2
        );
      } catch (error: any) {
        log.error(`Error saving attachment to Drive: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        if (error.code === 404)
          throw new UserError(
            'Message, attachment, or Drive folder not found. Verify all IDs are correct.'
          );
        if (error.code === 403)
          throw new UserError(
            'Permission denied. Check access to the Gmail message and the Drive folder.'
          );
        throw new UserError(
          `Failed to save attachment to Drive: ${error.message || 'Unknown error'}`
        );
      }
    },
  });
}
