export { createContextEngine } from './engine.js';
export type { ContextEngine } from './engine.js';
export { buildContextPacket } from './assembly.js';
export { validateAndCopySnapshot } from './evidence.js';
export { defaultContextLimits, resolveContextLimits } from './limits.js';
export type { ContextLimits } from './limits.js';
export {
  ContextInputError,
  ContextConflictError,
  ContextLimitError,
} from './errors.js';
export type {
  RetainedSource,
  RetainedEntry,
  RecordedPage,
  RecordedQuery,
  EvidenceSnapshot,
  DiffContextHunk,
  QueryPageSelection,
  AssembleInput,
  ContextPacket,
} from './contracts.js';

export { validateDiffInput, retainDiff } from './diff.js';
export type { DiffEvidenceInput, DiffHunkEvidence } from './diff.js';
export { assembleCompleteEvidence } from './complete-evidence.js';

export { retainToolEvidence } from './tool-evidence.js';
export { initialLimitations, retrievalLimitations } from './notices.js';
