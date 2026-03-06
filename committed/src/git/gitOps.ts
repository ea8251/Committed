import { execFile } from "child_process";
import * as vscode from "vscode";

/**
 * A single hunk parsed from a unified diff, with enough context
 * to reconstruct a standalone patch for `git apply --cached`.
 */
export interface ParsedHunk {
    /** The file this hunk belongs to (b-side path) */
    filePath: string;
    /** Everything before the first @@ line for this file (diff --git, index, ---, +++) */
    fileHeader: string;
    /** The @@ header line of this hunk */
    hunkHeader: string;
    /** Full hunk text (header + change/context lines) */
    content: string;
    /** Ordinal index of this hunk within the file */
    index: number;
}

// ---------------------------------------------------------------------------
// Diff parsing
// ---------------------------------------------------------------------------

/**
 * Split a unified diff string (from `git diff`) into individual
 * {@link ParsedHunk} objects so each can be staged independently.
 */
export function parseHunks(diff: string): ParsedHunk[] {
    if (!diff || !diff.trim()) { return []; }

    const hunks: ParsedHunk[] = [];

    // Split into per-file sections (each starts with "diff --git")
    const fileSections = diff.split(/^(?=diff --git )/m);

    for (const section of fileSections) {
        if (!section.trim()) { continue; }

        const diffGitMatch = section.match(/^diff --git a\/(.+?) b\/(.+)/m);
        if (!diffGitMatch) { continue; }
        const filePath = diffGitMatch[2];

        // Everything before the first @@ line is the file header
        const firstHunkIdx = section.search(/^@@/m);
        if (firstHunkIdx === -1) { continue; } // binary or mode-only change
        const fileHeader = section.substring(0, firstHunkIdx).trimEnd();

        // Split the remainder into individual hunks at @@ boundaries
        const hunkArea = section.substring(firstHunkIdx);
        const hunkParts = hunkArea.split(/^(?=@@)/m);

        let hunkOrdinal = 0;
        for (const part of hunkParts) {
            if (!part.trim()) { continue; }
            const headerMatch = part.match(/^@@[^@]+@@.*/);
            hunks.push({
                filePath,
                fileHeader,
                hunkHeader: headerMatch ? headerMatch[0] : "",
                content: part.trimEnd(),
                index: hunkOrdinal++,
            });
        }
    }

    return hunks;
}

// ---------------------------------------------------------------------------
// Low-level git helpers
// ---------------------------------------------------------------------------

function getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function execGit(args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(
            "git", args,
            { cwd, maxBuffer: 10 * 1024 * 1024 },
            (err, stdout, stderr) => {
                if (err) { reject(new Error(stderr || err.message)); }
                else { resolve(stdout); }
            },
        );
    });
}

/**
 * Pipe a patch string to `git apply --cached` via stdin.
 */
function applyPatchToIndex(patch: string, cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const proc = execFile(
            "git", ["apply", "--cached", "--whitespace=fix", "-"],
            { cwd },
            (err, _stdout, stderr) => {
                if (err) { reject(new Error(`git apply --cached failed: ${stderr || err.message}`)); }
                else { resolve(); }
            },
        );
        proc.stdin!.write(patch);
        proc.stdin!.end();
    });
}

/**
 * Fallback: stage an entire file via `git add`.
 */
function stageFile(filePath: string, cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
        execFile(
            "git", ["add", "--", filePath],
            { cwd },
            (err, _stdout, stderr) => {
                if (err) { reject(new Error(`git add failed: ${stderr || err.message}`)); }
                else { resolve(); }
            },
        );
    });
}

// ---------------------------------------------------------------------------
// Public operations
// ---------------------------------------------------------------------------

/**
 * Stage a set of parsed hunks by constructing per-file patches and
 * applying them to the index.  This is the programmatic equivalent
 * of selectively pressing "y" during `git add -p`.
 *
 * Falls back to `git add` per file if `git apply --cached` fails
 * (e.g. encoding mismatches, CRLF issues, new files).
 */
export async function stageHunks(hunks: ParsedHunk[]): Promise<void> {
    const cwd = getWorkspaceRoot();
    if (!cwd) { throw new Error("No workspace folder open"); }

    // Group hunks by file so we build one patch per file (preserves offsets)
    const byFile = new Map<string, ParsedHunk[]>();
    for (const h of hunks) {
        if (!byFile.has(h.filePath)) { byFile.set(h.filePath, []); }
        byFile.get(h.filePath)!.push(h);
    }

    for (const [filePath, fileHunks] of byFile) {
        const header = fileHunks[0].fileHeader;
        const body = fileHunks.map((h) => h.content).join("\n");
        const patch = header + "\n" + body + "\n";
        try {
            await applyPatchToIndex(patch, cwd);
        } catch {
            // Patch couldn't apply (encoding mismatch, CRLF, new file, etc.)
            // Fall back to staging the entire file
            await stageFile(filePath, cwd);
        }
    }
}

/**
 * Reset the index (unstage everything) without touching the working tree.
 */
export async function unstageAll(): Promise<void> {
    const cwd = getWorkspaceRoot();
    if (!cwd) { return; }
    await execGit(["reset"], cwd);
}

/**
 * Create a commit with the given message.
 */
export async function commitChanges(message: string): Promise<void> {
    const cwd = getWorkspaceRoot();
    if (!cwd) { throw new Error("No workspace folder open"); }
    await execGit(["commit", "-m", message], cwd);
}

/**
 * Push to the current tracking branch.
 */
export async function pushChanges(): Promise<void> {
    const cwd = getWorkspaceRoot();
    if (!cwd) { throw new Error("No workspace folder open"); }
    await execGit(["push"], cwd);
}

/**
 * Return the working-tree diff (unstaged changes only).
 */
export async function getWorkingDiff(): Promise<string> {
    const cwd = getWorkspaceRoot();
    if (!cwd) { return ""; }
    try {
        return await execGit(["diff"], cwd);
    } catch {
        return "";
    }
}
