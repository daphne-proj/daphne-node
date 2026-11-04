import type {
  DiffContextHunk,
  DiffHunkEvidence,
  EvidenceSnapshot,
  RetainedSource,
} from '@daphne/context-engine';
import type {
  ModelCallObservation,
  ModelFunctionCall,
  ModelReply,
  ModelProvider,
  OpenAIReasoningEffort,
} from '@daphne/llm';
import type { RunBudget, RunBudgetSnapshot } from '@daphne/evaluator-optimizer';
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
 * Separates the author's stated purpose from purpose inferred from code.
 * For example, { basis: 'stated', citations: [{ field: 'body', quote: 'Add retries.' }] }
 * contains only PR quotations, never a model-written explanation. validateIntentions
 * checks exact quotation membership; this proves attribution, not that the PR
 * description is correct or the implementation fulfills it. Consumers display
 * stated quotations as author claims. Inferred purpose keeps text with code/change
 * evidence; use { basis: 'unknown' } when neither is supported. Intention uses
 * this for both intendedOutcome (the desired result) and why (its motivation).
 */
export type IntentionReason =
  | {
      basis: 'stated';
      citations: { field: 'title' | 'body'; quote: string }[];
    }
  | { basis: 'inferred'; text: string; citations: IntentionCitation[] }
  | { basis: 'unknown' };

/*
 * Records a potential problem relevant to the transition, not a defect in
 * Daphne's explanation. For example, a newly reachable failure cites its caller
 * and failure path, with relevance 'made_relevant'. validateIntentions resolves
 * nonempty citations from either revision. Independent evaluation must check the
 * condition, consequence and connection to the PR; validation cannot prove them.
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
 * hunks. runIntentions validates the input without copying it. Callers must
 * leave it unchanged because the workflow and returned comparison share it.
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
  /* Defaults to medium for OpenAI and high for Codex; do not supply this for Anthropic. */
  reasoningEffort?: OpenAIReasoningEffort;
  apiKey: string;
  model: string;
  budget: RunBudget;
  maxInputTokens: number;
  executeTool: (request: unknown) => Promise<ToolResult>;
  onModelCall?: (event: IntentionModelCallObservation) => void;
}

/* Attribute requests to a conversation and its local client counter, including failures. */
export type IntentionModelCallObservation = ModelCallObservation & {
  role: 'writer';
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
 * Preserves each model tool call and its outcome in IntentionsResult, including
 * failures that stop the run. For example, a failed record keeps error even if
 * request parsing produced null. executeIntentionTool records included evidence
 * on success; delivered becomes true only after a later model turn receives it.
 */
export type IntentionToolRecord = {
  number: number;
  role: 'writer';
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
 * earlier completed tools in the same conversation. Counting alone confirms no
 * delivery; a completed model reply must acknowledge the containing request.
 */
export type IntentionEvidenceDelivery =
  | { kind: 'initial'; evidenceIds: readonly string[] }
  | { kind: 'tool'; toolNumber: number };

/*
 * Preserve one provider reply with its conversation and source-delivery snapshot.
 * For example, a writer tool turn has validation: null; terminal validation may
 * also remain null if cancellation skips evaluation. Tool references use number,
 * while generationNumber identifies the conversation client's generation call.
 */
export interface IntentionTurn {
  instructions: string;
  role: 'writer';
  validation: IntentionsValidation | null;
  number: number;
  candidateNumber: number;
  conversationId: string;
  generationNumber: number;
  deliveries: IntentionEvidenceDelivery[];
  deliveredEvidenceIds: readonly string[];
  inputTokens: number;
  reply: ModelReply;
}

/* Structural acceptance validates the saved draft and citations, not semantic correctness. */
export type IntentionEvaluation =
  | { kind: 'structural'; status: 'revise'; diagnostics: string[] }
  | { kind: 'structural'; status: 'accept' };

/* One-based candidates count terminal writer drafts, not tool continuations. */
export interface IntentionAttempt {
  number: number;
  writerTurnNumber: number;
  deliveredEvidenceIds: readonly string[];
  evaluation: IntentionEvaluation | null;
}

/* Select the structurally valid writer draft; no semantic review is implied. */
export interface AcceptedIntentionCandidate {
  candidateNumber: number;
  writerTurnNumber: number;
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
  hunks: DiffHunkEvidence[];
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
