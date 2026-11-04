/* Keep the existing tool JSON schemas independent of writer-output validation. */
function strictObject(properties: Record<string, object>) {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

const cursor = {
  type: ['string', 'null'],
  description:
    'Use null for the first page. Continue with the returned nextCursor and identical arguments.',
};
const side = { type: 'string', enum: ['base', 'head'] };
const text = { type: 'string', minLength: 1 };

/* Shared read-only repository tools; the evidence session validates arguments before Git I/O. */
export const repositoryTools = [
  {
    type: 'function',
    name: 'list_changes',
    strict: true,
    description:
      'List the pinned comparison inventory. The initial input already includes the complete inventory.',
    parameters: strictObject({ cursor }),
  },
  {
    type: 'function',
    name: 'inspect_change',
    strict: true,
    description:
      'Read a known change with three surrounding lines, merging nearby windows. Follow every nextCursor to finish.',
    parameters: strictObject({ changeId: text, cursor }),
  },
  {
    type: 'function',
    name: 'search_code',
    strict: true,
    description:
      'Search literal, case-sensitive, single-line text across either pinned revision, including unchanged files. Results are navigation previews; read source before citing code. Use null pathPrefix for the whole repository.',
    parameters: strictObject({
      side,
      query: text,
      pathPrefix: { type: ['string', 'null'] },
      cursor,
    }),
  },
  {
    type: 'function',
    name: 'read_source_lines',
    strict: true,
    description:
      'Read surrounding code in any changed or unchanged file in BASE or HEAD. Lines start at 1. Endings beyond EOF are clamped; an out-of-range start returns bounds for a retry. Continue the same window with nextCursor or issue a new range to expand it.',
    parameters: strictObject({
      side,
      path: text,
      startLine: { type: 'integer', minimum: 1 },
      lineCount: { type: 'integer', minimum: 1 },
      cursor,
    }),
  },
] as const;

/* Decode a model call and reject unknown tools or fields before borrowing the host executor. */
export function parseModelToolRequest(call: {
  name: string;
  arguments: string;
}): Record<string, unknown> {
  const tool = repositoryTools.find((tool) => tool.name === call.name);
  const args: unknown = JSON.parse(call.arguments);

  if (
    !tool ||
    typeof args !== 'object' ||
    args === null ||
    Array.isArray(args)
  ) {
    throw new Error(
      'The model requested an unsupported tool or invalid arguments.',
    );
  }

  const fields = Object.keys(tool.parameters.properties);

  if (
    Object.keys(args).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(args, field))
  ) {
    throw new Error(
      `Tool ${call.name} requires exactly these arguments: ${fields.join(', ')}.`,
    );
  }

  /* The borrowed evidence executor validates domain arguments before repository I/O. */
  return Object.freeze({ ...args, name: call.name });
}
