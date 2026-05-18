import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDriveClient } from '../../clients.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'setFilePermission',
    description:
      'Grants sharing permissions on a Google Drive file or folder. Use this to share documents with specific users, groups, a whole domain, or anyone with the link. Maps to drive.permissions.create.',
    parameters: z.object({
      fileId: z.string().describe('ID of the Drive file or folder to share.'),
      role: z
        .enum(['reader', 'writer', 'commenter'])
        .describe('Access level to grant: reader (view), commenter (view + comment), or writer (edit).'),
      type: z
        .enum(['user', 'group', 'domain', 'anyone'])
        .describe(
          'Who to share with: user (single email), group (Google Group email), domain (entire domain), or anyone (anyone with the link).'
        ),
      emailAddress: z
        .string()
        .optional()
        .describe('Email address of the recipient. Required when type is "user" or "group".'),
      domain: z
        .string()
        .optional()
        .describe('Domain to grant access to (e.g. "example.com"). Required when type is "domain".'),
      sendNotificationEmail: z
        .boolean()
        .optional()
        .default(false)
        .describe('Whether to send a sharing notification email to the recipient. Defaults to false.'),
    }),
    execute: async (args, { log }) => {
      if ((args.type === 'user' || args.type === 'group') && !args.emailAddress) {
        throw new UserError(`emailAddress is required when type is "${args.type}".`);
      }
      if (args.type === 'domain' && !args.domain) {
        throw new UserError('domain is required when type is "domain".');
      }

      const drive = await getDriveClient();
      log.info(`Granting ${args.role} to ${args.type} on file ${args.fileId}`);

      try {
        const permRes = await drive.permissions.create({
          fileId: args.fileId,
          supportsAllDrives: true,
          sendNotificationEmail: args.sendNotificationEmail ?? false,
          fields: 'id,role,type,emailAddress',
          requestBody: {
            role: args.role,
            type: args.type,
            ...(args.emailAddress ? { emailAddress: args.emailAddress } : {}),
            ...(args.domain ? { domain: args.domain } : {}),
          },
        });

        const fileRes = await drive.files.get({
          fileId: args.fileId,
          fields: 'name,webViewLink',
          supportsAllDrives: true,
        });

        return JSON.stringify(
          {
            permissionId: permRes.data.id,
            role: permRes.data.role,
            type: permRes.data.type,
            ...(permRes.data.emailAddress ? { emailAddress: permRes.data.emailAddress } : {}),
            fileId: args.fileId,
            fileName: fileRes.data.name,
            sharingUrl: fileRes.data.webViewLink,
          },
          null,
          2
        );
      } catch (error: any) {
        log.error(`Error setting permission: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        if (error.code === 404) throw new UserError('File not found. Check the file ID.');
        if (error.code === 403)
          throw new UserError(
            'Permission denied. You must own the file or have write access to change its sharing settings.'
          );
        if (error.code === 400)
          throw new UserError(`Invalid permission request: ${error.message || 'Bad request'}`);
        throw new UserError(`Failed to set permission: ${error.message || 'Unknown error'}`);
      }
    },
  });
}
