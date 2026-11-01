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
 */
export function anthropicSchema(schema: object): Record<string, unknown> {
  const source = object(schema, 'Anthropic schema');
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
