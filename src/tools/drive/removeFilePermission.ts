import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDriveClient } from '../../clients.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'removeFilePermission',
    description:
      "Revokes a sharing permission on a Google Drive file or folder. Use getFilePermissions to find the permissionId first. Maps to drive.permissions.delete.",
    parameters: z.object({
      fileId: z.string().describe('ID of the Drive file or folder.'),
      permissionId: z
        .string()
        .describe('ID of the permission to revoke. Obtain this from getFilePermissions or setFilePermission.'),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      log.info(`Removing permission ${args.permissionId} from file ${args.fileId}`);

      try {
        await drive.permissions.delete({
          fileId: args.fileId,
          permissionId: args.permissionId,
          supportsAllDrives: true,
        });

        return JSON.stringify(
          {
            success: true,
            fileId: args.fileId,
            permissionId: args.permissionId,
            message: 'Permission revoked successfully.',
          },
          null,
          2
        );
      } catch (error: any) {
        log.error(`Error removing permission: ${error.message || error}`);
        if (error.code === 404)
          throw new UserError(
            'File or permission not found. Verify both the fileId and permissionId.'
          );
        if (error.code === 403)
          throw new UserError(
            'Permission denied. You must own the file or have write access to revoke permissions.'
          );
        throw new UserError(`Failed to remove permission: ${error.message || 'Unknown error'}`);
      }
    },
  });
}
