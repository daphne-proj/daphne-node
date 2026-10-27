import type {
  DiffContextHunk,
  EvidenceSnapshot,
  RetainedSource,
} from '@daphne/context-engine';
import type {
  ModelCallObservation,
  ModelFunctionCall,
  ModelReply,
} from '@daphne/llm';
import type {
  ByteRange,
  Change,
  ContextNotice,
  ReviewIdentity,
  SourceEvidence,
  ToolResult,
} from '@daphne/review-evidence/contracts';

/*
 * Lets an IntentionClaim point to a whole change or exact code instead of leaving
 * its evidence implicit. validateIntentions accepts, for example,
 * { kind: 'change', changeId: 'change-1' } only for a known change. A code citation
 * must select valid UTF-8 bytes from source delivered to the model; validation
 * fills in source from the retained evidence rather than trusting model text.
 */
export type IntentionCitation =
  | {
      kind: 'code';
      evidenceId: string;
      range: ByteRange;
      source: SourceEvidence;
    }
  | { kind: 'change'; changeId: string };

/*
 * Keeps a before or after statement tied to evidence in an Intention. For
 * example, { text: 'The flag was off.', citations: [changeCitation] } must have
 * at least one citation; validateIntentions checks code citations against the
 * base revision for before and the head revision for after.
 */
export interface IntentionClaim {
  text: string;
  citations: IntentionCitation[];
}

/*
 * Separates an author's stated reason from a reason inferred from evidence, so
 * consumers do not present a guess as a PR quote. An Intention can use
 * { basis: 'unknown' } when neither is supported. validateIntentions requires
 * stated quotes to occur in the captured PR title or body, while inferred
 * reasons need IntentionCitation evidence from either revision.
 */
export type IntentionReason =
  | {
      basis: 'stated';
      text: string;
      citations: { field: 'title' | 'body'; quote: string }[];
    }
  | { basis: 'inferred'; text: string; citations: IntentionCitation[] }
  | { basis: 'unknown' };

/*
 * Groups the changes that serve one purpose into a before/after explanation.
 * For example, changeIds: ['change-1'] scopes the card to a known change.
 * validateIntentions rejects duplicate or unknown IDs and checks the claims
 * and reason before adding this card to an IntentionsProposal.
 */
export interface Intention {
  title: string;
  changeIds: string[];
  before: IntentionClaim;
  after: IntentionClaim;
  why: IntentionReason;
}

/*
 * Holds the accepted explanation and any warnings as one output of
 * validateIntentions. For example, { intentions: [], warnings: [] } is the
 * complete result for a comparison with no changes; when changes exist, at
 * least one Intention is required. runIntentions returns it on success.
 */
export interface IntentionsProposal {
  intentions: Intention[];
  warnings: string[];
}

/*
 * Supplies one pinned comparison to runIntentions, including PR text and diff
 * evidence. For example, a change with one text hunk needs a matching entry in
 * hunks. captureInput copies and checks the input before asynchronous work so
 * later caller edits cannot change the comparison being explained.
 */
export interface IntentionsInput {
  identity: ReviewIdentity;
  changes: readonly Change[];
  hunks: readonly DiffContextHunk[];
  pr: { url: string; title: string; body: string | null };
}

/*
 * Gives runIntentions its model, cancellation, budget and borrowed evidence
 * executor. For example, executeTool(request) returns a ToolResult for a model
 * lookup. The executor must validate the unknown request before repository I/O;
 * runIntentions requires maxInputTokens to be a positive safe integer.
 */
export interface IntentionsOptions {
  apiKey: string;
  model: string;
  signal: AbortSignal;
  maxInputTokens: number;
  executeTool: (request: unknown) => Promise<ToolResult>;
  onModelCall?: (event: ModelCallObservation) => void;
}

/*
 * Gives validateIntentions the captured facts needed to check model output.
 * For example, deliveredEvidenceIds: ['e-1'] permits a code citation to e-1
 * only when sources also contains it and its revision matches identity. This
 * prevents an IntentionCitation from using retained but unseen source text.
 */
export interface IntentionsValidationContext {
  identity: ReviewIdentity;
  changes: readonly Change[];
  pr: IntentionsInput['pr'];
  sources: readonly RetainedSource[];
  deliveredEvidenceIds: readonly string[];
}

/*
 * Reports whether validateIntentions accepted a model reply without mixing a
 * proposal with rejection diagnostics. For example, check status === 'valid'
 * before reading proposal; an invalid reply supplies diagnostics for the
 * correction turn in runIntentions.
 */
export type IntentionsValidation =
  | { status: 'valid'; proposal: IntentionsProposal }
  | { status: 'invalid'; diagnostics: string[] };

/*
 * Connects an input diff hunk to retained source IDs for the model and final
 * IntentionsResult. For example, { changeId: 'change-1', hunkIndex: 0,
 * evidenceIds: ['e-1'] } names the first text hunk. retainDiff uses null for a
 * change without a text hunk, which must not supply hunk source evidence.
 */
export interface IntentionHunkEvidence {
  changeId: string;
  hunkIndex: number | null;
  evidenceIds: string[];
}

/*
 * Preserves each model tool call and its outcome in IntentionsResult, including
 * failures that stop the run. For example, a failed record keeps error even if
 * request parsing produced null. executeIntentionTool records included evidence
 * on success; delivered becomes true only after a later model turn receives it.
 */
export type IntentionToolRecord = {
  call: ModelFunctionCall;
  request: Record<string, unknown> | null;
} & (
  | {
      status: 'complete';
      result: ToolResult;
      output: string;
      includedEvidenceIds: readonly string[];
      delivered: boolean;
    }
  | { status: 'failed'; result: ToolResult | null; error: unknown }
);

/*
 * Records one generated reply and its token cost so runIntentions can explain
 * its progress and validate a final proposal. For example, validation: null
 * means the reply requested tools, while a proposal reply carries an
 * IntentionsValidation result. Turns remain in IntentionsResult on failure.
 */
export interface IntentionTurn {
  number: number;
  inputTokens: number;
  reply: ModelReply;
  validation: IntentionsValidation | null;
}

/*
 * Returns the accepted proposal or failure together with the evidence and
 * turns collected by runIntentions. For example, check status === 'complete'
 * before reading proposal; a failed run has proposal: null and an error.
 * comparison omits raw hunks, while evidence and hunk mappings preserve the
 * investigation record even when validation or a tool fails.
 */
export type IntentionsResult = {
  comparison: Omit<IntentionsInput, 'hunks'> | null;
  limits: {
    maxInputTokens: number;
    maxOutputTokens: number;
    maxGenerations: number;
    maxToolCalls: number;
    maxCorrections: number;
    maxContextBytes: number;
    maxRetainedBytes: number;
    maxRequestBytes: number;
  };
  evidence: EvidenceSnapshot | null;
  hunks: IntentionHunkEvidence[];
  deliveredEvidenceIds: string[];
  tools: IntentionToolRecord[];
  turns: IntentionTurn[];
  limitations: ContextNotice[];
  diagnostics: string[];
  calls: { count: number; generate: number; tools: number };
} & (
  | {
      status: 'complete';
      proposal: IntentionsProposal;
      response: Record<string, unknown> | null;
    }
  | { status: 'failed'; proposal: null; response: null; error: unknown }
);
