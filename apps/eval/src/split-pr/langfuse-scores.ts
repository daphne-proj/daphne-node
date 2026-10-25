import type { Evaluation } from '@langfuse/client';
import type { SplitScores } from './contracts.js';

export const itemScoreNames = [
  'completed',
  'accepted',
  'constraints_passed',
  'together_rate',
  'separate_rate',
  'corrections',
  'count_calls',
  'generate_calls',
];

export function toSplitEvaluations(
  scores: SplitScores,
  calls: { count: number; generate: number },
): Evaluation[] {
  return [
    { name: 'completed', value: Number(scores.completed) },
    { name: 'accepted', value: Number(scores.accepted) },
    {
      name: 'constraints_passed',
      value: Number(scores.constraintsPassed),
    },
    {
      name: 'together_rate',
      value: scores.together.rate ?? 'not_applicable',
    },
    {
      name: 'separate_rate',
      value: scores.separate.rate ?? 'not_applicable',
    },
    { name: 'corrections', value: scores.corrections },
    { name: 'count_calls', value: calls.count },
    { name: 'generate_calls', value: calls.generate },
  ];
}
