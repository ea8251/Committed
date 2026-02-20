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
suite('classifyDiff Test Suite', function () {
    this.timeout(60000);
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
            const result = await (0, classifyDiff_1.classifyAsBugFix)(bugFixDiff);
            console.log('Bug Fix Classifier:', JSON.stringify(result));
            assertValidClassifierResult(result);
        });
        test('Feature Classifier', async () => {
            const result = await (0, classifyDiff_1.classifyAsFeature)(bugFixDiff);
            console.log('Feature Classifier:', JSON.stringify(result));
            assertValidClassifierResult(result);
        });
        test('Refactoring Classifier', async () => {
            const result = await (0, classifyDiff_1.classifyAsRefactoring)(bugFixDiff);
            console.log('Refactoring Classifier:', JSON.stringify(result));
            assertValidClassifierResult(result);
        });
    });
    suite('Scenario 2: Refactoring Diff', () => {
        test('Bug Fix Classifier', async () => {
            const result = await (0, classifyDiff_1.classifyAsBugFix)(refactoringDiff);
            console.log('Bug Fix Classifier:', JSON.stringify(result));
            assertValidClassifierResult(result);
        });
        test('Feature Classifier', async () => {
            const result = await (0, classifyDiff_1.classifyAsFeature)(refactoringDiff);
            console.log('Feature Classifier:', JSON.stringify(result));
            assertValidClassifierResult(result);
        });
        test('Refactoring Classifier', async () => {
            const result = await (0, classifyDiff_1.classifyAsRefactoring)(refactoringDiff);
            console.log('Refactoring Classifier:', JSON.stringify(result));
            assertValidClassifierResult(result);
        });
    });
    suite('Scenario 3: Feature Diff', () => {
        test('Bug Fix Classifier', async () => {
            const result = await (0, classifyDiff_1.classifyAsBugFix)(featureDiff);
            console.log('Bug Fix Classifier:', JSON.stringify(result));
            assertValidClassifierResult(result);
        });
        test('Feature Classifier', async () => {
            const result = await (0, classifyDiff_1.classifyAsFeature)(featureDiff);
            console.log('Feature Classifier:', JSON.stringify(result));
            assertValidClassifierResult(result);
        });
        test('Refactoring Classifier', async () => {
            const result = await (0, classifyDiff_1.classifyAsRefactoring)(featureDiff);
            console.log('Refactoring Classifier:', JSON.stringify(result));
            assertValidClassifierResult(result);
        });
    });
    suite('Scenario 4: Empty Diff', () => {
        test('Bug Fix Classifier', async () => {
            const result = await (0, classifyDiff_1.classifyAsBugFix)(emptyDiff);
            console.log('Bug Fix Classifier:', JSON.stringify(result));
            assertValidClassifierResult(result);
        });
        test('Feature Classifier', async () => {
            const result = await (0, classifyDiff_1.classifyAsFeature)(emptyDiff);
            console.log('Feature Classifier:', JSON.stringify(result));
            assertValidClassifierResult(result);
        });
        test('Refactoring Classifier', async () => {
            const result = await (0, classifyDiff_1.classifyAsRefactoring)(emptyDiff);
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