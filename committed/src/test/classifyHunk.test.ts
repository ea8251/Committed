import * as assert from 'assert';
import { Ollama } from 'ollama';
import {
  preprocessHunk,
  classifyHunk,
  HunkRelevanceResult,
  ProjectContext,
} from '../models/classifyHunk';

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

async function withMockedOllamaResponse<T>(
  response: HunkRelevanceResult | string,
  run: () => Promise<T>
): Promise<T> {
  const originalGenerate = Ollama.prototype.generate;

  (Ollama.prototype.generate as unknown as () => Promise<unknown>) = async () =>
    createMockGenerateResponse(
      typeof response === 'string' ? response : JSON.stringify(response)
    );

  try {
    return await run();
  } finally {
    Ollama.prototype.generate = originalGenerate;
  }
}

suite('classifyHunk Test Suite', function () {
  this.timeout(60000);

  // ── Sample hunks ──────────────────────────────────────────────────────

  // Clear bug fix: off-by-one causing index out of bounds
  const bugFixHunk = `
@@ -15,8 +15,8 @@ export function parseTokens(tokens: string[]): Node[] {
   const nodes: Node[] = [];
-  for (let i = 0; i <= tokens.length; i++) {
-    const token = tokens[i];
+  for (let i = 0; i < tokens.length; i++) {
+    const token = tokens[i];
     if (token === undefined) {
       throw new Error('Unexpected undefined token');
     }
`;

  // Clear feature: adding new export methods
  const featureHunk = `
@@ -20,4 +20,25 @@ export class ReportGenerator {
   generatePDF(): Buffer {
     return this.renderToPDF(this.data);
   }
+
+  exportToCSV(): string {
+    const headers = Object.keys(this.data[0]).join(',');
+    const rows = this.data.map(row => Object.values(row).join(','));
+    return [headers, ...rows].join('\\n');
+  }
+
+  exportToJSON(): string {
+    return JSON.stringify(this.data, null, 2);
+  }
`;

  // Clear refactor: converting callbacks to async/await
  const refactorHunk = `
@@ -5,18 +5,12 @@ export class Database {
-  fetchUser(id: string, callback: (err: Error | null, user: User | null) => void) {
-    this.connection.query('SELECT * FROM users WHERE id = ?', [id], (err, rows) => {
-      if (err) {
-        callback(err, null);
-        return;
-      }
-      callback(null, rows[0] || null);
-    });
+  async fetchUser(id: string): Promise<User | null> {
+    const rows = await this.connection.query('SELECT * FROM users WHERE id = ?', [id]);
+    return rows[0] || null;
   }
`;

  const emptyHunk = '';

  // ── Project context used across tests ─────────────────────────────────

  const defaultContext: ProjectContext = {
    projectDescription: 'A TypeScript utility library for data processing',
    filePath: 'src/parser.ts',
  };

  const featureContext: ProjectContext = {
    projectDescription: 'A TypeScript utility library for data processing',
    filePath: 'src/report.ts',
    commitGoal: 'Add CSV and JSON export support',
    relatedFiles: ['src/report.ts', 'src/formatters.ts'],
  };

  const refactorContext: ProjectContext = {
    projectDescription: 'A TypeScript utility library for data processing',
    filePath: 'src/database.ts',
    commitGoal: 'Modernize database layer to async/await',
  };

  // ── preprocessHunk unit tests ─────────────────────────────────────────

  suite('preprocessHunk', () => {
    test('returns empty string for empty input', () => {
      assert.strictEqual(preprocessHunk(''), '');
    });

    test('returns empty string for whitespace-only input', () => {
      assert.strictEqual(preprocessHunk('   \n  \n  '), '');
    });

    test('keeps @@ header lines', () => {
      const hunk = '@@ -1,3 +1,3 @@\n some context\n-old\n+new';
      const result = preprocessHunk(hunk);
      assert.ok(result.includes('@@ -1,3 +1,3 @@'));
    });

    test('keeps added (+) lines', () => {
      const hunk = '@@ -1,3 +1,3 @@\n context\n+added line';
      const result = preprocessHunk(hunk);
      assert.ok(result.includes('+added line'));
    });

    test('keeps removed (-) lines', () => {
      const hunk = '@@ -1,3 +1,3 @@\n context\n-removed line';
      const result = preprocessHunk(hunk);
      assert.ok(result.includes('-removed line'));
    });

    test('keeps context (space-prefixed) lines', () => {
      const hunk = '@@ -1,3 +1,3 @@\n context line\n+new';
      const result = preprocessHunk(hunk);
      assert.ok(result.includes(' context line'));
    });

    test('strips non-hunk metadata lines', () => {
      const hunk = 'diff --git a/file.ts b/file.ts\nindex abc..def 100644\n--- a/file.ts\n+++ b/file.ts\n@@ -1,2 +1,2 @@\n-old\n+new';
      const result = preprocessHunk(hunk);
      assert.ok(!result.includes('diff --git'));
      assert.ok(!result.includes('index abc'));
      assert.ok(result.includes('@@ -1,2 +1,2 @@'));
      assert.ok(result.includes('-old'));
      assert.ok(result.includes('+new'));
    });
  });

  // ── classifyHunk unit tests (mocked Ollama responses) ─────────────────

  suite('Scenario 1: Bug Fix Hunk', () => {
    test('classified as bug fix', async () => {
      const expected: HunkRelevanceResult = {
        reasoning: 'Mock: off-by-one correction fixes broken behavior',
        relevant: true,
        confidence: 0.95,
      };

      const result = await withMockedOllamaResponse(expected, () =>
        classifyHunk(bugFixHunk, 'bug fix', defaultContext)
      );

      assert.deepStrictEqual(result, expected);
    });

    test('classified as feature', async () => {
      const expected: HunkRelevanceResult = {
        reasoning: 'Mock: this hunk fixes existing behavior rather than adding capability',
        relevant: false,
        confidence: 0.1,
      };

      const result = await withMockedOllamaResponse(expected, () =>
        classifyHunk(bugFixHunk, 'feature', defaultContext)
      );

      assert.deepStrictEqual(result, expected);
    });

    test('classified as refactor', async () => {
      const expected: HunkRelevanceResult = {
        reasoning: 'Mock: this is a bug fix rather than a structural cleanup',
        relevant: false,
        confidence: 0.15,
      };

      const result = await withMockedOllamaResponse(expected, () =>
        classifyHunk(bugFixHunk, 'refactor', defaultContext)
      );

      assert.deepStrictEqual(result, expected);
    });
  });

  suite('Scenario 2: Feature Hunk', () => {
    test('classified as bug fix', async () => {
      const expected: HunkRelevanceResult = {
        reasoning: 'Mock: new export methods are new capability, not a fix',
        relevant: false,
        confidence: 0.1,
      };

      const result = await withMockedOllamaResponse(expected, () =>
        classifyHunk(featureHunk, 'bug fix', featureContext)
      );

      assert.deepStrictEqual(result, expected);
    });

    test('classified as feature', async () => {
      const expected: HunkRelevanceResult = {
        reasoning: 'Mock: new export functions add user-visible functionality',
        relevant: true,
        confidence: 0.97,
      };

      const result = await withMockedOllamaResponse(expected, () =>
        classifyHunk(featureHunk, 'feature', featureContext)
      );

      assert.deepStrictEqual(result, expected);
    });

    test('classified as refactor', async () => {
      const expected: HunkRelevanceResult = {
        reasoning: 'Mock: observable behavior is expanded, so this is not a refactor',
        relevant: false,
        confidence: 0.12,
      };

      const result = await withMockedOllamaResponse(expected, () =>
        classifyHunk(featureHunk, 'refactor', featureContext)
      );

      assert.deepStrictEqual(result, expected);
    });
  });

  suite('Scenario 3: Refactor Hunk', () => {
    test('classified as bug fix', async () => {
      const expected: HunkRelevanceResult = {
        reasoning: 'Mock: callback-to-async conversion preserves behavior instead of fixing a defect',
        relevant: false,
        confidence: 0.1,
      };

      const result = await withMockedOllamaResponse(expected, () =>
        classifyHunk(refactorHunk, 'bug fix', refactorContext)
      );

      assert.deepStrictEqual(result, expected);
    });

    test('classified as feature', async () => {
      const expected: HunkRelevanceResult = {
        reasoning: 'Mock: this keeps the same behavior and is not a feature',
        relevant: false,
        confidence: 0.08,
      };

      const result = await withMockedOllamaResponse(expected, () =>
        classifyHunk(refactorHunk, 'feature', refactorContext)
      );

      assert.deepStrictEqual(result, expected);
    });

    test('classified as refactor', async () => {
      const expected: HunkRelevanceResult = {
        reasoning: 'Mock: async/await conversion is a pure structural refactor',
        relevant: true,
        confidence: 0.94,
      };

      const result = await withMockedOllamaResponse(expected, () =>
        classifyHunk(refactorHunk, 'refactor', refactorContext)
      );

      assert.deepStrictEqual(result, expected);
    });
  });

  suite('Scenario 4: Empty Hunk', () => {
    test('classified as bug fix', async () => {
      const expected: HunkRelevanceResult = {
        reasoning: 'Empty hunk',
        relevant: false,
        confidence: 1,
      };

      const result = await withMockedOllamaResponse(expected, () =>
        classifyHunk(emptyHunk, 'bug fix', defaultContext)
      );

      assert.deepStrictEqual(result, expected);
    });

    test('classified as feature', async () => {
      const expected: HunkRelevanceResult = {
        reasoning: 'Empty hunk',
        relevant: false,
        confidence: 1,
      };

      const result = await withMockedOllamaResponse(expected, () =>
        classifyHunk(emptyHunk, 'feature', defaultContext)
      );

      assert.deepStrictEqual(result, expected);
    });

    test('classified as refactor', async () => {
      const expected: HunkRelevanceResult = {
        reasoning: 'Empty hunk',
        relevant: false,
        confidence: 1,
      };

      const result = await withMockedOllamaResponse(expected, () =>
        classifyHunk(emptyHunk, 'refactor', defaultContext)
      );

      assert.deepStrictEqual(result, expected);
    });
  });

  suite('parse fallback', () => {
    test('returns fallback result when Ollama response is not valid JSON', async () => {
      const result = await withMockedOllamaResponse('not-json', () =>
        classifyHunk(bugFixHunk, 'bug fix', defaultContext)
      );

      assert.deepStrictEqual(result, {
        reasoning: 'Failed to parse LLM output.',
        relevant: false,
        confidence: 0,
      });
    });
  });
});

function assertValidHunkResult(result: HunkRelevanceResult) {
  assert.ok(typeof result.reasoning === 'string', 'reasoning should be a string');
  assert.ok(result.reasoning.length > 0, 'reasoning should not be empty');
  assert.ok(typeof result.relevant === 'boolean', 'relevant should be a boolean');
  assert.ok(typeof result.confidence === 'number', 'confidence should be a number');
  assert.ok(
    result.confidence >= 0 && result.confidence <= 1,
    'confidence should be between 0 and 1'
  );
}
