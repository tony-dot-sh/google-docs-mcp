import type { FastMCP } from 'fastmcp';
import { register as listMessages } from './listMessages.js';
import { register as getMessage } from './getMessage.js';
import { register as getAttachment } from './getAttachment.js';
import { register as saveAttachmentToDrive } from './saveAttachmentToDrive.js';
import { register as sendEmail } from './sendEmail.js';
import { register as modifyMessageLabels } from './modifyMessageLabels.js';
import { register as listLabels } from './listLabels.js';
import { register as createDraft } from './createDraft.js';
import { register as listDrafts } from './listDrafts.js';
import { register as getDraft } from './getDraft.js';
import { register as updateDraft } from './updateDraft.js';
import { register as sendDraft } from './sendDraft.js';
import { register as triageInbox } from './triageInbox.js';
import { register as createDraftWithAttachments } from './createDraftWithAttachments.js';

export function registerGmailTools(server: FastMCP) {
  listMessages(server);
  getMessage(server);
  getAttachment(server);
  saveAttachmentToDrive(server);
  sendEmail(server);
  modifyMessageLabels(server);
  listLabels(server);
  createDraft(server);
  listDrafts(server);
  getDraft(server);
  updateDraft(server);
  sendDraft(server);
  triageInbox(server);
  createDraftWithAttachments(server);
}
