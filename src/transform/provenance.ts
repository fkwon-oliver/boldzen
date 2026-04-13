/**
 * Provenance headers for migrated tickets and comments.
 *
 * BoldDesk does not support setting original created/updated timestamps or
 * original comment author identity via its API.  These helpers prepend a
 * compact HTML metadata block so agents can see the authoritative Zendesk
 * provenance directly in the BoldDesk UI.
 */

export interface TicketProvenanceOpts {
  zendeskTicketId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommentProvenanceOpts {
  authorName?: string;
  authorEmail?: string;
  authorSourceId: string;
  createdAt: string;
  isPublic: boolean;
}

const STYLE =
  'style="background:#f7f7f7;padding:8px 12px;margin-bottom:16px;font-size:12px;color:#555;border-left:3px solid #ccc;font-family:monospace;"';

export function buildTicketProvenanceBlock(opts: TicketProvenanceOpts): string {
  return (
    `<div ${STYLE}>` +
    `<strong>Migrated from Zendesk</strong> · Ticket #${opts.zendeskTicketId}<br/>` +
    `Created: ${opts.createdAt} · Updated: ${opts.updatedAt}` +
    `</div>`
  );
}

export function buildCommentProvenanceHeader(opts: CommentProvenanceOpts): string {
  const authorLabel = opts.authorName
    ? `${opts.authorName}${opts.authorEmail ? ` (${opts.authorEmail})` : ""}`
    : opts.authorEmail ?? `Zendesk user #${opts.authorSourceId}`;

  const type = opts.isPublic ? "Reply" : "Note";

  return (
    `<div ${STYLE}>` +
    `<strong>Original ${type}</strong> by ${authorLabel}<br/>` +
    `Posted: ${opts.createdAt}` +
    `</div>`
  );
}
