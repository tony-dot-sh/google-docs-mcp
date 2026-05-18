import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import crypto from 'node:crypto';
import { getDriveClient, getGmailClient } from '../../clients.js';
import { encodeHeader, encodeRawMessage } from './helpers.js';
import { WORKSPACE_EXPORT_DEFAULTS } from '../drive/downloadFile.js';

const WORKSPACE_EMAIL_EXPORT_OVERRIDES: Record<string, string> = {
  'text/markdown': 'application/pdf',
  'text/plain': 'application/pdf',
  'text/csv': 'text/csv',
};

const EXPORT_EXTENSIONS: Record<string, string> = {
  'application/pdf': '.pdf',
  'text/csv': '.csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
};

const DriveAttachment = z.object({
  fileId: z.string().describe('Google Drive file ID to attach.'),
  exportMimeType: z
    .string()
    .optional()
    .describe(
      'For Google Workspace files (Docs, Sheets, Slides), the export MIME type. ' +
        'Defaults to application/pdf for Docs and Slides, text/csv for Sheets.'
    ),
});

const RawAttachment = z.object({
  filename: z.string().describe('Filename for the attachment, including extension.'),
  mimeType: z.string().describe('MIME type of the content (e.g. "application/pdf").'),
  data: z.string().describe('Base64-encoded file content.'),
});

export function register(server: FastMCP) {
  server.addTool({
    name: 'createDraftWithAttachments',
    description:
      'Creates a Gmail draft that includes file attachments. Attachments can be Google Drive files (by fileId — Workspace files are exported to PDF by default) or raw base64-encoded data. The draft is saved to the Drafts folder for review before sending.',
    parameters: z.object({
      to: z.array(z.string()).min(1).describe('Recipient email addresses.'),
      subject: z.string().describe('Email subject line.'),
      body: z.string().describe('Plain-text body of the email.'),
      cc: z.array(z.string()).optional().describe('Optional CC recipients.'),
      bcc: z.array(z.string()).optional().describe('Optional BCC recipients.'),
      attachments: z
        .array(z.union([DriveAttachment, RawAttachment]))
        .min(1)
        .describe(
          'Attachments to include. Each entry is either a Drive file reference (fileId) or raw data (filename + mimeType + base64 data).'
        ),
    }),
    execute: async (args, { log }) => {
      const [gmail, drive] = await Promise.all([getGmailClient(), getDriveClient()]);

      log.info(
        `Creating draft with ${args.attachments.length} attachment(s) to ${args.to.join(', ')}`
      );

      // Resolve all attachments into in-memory buffers
      const resolved: Array<{ filename: string; mimeType: string; data: Buffer }> = [];

      for (const att of args.attachments) {
        if ('fileId' in att) {
          const metaRes = await drive.files.get({
            fileId: att.fileId,
            fields: 'name,mimeType',
            supportsAllDrives: true,
          });
          const originalName = metaRes.data.name || 'attachment';
          const originalMime = metaRes.data.mimeType || 'application/octet-stream';
          const isWorkspace = originalMime.startsWith('application/vnd.google-apps.');

          if (isWorkspace) {
            const defaultExport = WORKSPACE_EXPORT_DEFAULTS[originalMime] || 'application/pdf';
            const exportMime =
              att.exportMimeType ||
              WORKSPACE_EMAIL_EXPORT_OVERRIDES[defaultExport] ||
              defaultExport;
            log.info(`Exporting Drive Workspace file "${originalName}" as ${exportMime}`);
            const res = await drive.files.export(
              { fileId: att.fileId, mimeType: exportMime },
              { responseType: 'arraybuffer' }
            );
            const baseName = originalName.replace(/\.[^/.]+$/, '');
            const ext = EXPORT_EXTENSIONS[exportMime] || '';
            resolved.push({
              filename: baseName + ext,
              mimeType: exportMime,
              data: Buffer.from(res.data as ArrayBuffer),
            });
          } else {
            log.info(`Downloading Drive file "${originalName}"`);
            const res = await drive.files.get(
              { fileId: att.fileId, alt: 'media', supportsAllDrives: true },
              { responseType: 'arraybuffer' }
            );
            resolved.push({
              filename: originalName,
              mimeType: originalMime,
              data: Buffer.from(res.data as ArrayBuffer),
            });
          }
        } else {
          resolved.push({
            filename: att.filename,
            mimeType: att.mimeType,
            data: Buffer.from(att.data, 'base64'),
          });
        }
      }

      // Build multipart/mixed MIME message
      const boundary = `mcp_${crypto.randomBytes(16).toString('hex')}`;
      const parts: string[] = [];

      // Headers
      parts.push(`To: ${args.to.join(', ')}`);
      if (args.cc?.length) parts.push(`Cc: ${args.cc.join(', ')}`);
      if (args.bcc?.length) parts.push(`Bcc: ${args.bcc.join(', ')}`);
      parts.push(`Subject: ${encodeHeader(args.subject)}`);
      parts.push('MIME-Version: 1.0');
      parts.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
      parts.push('');

      // Text body part
      parts.push(`--${boundary}`);
      parts.push('Content-Type: text/plain; charset="UTF-8"');
      parts.push('Content-Transfer-Encoding: 8bit');
      parts.push('');
      parts.push(args.body);
      parts.push('');

      // Attachment parts
      for (const att of resolved) {
        const encodedName = encodeHeader(att.filename);
        parts.push(`--${boundary}`);
        parts.push(`Content-Type: ${att.mimeType}; name="${encodedName}"`);
        parts.push(`Content-Disposition: attachment; filename="${encodedName}"`);
        parts.push('Content-Transfer-Encoding: base64');
        parts.push('');
        // RFC 2045: base64 lines must be at most 76 characters
        const b64 = att.data.toString('base64');
        for (let i = 0; i < b64.length; i += 76) {
          parts.push(b64.slice(i, i + 76));
        }
        parts.push('');
      }

      parts.push(`--${boundary}--`);

      const raw = encodeRawMessage(parts.join('\r\n'));

      try {
        const response = await gmail.users.drafts.create({
          userId: 'me',
          requestBody: { message: { raw } },
        });

        return JSON.stringify(
          {
            success: true,
            draftId: response.data.id,
            messageId: response.data.message?.id,
            to: args.to,
            subject: args.subject,
            attachments: resolved.map((a) => ({
              filename: a.filename,
              mimeType: a.mimeType,
              sizeBytes: a.data.length,
            })),
            message: `Draft created with ${resolved.length} attachment(s). Use sendDraft with draftId="${response.data.id}" to send it.`,
          },
          null,
          2
        );
      } catch (error: any) {
        log.error(`Error creating draft with attachments: ${error.message || error}`);
        if (error.code === 401)
          throw new UserError(
            'Gmail authorization failed. Re-authorize to grant the gmail.modify scope.'
          );
        if (error.code === 403)
          throw new UserError('Permission denied. Confirm the gmail.modify scope was granted.');
        if (error.code === 400)
          throw new UserError(`Gmail rejected the draft: ${error.message || 'Bad request'}`);
        throw new UserError(
          `Failed to create draft with attachments: ${error.message || 'Unknown error'}`
        );
      }
    },
  });
}
