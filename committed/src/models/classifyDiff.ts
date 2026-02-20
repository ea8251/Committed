import { Ollama } from "ollama";
import { z } from "zod";

const ClassifierSchema = z.object({
  reasoning: z.string().describe("Step-by-step analysis of the + and - lines before deciding"),
  result: z.boolean().describe("Whether the diff matches this classification"),
  confidence: z.number().min(0).max(1).describe("Confidence score for the classification"),
});

export type ClassifierResult = z.infer<typeof ClassifierSchema>;

// removing line numbers and other white space in the gitdiff before sending to the LLM
export function preprocessDiff(rawDiff: string): string {
  if (!rawDiff || rawDiff.trim() === "") {return "";}

  const lines = rawDiff.split("\n");
  const cleanedLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("index ")) {continue;}
    
    if (line.startsWith("GIT binary patch") || line.includes("Binary files")) {
      return "[BINARY FILE CHANGES OMITTED]";
    }

    cleanedLines.push(line);
  }

  return cleanedLines.join("\n").trim();
}

const createClassifierPrompt = (category: string, description: string, examples: string) => `
You are a code classification expert. Determine if the given git diff is PRIMARILY a ${category}.

SPECIAL CASE - EMPTY INPUT:
- If the diff is empty, contains no code changes, or is only binary files, return {"reasoning": "Empty or binary diff", "result": false, "confidence": 1.0}

${description}

${examples}

DECISION PROCESS (Chain of Thought):
1. Identify what specifically changed (look at the + and - lines).
2. Write a brief reasoning analyzing if those specific lines match the definition of a ${category}.
3. Based on your reasoning, set result to TRUE if it is primarily a ${category}, otherwise FALSE.
4. Set confidence based on how clearly the diff matches.

Respond ONLY with a JSON object (no markdown, no explanation outside the JSON):
{
  "reasoning": "<your step-by-step analysis>",
  "result": true/false,
  "confidence": <score between 0 and 1>
}

Git diff to analyze:
`;

const BUG_FIX_PROMPT = createClassifierPrompt(
  "bug fix",
  `A bug fix corrects BROKEN or INCORRECT behavior. The code was producing WRONG results or FAILING before this change.

KEY QUESTION: Is this change fixing something that was broken?

Signs this IS a bug fix (return TRUE):
- Off-by-one errors: "i <= length" → "i < length"
- Null/undefined safety: "x.prop" → "x?.prop" or adding null checks
- Wrong operators: "=" → "===" in comparisons
- Boundary condition corrections or fixing type errors

Signs this is NOT a bug fix (return FALSE):
- Adding entirely new functions (that's a feature)
- Restructuring working code (that's refactoring)
- Empty diff`,
  `EXAMPLES:
BUG FIX (TRUE):
-  for (let i = 0; i <= arr.length; i++) {
+  for (let i = 0; i < arr.length; i++) {  // Fix off-by-one

NOT A BUG FIX (FALSE - it's a feature):
+  exportToCSV(): string { return data.join(','); }`
);

const FEATURE_PROMPT = createClassifierPrompt(
  "feature",
  `A feature adds NEW functionality. The codebase can now do something it COULD NOT do before.

KEY QUESTION: Does this add new capabilities that didn't previously exist?

Signs this IS a feature (return TRUE):
- New functions, methods, or classes being added
- New API endpoints or routes
- New parameters enabling new use cases

Signs this is NOT a feature (return FALSE):
- Fixing broken code (that's a bug fix)
- Restructuring without adding capabilities (that's refactoring)`,
  `EXAMPLES:
FEATURE (TRUE):
+  async searchUsers(query: string): Promise<User[]> {
+    return this.db.search(query);
+  }

NOT A FEATURE (FALSE - it's a bug fix):
-  for (let i = 0; i <= arr.length; i++) {
+  for (let i = 0; i < arr.length; i++) {`
);

const REFACTORING_PROMPT = createClassifierPrompt(
  "refactoring",
  `Refactoring restructures WORKING code without changing observable behavior. Same outputs, different internal structure.

KEY QUESTION: Does the code do the SAME thing, just organized differently?

Signs this IS refactoring (return TRUE):
- Renaming variables/functions for clarity
- Converting callbacks to async/await (same behavior)
- Extracting repeated code into shared functions
- Removing unused code

Signs this is NOT refactoring (return FALSE):
- Fixing something that was broken (that's a bug fix)
- Adding new functionality (that's a feature)`,
  `EXAMPLES:
REFACTORING (TRUE):
-  function getData(id, callback) {
-    db.query(id, (err, data) => callback(err, data));
-  }
+  async function getData(id): Promise<Data> {
+    return await db.query(id);
+  }

NOT REFACTORING (FALSE - it's a bug fix):
-  return user.name;
+  return user?.name ?? 'Unknown';`
);

async function runClassifier(
  ollama: Ollama,
  prompt: string,
  rawDiffContent: string
): Promise<ClassifierResult> {
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
  } catch (error) {
    console.error("Failed to parse LLM response:", response.response);
    return {
      reasoning: "Failed to parse LLM output.",
      result: false,
      confidence: 0,
    };
  }
}

export async function classifyAsBugFix(
  diffContent: string,
  host: string = "http://localhost:11434"
): Promise<ClassifierResult> {
  const ollama = new Ollama({ host });
  return runClassifier(ollama, BUG_FIX_PROMPT, diffContent);
}

export async function classifyAsFeature(
  diffContent: string,
  host: string = "http://localhost:11434"
): Promise<ClassifierResult> {
  const ollama = new Ollama({ host });
  return runClassifier(ollama, FEATURE_PROMPT, diffContent);
}

export async function classifyAsRefactoring(
  diffContent: string,
  host: string = "http://localhost:11434"
): Promise<ClassifierResult> {
  const ollama = new Ollama({ host });
  return runClassifier(ollama, REFACTORING_PROMPT, diffContent);
}