"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.preprocessDiff = preprocessDiff;
exports.classifyAsBugFix = classifyAsBugFix;
exports.classifyAsFeature = classifyAsFeature;
exports.classifyAsRefactoring = classifyAsRefactoring;
const ollama_1 = require("ollama");
const zod_1 = require("zod");
const ClassifierSchema = zod_1.z.object({
    reasoning: zod_1.z.string().describe("Step-by-step analysis of the + and - lines before deciding"),
    probability: zod_1.z.coerce.number().min(0).max(1).describe("Probability that this diff is of this classification type, between 0 and 1"),
});
// removing line numbers and other white space in the gitdiff before sending to the LLM
function preprocessDiff(rawDiff) {
    if (!rawDiff || rawDiff.trim() === "") {
        return "";
    }
    const lines = rawDiff.split("\n");
    const cleanedLines = [];
    for (const line of lines) {
        if (line.startsWith("index ")) {
            continue;
        }
        // Skip binary file markers instead of aborting the entire diff
        if (line.startsWith("GIT binary patch") || line.includes("Binary files")) {
            continue;
        }
        cleanedLines.push(line);
    }
    return cleanedLines.join("\n").trim();
}
const createClassifierPrompt = (category, description, examples) => `
You are a code classification expert. Analyze the given git diff and determine how likely it is to be PRIMARILY a ${category}.

SPECIAL CASE - EMPTY INPUT:
- If the diff is empty, contains no code changes, or is only binary files, return {"reasoning": "Empty or binary diff", "probability": 0.0}

${description}

${examples}

DECISION PROCESS (Chain of Thought):
1. Identify what specifically changed (look at the + and - lines).
2. Write a brief reasoning analyzing if those specific lines match the definition of a ${category}.
3. Set probability between 0 and 1 representing how likely this diff is a ${category}. High values (0.8-1.0) mean it clearly is, low values (0.0-0.2) mean it clearly is not.

Respond ONLY with a JSON object (no markdown, no explanation outside the JSON):
{
  "reasoning": "<your step-by-step analysis>",
  "probability": <score between 0 and 1>
}

Git diff to analyze:
`;
const BUG_FIX_PROMPT = createClassifierPrompt("bug fix", `A bug fix corrects BROKEN or INCORRECT behavior. The code was producing WRONG results or FAILING before this change.

KEY QUESTION: Is this change fixing something that was broken?

HIGH probability (0.8-1.0):
- Off-by-one errors: "i <= length" → "i < length"
- Null/undefined safety: "x.prop" → "x?.prop" or adding null checks
- Wrong operators: "=" → "===" in comparisons
- Boundary condition corrections or fixing type errors

LOW probability (0.0-0.2):
- Adding entirely new functions (that's a feature)
- Restructuring working code (that's refactoring)
- Empty diff`, `EXAMPLES:
High probability bug fix (probability: 0.95):
-  for (let i = 0; i <= arr.length; i++) {
+  for (let i = 0; i < arr.length; i++) {  // Fix off-by-one

Low probability bug fix (probability: 0.1) — this is a feature, not a bug fix:
+  exportToCSV(): string { return data.join(','); }`);
const FEATURE_PROMPT = createClassifierPrompt("feature", `A feature adds NEW functionality. The codebase can now do something it COULD NOT do before.

KEY QUESTION: Does this add new capabilities that didn't previously exist?

HIGH probability (0.8-1.0):
- New functions, methods, or classes being added
- New API endpoints or routes
- New parameters enabling new use cases

LOW probability (0.0-0.2):
- Fixing broken code (that's a bug fix)
- Restructuring without adding capabilities (that's refactoring)`, `EXAMPLES:
High probability feature (probability: 0.95):
+  async searchUsers(query: string): Promise<User[]> {
+    return this.db.search(query);
+  }

Low probability feature (probability: 0.1) — this is a bug fix, not a feature:
-  for (let i = 0; i <= arr.length; i++) {
+  for (let i = 0; i < arr.length; i++) {`);
const REFACTORING_PROMPT = createClassifierPrompt("refactoring", `Refactoring restructures WORKING code without changing observable behavior. Same outputs, different internal structure.

KEY QUESTION: Does the code do the SAME thing, just organized differently?

HIGH probability (0.8-1.0):
- Renaming variables/functions for clarity
- Converting callbacks to async/await (same behavior)
- Extracting repeated code into shared functions
- Removing unused code

LOW probability (0.0-0.2):
- Fixing something that was broken (that's a bug fix)
- Adding new functionality (that's a feature)`, `EXAMPLES:
High probability refactoring (probability: 0.95):
-  function getData(id, callback) {
-    db.query(id, (err, data) => callback(err, data));
-  }
+  async function getData(id): Promise<Data> {
+    return await db.query(id);
+  }

Low probability refactoring (probability: 0.1) — this is a bug fix, not refactoring:
-  return user.name;
+  return user?.name ?? 'Unknown';`);
async function runClassifier(ollama, prompt, rawDiffContent) {
    const cleanedDiff = preprocessDiff(rawDiffContent);
    const response = await ollama.generate({
        model: "llama3.2",
        system: "You are a specialized code classifier. You output high-precision JSON analysis of git diffs.",
        prompt: prompt + "\n" + cleanedDiff,
        format: "json",
        stream: false,
        options: {
            temperature: 0,
            num_predict: 500,
        }
    });
    try {
        const parsed = JSON.parse(response.response);
        return ClassifierSchema.parse(parsed);
    }
    catch (error) {
        console.error("Failed to parse LLM response:", response.response, "Error:", error);
        return {
            reasoning: "Failed to parse LLM output.",
            probability: 0,
        };
    }
}
async function classifyAsBugFix(diffContent, host = "http://localhost:11434", ollamaClient) {
    const ollama = ollamaClient ?? new ollama_1.Ollama({ host });
    return runClassifier(ollama, BUG_FIX_PROMPT, diffContent);
}
async function classifyAsFeature(diffContent, host = "http://localhost:11434", ollamaClient) {
    const ollama = ollamaClient ?? new ollama_1.Ollama({ host });
    return runClassifier(ollama, FEATURE_PROMPT, diffContent);
}
async function classifyAsRefactoring(diffContent, host = "http://localhost:11434", ollamaClient) {
    const ollama = ollamaClient ?? new ollama_1.Ollama({ host });
    return runClassifier(ollama, REFACTORING_PROMPT, diffContent);
}
//# sourceMappingURL=classifyDiff.js.map