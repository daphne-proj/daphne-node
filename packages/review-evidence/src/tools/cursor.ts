import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { ToolRequest } from '../contracts.js';
import { EvidenceInputError } from '../errors.js';

export interface Position {
  readonly index: number;
  readonly offset: number;
}

/** One key per borrowing session: no cursor registry, response cache or consumed-token state. */
export function createCursorCodec() {
  const key = randomBytes(32);

  function signature(query: string, position: string): string {
    return createHmac('sha256', key)
      .update(query)
      .update(':')
      .update(position)
      .digest('base64url');
  }

  return {
    query(request: ToolRequest, pageSize: number): string {
      return createHash('sha256')
        .update(
          JSON.stringify({
            ...request,
            cursor: null,
            effectivePageSize: pageSize,
          }),
        )
        .digest('hex');
    },
    encode(query: string, position: Position): string {
      const value = `${String(position.index)}.${String(position.offset)}`;
      return `${value}.${signature(query, value)}`;
    },
    decode(query: string, token: string | null): Position {
      if (token === null) {
        return { index: 0, offset: 0 };
      }

      const match =
        /^(0|[1-9][0-9]{0,15})\.(0|[1-9][0-9]{0,15})\.([A-Za-z0-9_-]{43})$/.exec(
          token,
        );
      const index = Number(match?.[1]);
      const offset = Number(match?.[2]);
      const tag = match?.[3];

      if (
        !tag ||
        !Number.isSafeInteger(index) ||
        !Number.isSafeInteger(offset)
      ) {
        throw new EvidenceInputError('The continuation cursor is invalid.');
      }

      const expected = signature(query, `${String(index)}.${String(offset)}`);

      if (!timingSafeEqual(Buffer.from(tag), Buffer.from(expected))) {
        throw new EvidenceInputError(
          'The cursor belongs to a different session or query.',
        );
      }

      return { index, offset };
    },
  };
}
