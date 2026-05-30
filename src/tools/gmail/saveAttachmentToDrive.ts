import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getGmailClient, getDriveClient, getAuthClient } from '../../clients.js';
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

        const auth = await getAuthClient();

        // Fetch raw bytes directly via the REST endpoint — avoids the base64 JSON
        // response from the SDK method, so nothing is buffered in memory.
        const getRawStream = async (id: string) => {
          const url = `https://www.googleapis.com/gmail/v1/users/me/messages/${args.messageId}/attachments/${id}?alt=media`;
          const res = await auth.request<NodeJS.ReadableStream>({ url, responseType: 'stream' });
          return res.data;
        };

        let byteStream: NodeJS.ReadableStream;
        try {
          byteStream = await getRawStream(attachmentId);
        } catch (err: any) {
          if (isStaleAttachmentError(err)) {
            log.warn(`attachmentId stale (${err.message}); re-fetching fresh ID and retrying…`);
            attachmentId = await fetchFreshAttachmentId(gmail, args.messageId, args.filename);
            byteStream = await getRawStream(attachmentId);
          } else {
            throw err;
          }
        }

        log.info(`Streaming attachment to Drive as "${args.filename}"`);

        const uploadResponse = await drive.files.create({
          requestBody: {
            name: args.filename,
            mimeType: args.mimeType,
            parents: [args.folderId],
          },
          media: {
            mimeType: args.mimeType,
            body: byteStream,
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
            sizeBytes: file.size,
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
