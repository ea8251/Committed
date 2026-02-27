"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const classifyDiff_1 = require("../models/classifyDiff");
/**
 * Creates a mock Ollama client that returns a predetermined JSON response
 * from its `generate` method, avoiding real network calls in CI.
 */
function createMockOllama(response) {
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
    };
}
suite('classifyDiff Test Suite', function () {
    this.timeout(60000);
    // Predetermined mock responses for each classifier type
    const mockBugFixTrue = { reasoning: 'Mock: detected bug fix', result: true, confidence: 0.95 };
    const mockBugFixFalse = { reasoning: 'Mock: not a bug fix', result: false, confidence: 0.9 };
    const mockFeatureTrue = { reasoning: 'Mock: detected feature', result: true, confidence: 0.95 };
    const mockFeatureFalse = { reasoning: 'Mock: not a feature', result: false, confidence: 0.9 };
    const mockRefactoringTrue = { reasoning: 'Mock: detected refactoring', result: true, confidence: 0.95 };
    const mockRefactoringFalse = { reasoning: 'Mock: not refactoring', result: false, confidence: 0.9 };
    const mockEmptyResult = { reasoning: 'Empty or binary diff', result: false, confidence: 1.0 };
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
            const result = await (0, classifyDiff_1.classifyAsBugFix)(bugFixDiff, undefined, mock);
            console.log('Bug Fix Classifier:', JSON.stringify(result));
            assertValidClassifierResult(result);
        });
        test('Feature Classifier', async () => {
            const mock = createMockOllama(mockFeatureFalse);
            const result = await (0, classifyDiff_1.classifyAsFeature)(bugFixDiff, undefined, mock);
            console.log('Feature Classifier:', JSON.stringify(result));
            assertValidClassifierResult(result);
        });
        test('Refactoring Classifier', async () => {
            const mock = createMockOllama(mockRefactoringFalse);
            const result = await (0, classifyDiff_1.classifyAsRefactoring)(bugFixDiff, undefined, mock);
            console.log('Refactoring Classifier:', JSON.stringify(result));
            assertValidClassifierResult(result);
        });
    });
    suite('Scenario 2: Refactoring Diff', () => {
        test('Bug Fix Classifier', async () => {
            const mock = createMockOllama(mockBugFixFalse);
            const result = await (0, classifyDiff_1.classifyAsBugFix)(refactoringDiff, undefined, mock);
            console.log('Bug Fix Classifier:', JSON.stringify(result));
            assertValidClassifierResult(result);
        });
        test('Feature Classifier', async () => {
            const mock = createMockOllama(mockFeatureFalse);
            const result = await (0, classifyDiff_1.classifyAsFeature)(refactoringDiff, undefined, mock);
            console.log('Feature Classifier:', JSON.stringify(result));
            assertValidClassifierResult(result);
        });
        test('Refactoring Classifier', async () => {
            const mock = createMockOllama(mockRefactoringTrue);
            const result = await (0, classifyDiff_1.classifyAsRefactoring)(refactoringDiff, undefined, mock);
            console.log('Refactoring Classifier:', JSON.stringify(result));
            assertValidClassifierResult(result);
        });
    });
    suite('Scenario 3: Feature Diff', () => {
        test('Bug Fix Classifier', async () => {
            const mock = createMockOllama(mockBugFixFalse);
            const result = await (0, classifyDiff_1.classifyAsBugFix)(featureDiff, undefined, mock);
            console.log('Bug Fix Classifier:', JSON.stringify(result));
            assertValidClassifierResult(result);
        });
        test('Feature Classifier', async () => {
            const mock = createMockOllama(mockFeatureTrue);
            const result = await (0, classifyDiff_1.classifyAsFeature)(featureDiff, undefined, mock);
            console.log('Feature Classifier:', JSON.stringify(result));
            assertValidClassifierResult(result);
        });
        test('Refactoring Classifier', async () => {
            const mock = createMockOllama(mockRefactoringFalse);
            const result = await (0, classifyDiff_1.classifyAsRefactoring)(featureDiff, undefined, mock);
            console.log('Refactoring Classifier:', JSON.stringify(result));
            assertValidClassifierResult(result);
        });
    });
    suite('Scenario 4: Empty Diff', () => {
        test('Bug Fix Classifier', async () => {
            const mock = createMockOllama(mockEmptyResult);
            const result = await (0, classifyDiff_1.classifyAsBugFix)(emptyDiff, undefined, mock);
            console.log('Bug Fix Classifier:', JSON.stringify(result));
            assertValidClassifierResult(result);
        });
        test('Feature Classifier', async () => {
            const mock = createMockOllama(mockEmptyResult);
            const result = await (0, classifyDiff_1.classifyAsFeature)(emptyDiff, undefined, mock);
            console.log('Feature Classifier:', JSON.stringify(result));
            assertValidClassifierResult(result);
        });
        test('Refactoring Classifier', async () => {
            const mock = createMockOllama(mockEmptyResult);
            const result = await (0, classifyDiff_1.classifyAsRefactoring)(emptyDiff, undefined, mock);
            console.log('Refactoring Classifier:', JSON.stringify(result));
            assertValidClassifierResult(result);
        });
    });
});
function assertValidClassifierResult(result) {
    assert.ok(typeof result.result === 'boolean', 'result should be a boolean');
    assert.ok(typeof result.confidence === 'number', 'confidence should be a number');
    assert.ok(result.confidence >= 0 && result.confidence <= 1, 'confidence should be between 0 and 1');
}
//# sourceMappingURL=classifyDiff.test.js.map