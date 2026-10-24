import type { SplitCase } from './contracts.js';
import { parseSplitEvidence } from './evidence.js';
import { sourcePrUrl } from './case.js';
import { writeJsonArtifact } from './report.js';
import * as parse from './parse.js';

export async function importSplitCase(
  artifactPath: string,
  caseId: string,
  outputPath: string,
): Promise<void> {
  const { value: definition } = await parse.readJson(
    artifactPath,
    (value, bytes): SplitCase => {
      const input = parse.object(value, 'artifact');
      parse.choice(input.format, ['daphne-split-pr-v3'], 'artifact.format');
      const status = parse.choice(
        input.status,
        ['complete', 'failed'],
        'artifact.status',
      );
      const calls = parse.object(input.calls, 'artifact.calls');
      const count = parse.integer(calls.count, 'artifact.calls.count');
      const generate = parse.integer(calls.generate, 'artifact.calls.generate');
      parse.array(input.pages, 'artifact.pages');
      parse.array(input.attempts, 'artifact.attempts');

      /* Identity can exist before acquisition finishes; zero activity cannot prove an empty diff. */
      if (status === 'failed' && count === 0 && generate === 0) {
        throw new parse.SplitDatasetError(
          'artifact: failed with no workflow activity; acquisition completion is ambiguous.',
        );
      }

      const evidence = parseSplitEvidence({
        identity: input.identity,
        changes: input.changes,
        hunks: input.hunks,
      });

      return {
        format: 'daphne-split-case-v1',
        id: parse.text(caseId, 'case.id'),
        partition: 'development',
        tags: [],
        provenance: {
          kind: 'artifact',
          capturedAt: new Date().toISOString(),
          artifactSha256: parse.sha256(bytes),
          sourcePrUrl: sourcePrUrl(input.pr ?? null),
        },
        evidence,
        labels: [],
        notes: [],
        review: { status: 'draft' },
      };
    },
  );

  await writeJsonArtifact(outputPath, definition);
}
