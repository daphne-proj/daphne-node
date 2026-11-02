import { isObject, object } from './response.js';

const unsupported = new Set([
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'maxItems',
  'uniqueItems',
]);
const formats = new Set([
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'uri',
  'ipv4',
  'ipv6',
  'uuid',
]);

/*
 * Claude's strict schemas omit numerical/string limits. Keep their descriptions
 * as model guidance while workflows validate the original schema locally. Walk
 * schema positions only, so a property named "minimum" remains a real property.
 * Compact shared object fields and literal choices to reduce the response grammar;
 * the original schema still checks variant relationships locally.
 */
export function anthropicSchema(schema: object): Record<string, unknown> {
  let source = object(schema, 'Anthropic schema');
  const alternatives: readonly unknown[] = Array.isArray(source.anyOf)
    ? source.anyOf
    : [];
  const branches = alternatives.filter(isObject);
  const first = branches[0];

  if (
    branches.length > 1 &&
    branches.length === alternatives.length &&
    branches.every(
      (branch) =>
        branch.type === 'string' &&
        Object.keys(branch).every((key) =>
          ['type', 'const', 'enum'].includes(key),
        ) &&
        (typeof branch.const === 'string' ||
          (Array.isArray(branch.enum) &&
            branch.enum.every((value: unknown) => typeof value === 'string'))),
    )
  ) {
    source = {
      ...source,
      type: 'string',
      enum: [
        ...new Set(
          branches.flatMap((branch): unknown[] =>
            Array.isArray(branch.enum) ? branch.enum : [branch.const],
          ),
        ),
      ],
    };
    delete source.anyOf;
  }

  if (
    first &&
    branches.length > 1 &&
    branches.length === alternatives.length &&
    branches.every(
      (branch) =>
        branch.type === 'object' &&
        branch.additionalProperties === false &&
        isObject(branch.properties) &&
        Array.isArray(branch.required),
    )
  ) {
    const records = branches.map((branch) => object(branch.properties));
    const required = Array.isArray(first.required)
      ? first.required.filter(
          (name: unknown): name is string =>
            typeof name === 'string' &&
            branches.every(
              (branch) =>
                Array.isArray(branch.required) &&
                branch.required.includes(name),
            ),
        )
      : [];

    if (
      required.some((name) =>
        records.every(
          (record) =>
            JSON.stringify(record[name]) === JSON.stringify(records[0]?.[name]),
        ),
      )
    ) {
      const properties: Record<string, unknown> = {};

      for (const name of new Set(
        records.flatMap((record) => Object.keys(record)),
      )) {
        const variants = [
          ...new Map(
            records
              .filter((record) => name in record)
              .map((record) => [JSON.stringify(record[name]), record[name]]),
          ).values(),
        ];
        properties[name] =
          variants.length === 1 ? variants[0] : { anyOf: variants };
      }

      source = {
        ...source,
        type: 'object',
        properties,
        required,
        additionalProperties: false,
      };
      delete source.anyOf;
    }
  }

  const result: Record<string, unknown> = {};
  const constraints: string[] = [];

  for (const [key, value] of Object.entries(source)) {
    if (
      unsupported.has(key) ||
      (key === 'minItems' && value !== 0 && value !== 1) ||
      (key === 'format' && (typeof value !== 'string' || !formats.has(value)))
    ) {
      constraints.push(`${key}: ${JSON.stringify(value)}`);
      continue;
    }

    if (
      key === 'properties' ||
      key === '$defs' ||
      key === 'definitions' ||
      key === 'patternProperties'
    ) {
      result[key] = Object.fromEntries(
        Object.entries(object(value, 'Anthropic schema')).map(
          ([name, child]) => [
            name,
            isObject(child) ? anthropicSchema(child) : child,
          ],
        ),
      );
    } else if (
      (key === 'items' ||
        key === 'not' ||
        key === 'if' ||
        key === 'then' ||
        key === 'else') &&
      isObject(value)
    ) {
      result[key] = anthropicSchema(value);
    } else if (
      (key === 'anyOf' ||
        key === 'allOf' ||
        key === 'oneOf' ||
        key === 'prefixItems') &&
      Array.isArray(value)
    ) {
      result[key] = value.map((child: unknown) =>
        isObject(child) ? anthropicSchema(child) : child,
      );
    } else {
      result[key] = value;
    }
  }

  if (source.type === 'object' || source.properties !== undefined) {
    result.additionalProperties = false;
  }

  if (constraints.length > 0) {
    const description =
      typeof source.description === 'string' ? source.description + ' ' : '';
    result.description = `${description}Constraints: ${constraints.join(', ')}.`;
  }

  return result;
}
