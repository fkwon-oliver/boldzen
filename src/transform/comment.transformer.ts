import { NormalizedComment } from "../models";

export interface TransformedComment {
  body: string;
  isPublic: boolean;
  authorSourceId: string;
  createdAt: string;
  attachmentSourceIds: string[];
}

export function transformComment(comment: NormalizedComment): TransformedComment {
  return {
    body: comment.htmlBody ?? comment.body,
    isPublic: comment.isPublic,
    authorSourceId: comment.authorSourceId,
    createdAt: comment.createdAt,
    attachmentSourceIds: comment.attachments.map((a) => a.sourceId),
  };
}
