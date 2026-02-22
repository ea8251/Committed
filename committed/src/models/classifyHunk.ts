import { Ollama } from "ollama";
import { z } from "zod";

/**
 * Supported classification categories for a hunk.
 */
export type HunkClassification = "bug fix" | "refactor" | "feature";

/**
 * Context about the project that helps the LLM make better decisions.
 */
export interface ProjectContext {
  /** Short description of what the project does */
  projectDescription: string;
  /** The file path the hunk originates from */
  filePath: string;
  /** Optional summary of recent commit messages or the goal of the current work */
  commitGoal?: string;
  /** Optional list of related file paths being changed in the same session */
  relatedFiles?: string[];
}

const HunkRelevanceSchema = z.object({
  reasoning: z.string().describe(
    "Step-by-step analysis of the hunk content, the target classification, and the project context before deciding"
  ),
  relevant: z.boolean().describe(
    "Whether this hunk is part of the given classification"
  ),
  confidence: z.number().min(0).max(1).describe(
    "Confidence score for the relevance decision"
  ),
});

export type HunkRelevanceResult = z.infer<typeof HunkRelevanceSchema>;

/**
 * Strip git hunk metadata noise while keeping the actual change lines.
 */
export function preprocessHunk(rawHunk: string): string {
  if (!rawHunk || rawHunk.trim() === "") {
    return "";
  }

  const lines = rawHunk.split("\n");
  const cleaned: string[] = [];

  for (const line of lines) {
    // Keep hunk header (@@ ... @@), context lines, and +/- lines
    if (
      line.startsWith("@@") ||
      line.startsWith("+") ||
      line.startsWith("-") ||
      line.startsWith(" ")
    ) {
      cleaned.push(line);
    }
  }

  return cleaned.join("\n").trim();
}

/**
 * Build classification-specific guidance so the LLM knows what to look for.
 */
function classificationGuidance(classification: HunkClassification): string {
  switch (classification) {
    case "bug fix":
      return `A bug fix corrects BROKEN or INCORRECT behavior. The code was producing WRONG results or FAILING.

Signs a hunk is part of a bug fix:
- Off-by-one corrections, null/undefined safety additions
- Wrong operator fixes ("=" → "==="), boundary condition corrections
- Error handling additions that fix crashes
- Small targeted changes that correct specific misbehavior

Signs a hunk is NOT part of a bug fix:
- Adding entirely new functions or capabilities (that's a feature)
- Restructuring working code without fixing broken behavior (that's a refactor)`;

    case "feature":
      return `A feature adds NEW functionality. The codebase can do something it COULD NOT do before.

Signs a hunk is part of a feature:
- New functions, methods, classes, or exports
- New parameters, routes, or UI elements
- New imports required to support new capabilities
- Test code covering new behavior

Signs a hunk is NOT part of a feature:
- Fixing broken behavior (that's a bug fix)
- Reorganizing existing code without adding capabilities (that's a refactor)`;

    case "refactor":
      return `A refactor restructures WORKING code without changing observable behavior. Same outputs, different structure.

Signs a hunk is part of a refactor:
- Renaming variables or functions for clarity
- Extracting duplicated code into shared helpers
- Converting callbacks to async/await (same behavior)
- Removing dead or unused code
- Changing file organization or imports without new behavior

Signs a hunk is NOT part of a refactor:
- Fixing something that was broken (that's a bug fix)
- Adding new functionality (that's a feature)`;
  }
}

function buildPrompt(
  classification: HunkClassification,
  context: ProjectContext
): string {
  const guidance = classificationGuidance(classification);

  const relatedFilesSection =
    context.relatedFiles && context.relatedFiles.length > 0
      ? `Related files being changed: ${context.relatedFiles.join(", ")}`
      : "";

  const commitGoalSection = context.commitGoal
    ? `Goal of the current work: ${context.commitGoal}`
    : "";

  return `You are a code classification expert. You will be given a single hunk from a \`git add -p\` interactive staging session. Your job is to decide whether this hunk is RELEVANT to a "${classification}" commit.

PROJECT CONTEXT:
- Project: ${context.projectDescription}
- File: ${context.filePath}
${commitGoalSection}
${relatedFilesSection}

CLASSIFICATION DEFINITION:
${guidance}

SPECIAL CASE — EMPTY INPUT:
- If the hunk is empty or contains no meaningful code changes, return {"reasoning": "Empty hunk", "relevant": false, "confidence": 1.0}

DECISION PROCESS (Chain of Thought):
1. Read the hunk's + and − lines to understand what changed.
2. Consider the project context and the file the hunk belongs to.
3. Determine whether the changes in this hunk contribute to a "${classification}".
4. Write a brief reasoning summarizing your analysis.
5. Set "relevant" to TRUE if the hunk is part of the ${classification}, FALSE otherwise.
6. Set "confidence" based on how clearly the hunk matches or does not match.

Respond ONLY with a JSON object (no markdown, no explanation outside the JSON):
{
  "reasoning": "<your step-by-step analysis>",
  "relevant": true/false,
  "confidence": <score between 0 and 1>
}

Hunk to analyze:
`;
}

/**
 * Determine whether a single `git add -p` hunk belongs to the given
 * classification (bug fix, refactor, or feature) considering project context.
 *
 * @param hunk        - Raw hunk text from `git add -p` (including @@ header)
 * @param classification - The category to test against
 * @param context     - Project-level context to improve accuracy
 * @param host        - Ollama server URL (defaults to localhost)
 * @returns           - Analysis result with reasoning, relevance boolean, and confidence
 */
export async function classifyHunk(
  hunk: string,
  classification: HunkClassification,
  context: ProjectContext,
  host: string = "http://localhost:11434"
): Promise<HunkRelevanceResult> {
  const ollama = new Ollama({ host });
  const cleanedHunk = preprocessHunk(hunk);
  const prompt = buildPrompt(classification, context);

  const response = await ollama.generate({
    model: "llama3.2",
    system:
      "You are a specialized code classifier. You output high-precision JSON analysis of git hunks.",
    prompt: prompt + "\n" + cleanedHunk,
    format: "json",
    stream: false,
    options: {
      temperature: 0,
      num_predict: 500,
    },
  });

  try {
    const parsed = JSON.parse(response.response);
    return HunkRelevanceSchema.parse(parsed);
  } catch (error) {
    console.error("Failed to parse LLM response:", response.response);
    return {
      reasoning: "Failed to parse LLM output.",
      relevant: false,
      confidence: 0,
    };
  }
}
