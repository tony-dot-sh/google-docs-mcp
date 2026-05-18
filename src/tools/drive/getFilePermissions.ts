import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDriveClient } from '../../clients.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'getFilePermissions',
    description:
      'Lists all sharing permissions on a Google Drive file or folder. Returns each permission with its ID, role, type, and recipient details. Use the returned permissionId with updateFilePermission or removeFilePermission.',
    parameters: z.object({
      fileId: z.string().describe('ID of the Drive file or folder to inspect.'),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      log.info(`Listing permissions for file ${args.fileId}`);

      try {
        const [permRes, fileRes] = await Promise.all([
          drive.permissions.list({
            fileId: args.fileId,
            supportsAllDrives: true,
            fields: 'permissions(id,role,type,emailAddress,displayName,domain,deleted,pendingOwner)',
          }),
          drive.files.get({
            fileId: args.fileId,
            fields: 'name,webViewLink,shared',
            supportsAllDrives: true,
          }),
        ]);

        const permissions = (permRes.data.permissions || []).map((p) => ({
          permissionId: p.id,
          role: p.role,
          type: p.type,
          ...(p.emailAddress ? { emailAddress: p.emailAddress } : {}),
          ...(p.displayName ? { displayName: p.displayName } : {}),
          ...(p.domain ? { domain: p.domain } : {}),
          ...(p.deleted ? { deleted: p.deleted } : {}),
        }));

        return JSON.stringify(
          {
            fileId: args.fileId,
            fileName: fileRes.data.name,
            shared: fileRes.data.shared ?? false,
            sharingUrl: fileRes.data.webViewLink,
            permissionCount: permissions.length,
            permissions,
          },
          null,
          2
        );
      } catch (error: any) {
        log.error(`Error listing permissions: ${error.message || error}`);
        if (error.code === 404) throw new UserError('File not found. Check the file ID.');
        if (error.code === 403)
          throw new UserError(
            'Permission denied. You need at least read access to view sharing settings.'
          );
        throw new UserError(`Failed to get permissions: ${error.message || 'Unknown error'}`);
      }
    },
  });
}
