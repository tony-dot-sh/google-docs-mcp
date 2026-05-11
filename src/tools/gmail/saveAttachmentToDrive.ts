import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { Readable } from 'stream';
import { getGmailClient, getDriveClient } from '../../clients.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'saveAttachmentToDrive',
    description:
      'Downloads a Gmail attachment and saves it directly to a Google Drive folder in one step. ' +
      'Use getMessage first to get the messageId and attachmentId. ' +
      'Ideal for filing transaction documents (inspection reports, disclosures, closing docs) into the correct Drive folder.',
    parameters: z.object({
      messageId: z.string().describe('Gmail message ID containing the attachment.'),
      attachmentId: z
        .string()
        .describe('Attachment ID from getMessage results (body.attachmentId).'),
      filename: z.string().describe('Filename to use in Drive (e.g. "Inspection Report - 123 Main St.pdf").'),
      mimeType: z
        .string()
        .default('application/octet-stream')
        .describe('MIME type from getMessage results (e.g. "application/pdf").'),
      folderId: z
        .string()
        .describe(
          'Google Drive folder ID where the file should be saved. ' +
          'For transaction folders, find the folder ID from listFolderContents or getFolderInfo.'
        ),
    }),
    execute: async (args, { log }) => {
      const gmail = await getGmailClient();
      const drive = await getDriveClient();

      log.info(
        `Downloading attachment ${args.attachmentId} from message ${args.messageId} → Drive folder ${args.folderId}`
      );

      try {
        // Step 1: fetch attachment bytes from Gmail
        const attachmentResponse = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId: args.messageId,
          id: args.attachmentId,
        });

        const data = attachmentResponse.data;
        if (!data.data) {
          throw new UserError('Attachment returned no data. It may be empty or inaccessible.');
        }

        // Gmail uses base64url — decode to raw bytes
        const base64url = data.data;
        const buffer = Buffer.from(base64url.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
        const readable = Readable.from(buffer);

        log.info(`Attachment decoded (${buffer.length} bytes), uploading to Drive as "${args.filename}"`);

        // Step 2: upload to Drive via multipart upload
        const uploadResponse = await drive.files.create({
          requestBody: {
            name: args.filename,
            mimeType: args.mimeType,
            parents: [args.folderId],
          },
          media: {
            mimeType: args.mimeType,
            body: readable,
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
