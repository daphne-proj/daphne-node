import type {
  DiffContextHunk,
  EvidenceSnapshot,
  RetainedSource,
} from '@daphne/context-engine';
import type {
  ModelCallObservation,
  ModelFunctionCall,
  ModelReply,
  ModelProvider,
} from '@daphne/llm';
import type { RunBudget, RunBudgetSnapshot } from '@daphne/evaluator-optimizer';
import type {
  IntentionReview,
  IntentionReviewerReport,
  IntentionReviewTurnNumbers,
} from './review/contracts.js';
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
 * Separates stated purpose from purpose inferred from evidence, so
 * consumers do not present a guess as a PR quote. An Intention can use
 * { basis: 'unknown' } when neither is supported. validateIntentions requires
 * stated quotes to occur in the captured PR title or body, while inferred
 * purpose needs IntentionCitation evidence from either revision. Intention uses
 * this for both intendedOutcome (the desired result) and why (its motivation).
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
 * Records a potential problem relevant to the transition, not a defect in
 * Daphne's explanation. For example, a newly reachable failure cites its caller
 * and failure path, with relevance 'made_relevant'. validateIntentions resolves
 * nonempty citations from either revision; the reviewer checks the condition,
 * consequence, threatened outcome or constraint, and connection to the PR.
 * Non-null uncertainty names an unverified premise; null is not proof of safety.
 */
export interface IntentionIssue {
  text: string;
  relevance: 'introduced' | 'worsened' | 'made_relevant';
  uncertainty: string | null;
  citations: IntentionCitation[];
}

/*
 * Groups changes into an account of actual behavior, desired outcome and concerns.
 * For example, changeIds: ['change-1'] scopes the card to a known change.
 * validateIntentions rejects duplicate or unknown IDs and checks the claims
 * and purpose before adding this card to an IntentionsProposal. intendedOutcome
 * may differ from after when the implementation falls short. An empty issues
 * array means no supported observation was reported, not that the PR is correct.
 */
export interface Intention {
  title: string;
  changeIds: string[];
  before: IntentionClaim;
  after: IntentionClaim;
  intendedOutcome: IntentionReason;
  why: IntentionReason;
  issues: IntentionIssue[];
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
 * Gives runIntentions its model, shared run budget and borrowed evidence
 * executor. For example, executeTool(request) returns a ToolResult for a model
 * lookup. The executor must validate the unknown request before repository I/O;
 * runIntentions requires maxInputTokens to be a positive safe integer. Bind the
 * executor to budget.signal so acquisition, model calls and tools share cancellation.
 * Select provider for the supplied key and model; omission preserves OpenAI callers.
 */
export interface IntentionsOptions {
  provider?: ModelProvider;
  apiKey: string;
  model: string;
  budget: RunBudget;
  maxInputTokens: number;
  executeTool: (request: unknown) => Promise<ToolResult>;
  onModelCall?: (event: IntentionModelCallObservation) => void;
}

/* Attribute requests to a conversation and its local client counter, including failures. */
export type IntentionModelCallObservation = ModelCallObservation & {
  role: 'writer' | 'reviewer';
  candidateNumber: number;
  conversationId: string;
};

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
  number: number;
  role: 'writer' | 'reviewer';
  candidateNumber: number;
  conversationId: string;
  turnNumber: number;
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
 * Records evidence confirmed by a completed request. Initial source IDs name
 * source bytes in that conversation's initial message; tool receipts refer to
 * earlier completed tools in the same conversation. Review feedback names source
 * bytes sent from the previous reviewer to the writer. Counting alone adds none.
 */
export type IntentionEvidenceDelivery =
  | { kind: 'initial'; evidenceIds: readonly string[] }
  | { kind: 'tool'; toolNumber: number }
  | {
      kind: 'review_feedback';
      reviewTurnNumbers: IntentionReviewTurnNumbers;
      evidenceIds: readonly string[];
    };

/*
 * Preserve one provider reply with its conversation and source-delivery snapshot.
 * For example, a writer tool turn has validation: null; terminal validation may
 * also remain null if cancellation skips evaluation. Tool references use number,
 * while generationNumber identifies the conversation client's generation call.
 */
export type IntentionTurn = {
  /* New turns retain the sent prompt; older saved OpenAI turns may omit it. */
  instructions?: string;
  number: number;
  candidateNumber: number;
  conversationId: string;
  generationNumber: number;
  deliveries: IntentionEvidenceDelivery[];
  deliveredEvidenceIds: readonly string[];
  inputTokens: number;
  reply: ModelReply;
} & (
  | { role: 'writer'; validation: IntentionsValidation | null }
  | { role: 'reviewer'; review: IntentionReviewerReport | null }
);

/* Completed checks reference their retained report; an interrupted evaluation is null on its attempt. */
export type IntentionEvaluation =
  | { kind: 'structural'; status: 'revise'; diagnostics: string[] }
  | {
      kind: 'semantic';
      status: 'accept' | 'revise' | 'stop';
      report: IntentionReview;
      reviewTurnNumbers: IntentionReviewTurnNumbers;
    };

/* One-based candidates count terminal writer drafts, not reviewer replies or tool continuations. */
export interface IntentionAttempt {
  number: number;
  writerTurnNumber: number;
  deliveredEvidenceIds: readonly string[];
  evaluation: IntentionEvaluation | null;
}

/* Select the accepted writer and all three approving reviews, independent of completion order. */
export interface AcceptedIntentionCandidate {
  candidateNumber: number;
  writerTurnNumber: number;
  reviewTurnNumbers: IntentionReviewTurnNumbers;
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
  budget: RunBudgetSnapshot;
  limits: {
    maxInputTokens: number;
    maxOutputTokens: number;
    maxContextBytes: number;
    maxRetainedBytes: number;
    maxRequestBytes: number;
  };
  evidence: EvidenceSnapshot | null;
  hunks: IntentionHunkEvidence[];
  attempts: IntentionAttempt[];
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
      acceptedCandidate: AcceptedIntentionCandidate | null;
    }
  | {
      status: 'failed';
      proposal: null;
      response: null;
      acceptedCandidate: null;
      error: unknown;
    }
);
