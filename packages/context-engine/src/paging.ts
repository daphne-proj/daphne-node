import type {
  Change,
  ReviewIdentity,
  Side,
  SourceEvidence,
} from '@daphne/review-evidence/contracts';
import type { TokenBudget } from './contracts.js';
import { ContextInputError, ContextLimitError } from './errors.js';
import { defaultContextLimits } from './limits.js';
import * as validate from './validation.js';

/*
 * Split the source near its byte midpoint, preferably just after a newline.
 * Otherwise, split between UTF-8 characters; choose the earlier boundary on a tie.
 */
function splitSource(source: SourceEvidence): [SourceEvidence, SourceEvidence] {
  const bytes = Buffer.from(source.text);
  const middle = bytes.length / 2;
  let cut = 0;

  for (
    let newline = bytes.indexOf(10);
    newline >= 0 && newline + 1 < bytes.length;
    newline = bytes.indexOf(10, newline + 1)
  ) {
    const boundary = newline + 1;

    if (cut === 0 || Math.abs(boundary - middle) < Math.abs(cut - middle)) {
      cut = boundary;
    }
  }

  /* A long line can split between UTF-8 scalars, never inside one. */
  if (cut === 0) {
    let before = Math.floor(middle);
    let after = Math.ceil(middle);

    while (before > 0 && ((bytes[before] ?? 0) & 0xc0) === 0x80) {
      before -= 1;
    }

    while (after < bytes.length && ((bytes[after] ?? 0) & 0xc0) === 0x80) {
      after += 1;
    }

    if (
      before > 0 &&
      (after === bytes.length || middle - before <= after - middle)
    ) {
      cut = before;
    } else if (after < bytes.length) {
      cut = after;
    }
  }

  if (cut === 0) {
    throw new ContextLimitError(
      'packet',
      'The context header, empty anchor or one Unicode scalar cannot fit.',
    );
  }

  /* Both children keep their provenance and exactly partition the parent. */
  function slice(start: number, end: number): SourceEvidence {
    return {
      ref: {
        ...source.ref,
        range: {
          startByte: source.ref.range.startByte + start,
          endByte: source.ref.range.startByte + end,
        },
      },
      text: bytes.subarray(start, end).toString('utf8'),
    };
  }

  return [slice(0, cut), slice(cut, bytes.length)];
}

/*
 * Produce pages as the caller advances the async iterator.
 * Stopping early or an error leaves delivery unfinished.
 */
export async function* paginateDiffContext(input: {
  identity: ReviewIdentity;
  change: Change;
  hunkIndex: number | null;
  sources: readonly SourceEvidence[];
  tokens: TokenBudget;
}): AsyncIterable<string> {
  /* Validate and capture supplied evidence once, before awaiting a counter. */
  const identity = validate.identity(input.identity);
  const change = validate.change(input.change);

  const hunkIndex =
    input.hunkIndex === null ? null : validate.integer(input.hunkIndex);

  const sources = validate
    .array(input.sources)
    .map((source) => validate.source(source, identity));

  const maxTokens = validate.integer(input.tokens.maxTokens, 1);

  const { countTokens } = input.tokens;

  const hunk = hunkIndex === null ? undefined : change.hunks[hunkIndex];

  if (hunkIndex === null) {
    if (
      sources.length !== 0 ||
      (change.kind === 'text' && change.hunks.length !== 0)
    ) {
      throw new ContextInputError(
        'Metadata-only context requires no sources and no readable text hunks.',
      );
    }
  } else {
    if (change.kind !== 'text' || !hunk) {
      throw new ContextInputError('The index must identify a text hunk.');
    }

    const sides: Side[] = ['base', 'head'];
    const paths = { base: change.beforePath, head: change.afterPath };
    const expectedSides = sides.filter((side) => paths[side] !== null);

    if (
      sources.length !== expectedSides.length ||
      sources.some(
        ({ ref }, index) =>
          ref.side !== expectedSides[index] || ref.path !== paths[ref.side],
      )
    ) {
      throw new ContextInputError(
        'Supply each existing hunk side once, in BASE-then-HEAD order, at its change path.',
      );
    }
  }

  /* Repeat metadata on every page; source text stays byte-for-byte unchanged. */
  function render(fragments: SourceEvidence[]): string {
    return [
      `BASE commit: ${identity.baseCommit}`,
      `HEAD commit: ${identity.headCommit}`,
      `Change: ${JSON.stringify(change.id)}; status: ${change.status}; kind: ${change.kind}`,
      `BASE path: ${JSON.stringify(change.beforePath)}; mode: ${change.beforeMode ?? 'missing'}`,
      `HEAD path: ${JSON.stringify(change.afterPath)}; mode: ${change.afterMode ?? 'missing'}`,
      hunk
        ? `Hunk: ${String(hunkIndex)}; BASE lines ${String(hunk.beforeStartLine)},${String(hunk.beforeLineCount)}; HEAD lines ${String(hunk.afterStartLine)},${String(hunk.afterLineCount)}`
        : 'Hunk: none (metadata-only; no text shown)',
      ...fragments.map(
        ({ ref, text }) =>
          `Source: ${ref.side.toUpperCase()} ${JSON.stringify(ref.path)} bytes [${String(ref.range.startByte)}, ${String(ref.range.endByte)})\n${text}`,
      ),
    ].join('\n');
  }

  /*
   * Recursively split candidates until they fit.
   * yield* forwards each child's pages before moving to the next child.
   */
  async function* paginate(fragments: SourceEvidence[]): AsyncIterable<string> {
    const rendered = render(fragments);

    /* Oversized byte candidates split before invoking the token counter. */
    if (Buffer.byteLength(rendered) <= defaultContextLimits.maxContextBytes) {
      const count = await countTokens(rendered);

      if (validate.integer(count) <= maxTokens) {
        /* This branch is complete; return after yielding to avoid splitting it again. */
        yield rendered;
        return;
      }
    }

    /* A pair of validated sources is always BASE followed by HEAD. */
    const [base, head] = fragments;

    if (base && head) {
      yield* paginate([base]);
      yield* paginate([head]);
    } else {
      const source = fragments[0];

      if (!source) {
        throw new ContextLimitError(
          'packet',
          'Metadata-only context cannot fit.',
        );
      }

      /* One source remains: split its text and page the left part before the right. */
      const [left, right] = splitSource(source);

      yield* paginate([left]);
      yield* paginate([right]);
    }
  }

  yield* paginate(sources);
}
