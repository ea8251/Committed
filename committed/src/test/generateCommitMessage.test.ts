import * as assert from 'assert';
import { Ollama } from 'ollama';

import { generateCommitMessage } from '../models/generateCommitMessage';

function createMockGenerateResponse(response: string) {
  return {
    response,
    model: 'mock',
    created_at: new Date(),
    done: true,
    done_reason: 'stop',
    total_duration: 0,
    load_duration: 0,
    prompt_eval_count: 0,
    prompt_eval_duration: 0,
    eval_count: 0,
    eval_duration: 0,
  };
}

async function withMockedGenerate<T>(
  response: string,
  run: (capturedPrompt: () => string | undefined) => Promise<T>
): Promise<T> {
  const originalGenerate = Ollama.prototype.generate;
  let promptText: string | undefined;

  (Ollama.prototype.generate as unknown as (request: { prompt?: unknown }) => Promise<unknown>) = async (request) => {
    promptText = typeof request.prompt === 'string' ? request.prompt : undefined;
    return createMockGenerateResponse(response) as Awaited<ReturnType<Ollama['generate']>>;
  };

  try {
    return await run(() => promptText);
  } finally {
    Ollama.prototype.generate = originalGenerate;
  }
}

suite('generateCommitMessage Test Suite', () => {
  test('returns parsed subject and body from valid JSON', async () => {
    const result = await withMockedGenerate(
      JSON.stringify({
        subject: 'feat(parser): add staged hunk summaries',
        body: 'Improves review flow by explaining why hunks were selected.',
      }),
      async (getPrompt) => {
        const message = await generateCommitMessage('Feature', 'diff --git a/src/a.ts b/src/a.ts');
        assert.ok(getPrompt()?.includes('Classification: Feature'));
        return message;
      }
    );

    assert.deepStrictEqual(result, {
      subject: 'feat(parser): add staged hunk summaries',
      body: 'Improves review flow by explaining why hunks were selected.',
    });
  });

  test('truncates large diffs before sending the prompt', async () => {
    const longDiff = 'x'.repeat(4050);

    await withMockedGenerate(
      JSON.stringify({ subject: 'fix: update code', body: '' }),
      async (getPrompt) => {
        await generateCommitMessage('Bug Fix', longDiff);

        const prompt = getPrompt();
        assert.ok(prompt);
        assert.ok(prompt!.includes('... [truncated]'));
        assert.ok(prompt!.includes(longDiff.slice(0, 4000)));
        assert.ok(!prompt!.includes(longDiff));
      }
    );
  });

  test('falls back to a conventional subject when JSON parsing fails', async () => {
    const expectations: Array<[string, string]> = [
      ['Bug Fix', 'fix: update code'],
      ['Feature', 'feat: update code'],
      ['Refactor', 'refactor: update code'],
      ['Chore', 'chore: update code'],
    ];

    for (const [classification, subject] of expectations) {
      const result = await withMockedGenerate('this is not json', async () =>
        generateCommitMessage(classification, 'diff --git a/src/a.ts b/src/a.ts')
      );

      assert.deepStrictEqual(result, { subject, body: '' });
    }
  });
});