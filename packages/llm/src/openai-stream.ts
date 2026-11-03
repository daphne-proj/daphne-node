import { ModelError, object } from './response.js';

/*
 * The transport calls this for OpenAI generation, for example readOpenAIStream(response).
 * Receiving events during generation avoids idle connection cutoffs. Buffer the
 * body under the transport's existing abort signal, then return the terminal
 * response unchanged so decoding, replay and usage accounting keep their inputs.
 * Partial output is never accepted; failed/incomplete responses reach the normal
 * decoder, while missing terminal events and stream errors fail here.
 */
export async function readOpenAIStream(
  response: Response,
): Promise<Record<string, unknown>> {
  if (
    response.headers.get('content-type')?.split(';')[0]?.trim() !==
    'text/event-stream'
  ) {
    throw new ModelError('OpenAI did not return an event stream.');
  }

  const text = await response.text();
  const lines = text.split(/\r\n|\r|\n/);
  /* A trailing fragment is not a terminated SSE line, including the empty fragment at EOF. */
  lines.pop();
  let data: string[] = [];

  for (const line of lines) {
    if (line.startsWith('data:')) {
      data.push(line.slice(5).replace(/^ /, ''));
      continue;
    }

    if (line !== '' || data.length === 0) {
      continue;
    }

    const event = object(JSON.parse(data.join('\n')), 'OpenAI');
    data = [];

    if (
      event.type === 'response.completed' ||
      event.type === 'response.failed' ||
      event.type === 'response.incomplete'
    ) {
      const result = object(event.response, 'OpenAI');

      if (result.status !== event.type.slice('response.'.length)) {
        throw new ModelError('OpenAI returned an inconsistent terminal event.');
      }

      return result;
    }

    if (event.type === 'error') {
      const detail =
        typeof event.message === 'string'
          ? `: ${event.message.slice(0, 1000)}`
          : '';

      throw new ModelError(`OpenAI stream failed${detail}.`);
    }
  }

  throw new ModelError('OpenAI stream ended without a terminal response.');
}
