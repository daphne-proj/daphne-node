export { createEvidenceSession } from './session.js';
export type { EvidenceSession, EvidenceOperationOptions } from './session.js';
export {
  EvidenceInputError,
  SourceUnavailableError,
  EvidenceLimitError,
} from './errors.js';
export type {
  ReviewIdentity,
  Side,
  ByteRange,
  SourceRef,
  SourceEvidence,
  Change,
  ContextNotice,
  ToolEntry,
  ToolRequest,
  ToolResult,
} from './contracts.js';

export { defaultEvidenceLimits, resolveEvidenceLimits } from './limits.js';
export type { EvidenceLimits } from './limits.js';
export { parseToolRequest } from './tools/validate.js';
