export interface NormalizedAttachment {
  sourceId: string;
  fileName: string;
  contentType: string;
  size: number;
  sourceUrl: string;
  commentSourceId: string;
  raw?: Record<string, unknown>;
}
