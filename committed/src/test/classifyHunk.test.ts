import * as assert from 'assert';
import {
  preprocessHunk,
  classifyHunk,
  HunkClassification,
  HunkRelevanceResult,
  ProjectContext,
} from '../models/classifyHunk';

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

  // ── classifyHunk integration tests (require Ollama) ───────────────────

  suite('Scenario 1: Bug Fix Hunk', () => {
    test('classified as bug fix', async () => {
      const result = await classifyHunk(bugFixHunk, 'bug fix', defaultContext);
      console.log('Bug Fix Hunk → bug fix:', JSON.stringify(result));
      assertValidHunkResult(result);
    });

    test('classified as feature', async () => {
      const result = await classifyHunk(bugFixHunk, 'feature', defaultContext);
      console.log('Bug Fix Hunk → feature:', JSON.stringify(result));
      assertValidHunkResult(result);
    });

    test('classified as refactor', async () => {
      const result = await classifyHunk(bugFixHunk, 'refactor', defaultContext);
      console.log('Bug Fix Hunk → refactor:', JSON.stringify(result));
      assertValidHunkResult(result);
    });
  });

  suite('Scenario 2: Feature Hunk', () => {
    test('classified as bug fix', async () => {
      const result = await classifyHunk(featureHunk, 'bug fix', featureContext);
      console.log('Feature Hunk → bug fix:', JSON.stringify(result));
      assertValidHunkResult(result);
    });

    test('classified as feature', async () => {
      const result = await classifyHunk(featureHunk, 'feature', featureContext);
      console.log('Feature Hunk → feature:', JSON.stringify(result));
      assertValidHunkResult(result);
    });

    test('classified as refactor', async () => {
      const result = await classifyHunk(featureHunk, 'refactor', featureContext);
      console.log('Feature Hunk → refactor:', JSON.stringify(result));
      assertValidHunkResult(result);
    });
  });

  suite('Scenario 3: Refactor Hunk', () => {
    test('classified as bug fix', async () => {
      const result = await classifyHunk(refactorHunk, 'bug fix', refactorContext);
      console.log('Refactor Hunk → bug fix:', JSON.stringify(result));
      assertValidHunkResult(result);
    });

    test('classified as feature', async () => {
      const result = await classifyHunk(refactorHunk, 'feature', refactorContext);
      console.log('Refactor Hunk → feature:', JSON.stringify(result));
      assertValidHunkResult(result);
    });

    test('classified as refactor', async () => {
      const result = await classifyHunk(refactorHunk, 'refactor', refactorContext);
      console.log('Refactor Hunk → refactor:', JSON.stringify(result));
      assertValidHunkResult(result);
    });
  });

  suite('Scenario 4: Empty Hunk', () => {
    test('classified as bug fix', async () => {
      const result = await classifyHunk(emptyHunk, 'bug fix', defaultContext);
      console.log('Empty Hunk → bug fix:', JSON.stringify(result));
      assertValidHunkResult(result);
    });

    test('classified as feature', async () => {
      const result = await classifyHunk(emptyHunk, 'feature', defaultContext);
      console.log('Empty Hunk → feature:', JSON.stringify(result));
      assertValidHunkResult(result);
    });

    test('classified as refactor', async () => {
      const result = await classifyHunk(emptyHunk, 'refactor', defaultContext);
      console.log('Empty Hunk → refactor:', JSON.stringify(result));
      assertValidHunkResult(result);
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
