import { Ollama } from "ollama";
import { z } from "zod";

const CommitMessageSchema = z.object({
    subject: z.string().describe("A concise one-line commit subject (max 72 chars)"),
    body: z.string().describe("Optional longer description of the changes"),
});

export type CommitMessage = z.infer<typeof CommitMessageSchema>;

const PROMPT = `You are a commit-message author. Given a classification and the staged diff, write a conventional commit message.

RULES:
- Subject line: type(scope): description — max 72 characters
  - type is one of: fix, feat, refactor
  - scope is optional but try to infer one from the file paths / context
- Body: briefly explain WHY the change was made, not WHAT (the diff shows what).
- If the diff is trivial, body can be an empty string "".

Respond ONLY with JSON (no markdown):
{
  "subject": "<subject line>",
  "body": "<body or empty string>"
}`;

/**
 * Use the local Ollama LLM to generate a conventional commit message
 * for the given classification and staged diff content.
 */
export async function generateCommitMessage(
    classification: string,
    diff: string,
    host: string = "http://localhost:11434",
): Promise<CommitMessage> {
    const ollama = new Ollama({ host });

    // Truncate diff to keep well within context window
    const truncated =
        diff.length > 4000
            ? diff.substring(0, 4000) + "\n... [truncated]"
            : diff;

    const response = await ollama.generate({
        model: "llama3.2",
        system: "You are a commit message generator. Output only JSON.",
        prompt: `${PROMPT}\n\nClassification: ${classification}\n\nDiff:\n${truncated}`,
        format: "json",
        stream: false,
        options: {
            temperature: 0.3,
            num_predict: 300,
        },
    });

    try {
        const parsed = JSON.parse(response.response);
        return CommitMessageSchema.parse(parsed);
    } catch {
        // Fallback if the LLM produces unparseable output
        const typeMap: Record<string, string> = {
            "Bug Fix": "fix",
            "Feature": "feat",
            "Refactor": "refactor",
        };
        return {
            subject: `${typeMap[classification] ?? classification.toLowerCase()}: update code`,
            body: "",
        };
    }
}
