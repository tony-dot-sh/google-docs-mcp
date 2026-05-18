import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDriveClient } from '../../clients.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'updateFilePermission',
    description:
      "Changes the role on an existing Drive permission (e.g. reader → writer). Use getFilePermissions to find the permissionId first. Maps to drive.permissions.update.",
    parameters: z.object({
      fileId: z.string().describe('ID of the Drive file or folder.'),
      permissionId: z
        .string()
        .describe('ID of the permission to update. Obtain this from getFilePermissions or setFilePermission.'),
      role: z
        .enum(['reader', 'writer', 'commenter'])
        .describe('New access level to assign.'),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      log.info(`Updating permission ${args.permissionId} on file ${args.fileId} to ${args.role}`);

      try {
        const permRes = await drive.permissions.update({
          fileId: args.fileId,
          permissionId: args.permissionId,
          supportsAllDrives: true,
          fields: 'id,role,type,emailAddress,displayName',
          requestBody: { role: args.role },
        });

        return JSON.stringify(
          {
            permissionId: permRes.data.id,
            role: permRes.data.role,
            type: permRes.data.type,
            ...(permRes.data.emailAddress ? { emailAddress: permRes.data.emailAddress } : {}),
            ...(permRes.data.displayName ? { displayName: permRes.data.displayName } : {}),
            fileId: args.fileId,
            message: `Permission updated to ${args.role}.`,
          },
          null,
          2
        );
      } catch (error: any) {
        log.error(`Error updating permission: ${error.message || error}`);
        if (error.code === 404)
          throw new UserError(
            'File or permission not found. Verify both the fileId and permissionId.'
          );
        if (error.code === 403)
          throw new UserError(
            'Permission denied. You must own the file or have write access to change permissions.'
          );
        if (error.code === 400)
          throw new UserError(`Invalid update request: ${error.message || 'Bad request'}`);
        throw new UserError(`Failed to update permission: ${error.message || 'Unknown error'}`);
      }
    },
  });
}
