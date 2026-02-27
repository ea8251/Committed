import * as assert from 'assert';
import { Ollama } from 'ollama';
import { 
  classifyAsBugFix, 
  classifyAsFeature, 
  classifyAsRefactoring,
  ClassifierResult
} from '../models/classifyDiff';

/**
 * Creates a mock Ollama client that returns a predetermined JSON response
 * from its `generate` method, avoiding real network calls in CI.
 */
function createMockOllama(response: ClassifierResult): Ollama {
  return {
    generate: async () => ({
      response: JSON.stringify(response),
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
    }),
  } as unknown as Ollama;
}

suite('classifyDiff Test Suite', function () {
  this.timeout(60000);

  // Predetermined mock responses for each classifier type
  const mockBugFixTrue: ClassifierResult = { reasoning: 'Mock: detected bug fix', result: true, confidence: 0.95 };
  const mockBugFixFalse: ClassifierResult = { reasoning: 'Mock: not a bug fix', result: false, confidence: 0.9 };
  const mockFeatureTrue: ClassifierResult = { reasoning: 'Mock: detected feature', result: true, confidence: 0.95 };
  const mockFeatureFalse: ClassifierResult = { reasoning: 'Mock: not a feature', result: false, confidence: 0.9 };
  const mockRefactoringTrue: ClassifierResult = { reasoning: 'Mock: detected refactoring', result: true, confidence: 0.95 };
  const mockRefactoringFalse: ClassifierResult = { reasoning: 'Mock: not refactoring', result: false, confidence: 0.9 };
  const mockEmptyResult: ClassifierResult = { reasoning: 'Empty or binary diff', result: false, confidence: 1.0 };

  // Clear bug fix: fixing an off-by-one error causing array out of bounds
  const bugFixDiff = `
diff --git a/src/parser.ts b/src/parser.ts
--- a/src/parser.ts
+++ b/src/parser.ts
@@ -15,8 +15,8 @@ export function parseTokens(tokens: string[]): Node[] {
   const nodes: Node[] = [];
-  for (let i = 0; i <= tokens.length; i++) {
-    const token = tokens[i];
+  for (let i = 0; i < tokens.length; i++) {  // Bug fix: was causing index out of bounds
+    const token = tokens[i];
     if (token === undefined) {
       throw new Error('Unexpected undefined token');
     }
`;

  // Clear feature: adding entirely new export functionality
  const featureDiff = `
diff --git a/src/report.ts b/src/report.ts
--- a/src/report.ts
+++ b/src/report.ts
@@ -20,4 +20,25 @@ export class ReportGenerator {
   generatePDF(): Buffer {
     return this.renderToPDF(this.data);
   }
+
+  // New feature: Export reports to multiple formats
+  exportToCSV(): string {
+    const headers = Object.keys(this.data[0]).join(',');
+    const rows = this.data.map(row => Object.values(row).join(','));
+    return [headers, ...rows].join('\\n');
+  }
+
+  exportToJSON(): string {
+    return JSON.stringify(this.data, null, 2);
+  }
+
+  exportToXML(): string {
+    return this.data.map(row => 
+      '<record>' + 
+      Object.entries(row).map(([k, v]) => \`<\${k}>\${v}</\${k}>\`).join('') +
+      '</record>'
+    ).join('\\n');
+  }
 }
`;

  // Clear refactoring: converting callback-based code to async/await (same behavior)
  const refactoringDiff = `
diff --git a/src/database.ts b/src/database.ts
--- a/src/database.ts
+++ b/src/database.ts
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
 
-  fetchAllUsers(callback: (err: Error | null, users: User[]) => void) {
-    this.connection.query('SELECT * FROM users', (err, rows) => {
-      if (err) {
-        callback(err, []);
-        return;
-      }
-      callback(null, rows);
-    });
+  async fetchAllUsers(): Promise<User[]> {
+    const rows = await this.connection.query('SELECT * FROM users');
+    return rows;
   }
 }
`;

  const emptyDiff = '';

  suite('Scenario 1: Bug Fix Diff', () => {
    test('Bug Fix Classifier', async () => {
      const mock = createMockOllama(mockBugFixTrue);
      const result = await classifyAsBugFix(bugFixDiff, undefined, mock);
      console.log('Bug Fix Classifier:', JSON.stringify(result));
      assertValidClassifierResult(result);
    });

    test('Feature Classifier', async () => {
      const mock = createMockOllama(mockFeatureFalse);
      const result = await classifyAsFeature(bugFixDiff, undefined, mock);
      console.log('Feature Classifier:', JSON.stringify(result));
      assertValidClassifierResult(result);
    });

    test('Refactoring Classifier', async () => {
      const mock = createMockOllama(mockRefactoringFalse);
      const result = await classifyAsRefactoring(bugFixDiff, undefined, mock);
      console.log('Refactoring Classifier:', JSON.stringify(result));
      assertValidClassifierResult(result);
    });
  });

  suite('Scenario 2: Refactoring Diff', () => {
    test('Bug Fix Classifier', async () => {
      const mock = createMockOllama(mockBugFixFalse);
      const result = await classifyAsBugFix(refactoringDiff, undefined, mock);
      console.log('Bug Fix Classifier:', JSON.stringify(result));
      assertValidClassifierResult(result);
    });

    test('Feature Classifier', async () => {
      const mock = createMockOllama(mockFeatureFalse);
      const result = await classifyAsFeature(refactoringDiff, undefined, mock);
      console.log('Feature Classifier:', JSON.stringify(result));
      assertValidClassifierResult(result);
    });

    test('Refactoring Classifier', async () => {
      const mock = createMockOllama(mockRefactoringTrue);
      const result = await classifyAsRefactoring(refactoringDiff, undefined, mock);
      console.log('Refactoring Classifier:', JSON.stringify(result));
      assertValidClassifierResult(result);
    });
  });

  suite('Scenario 3: Feature Diff', () => {
    test('Bug Fix Classifier', async () => {
      const mock = createMockOllama(mockBugFixFalse);
      const result = await classifyAsBugFix(featureDiff, undefined, mock);
      console.log('Bug Fix Classifier:', JSON.stringify(result));
      assertValidClassifierResult(result);
    });

    test('Feature Classifier', async () => {
      const mock = createMockOllama(mockFeatureTrue);
      const result = await classifyAsFeature(featureDiff, undefined, mock);
      console.log('Feature Classifier:', JSON.stringify(result));
      assertValidClassifierResult(result);
    });

    test('Refactoring Classifier', async () => {
      const mock = createMockOllama(mockRefactoringFalse);
      const result = await classifyAsRefactoring(featureDiff, undefined, mock);
      console.log('Refactoring Classifier:', JSON.stringify(result));
      assertValidClassifierResult(result);
    });
  });

  suite('Scenario 4: Empty Diff', () => {
    test('Bug Fix Classifier', async () => {
      const mock = createMockOllama(mockEmptyResult);
      const result = await classifyAsBugFix(emptyDiff, undefined, mock);
      console.log('Bug Fix Classifier:', JSON.stringify(result));
      assertValidClassifierResult(result);
    });

    test('Feature Classifier', async () => {
      const mock = createMockOllama(mockEmptyResult);
      const result = await classifyAsFeature(emptyDiff, undefined, mock);
      console.log('Feature Classifier:', JSON.stringify(result));
      assertValidClassifierResult(result);
    });

    test('Refactoring Classifier', async () => {
      const mock = createMockOllama(mockEmptyResult);
      const result = await classifyAsRefactoring(emptyDiff, undefined, mock);
      console.log('Refactoring Classifier:', JSON.stringify(result));
      assertValidClassifierResult(result);
    });
  });

});

function assertValidClassifierResult(result: ClassifierResult) {
  assert.ok(typeof result.result === 'boolean', 'result should be a boolean');
  assert.ok(typeof result.confidence === 'number', 'confidence should be a number');
  assert.ok(result.confidence >= 0 && result.confidence <= 1, 'confidence should be between 0 and 1');
}
