import * as vscode from "vscode";
import crypto from "crypto";

import { classifyAsBugFix, classifyAsFeature, classifyAsRefactoring, preprocessDiff } from "../models/classifyDiff";

export type FinalClassification = {
    label: "Bug Fix" | "Feature" | "Refactor" | "Unclear";
    confidence: number;
    // Keep it if you want to show it, or omit it from UI if you don’t.
    reasoning?: string;
};

function sha256(s: string) {
    return crypto.createHash("sha256").update(s).digest("hex");
}

export class ClassificationScheduler {
    private intervalTimer: NodeJS.Timeout | undefined;
    private debounceTimer: NodeJS.Timeout | undefined;

    private running: Promise<void> | undefined;
    private pending = false;

    private lastFingerprint: string | undefined;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly publish: (result: FinalClassification) => void
    ) { }

    start() {
        // Every 30 minutes
        this.intervalTimer = setInterval(() => {
            this.trigger().catch(() => { });
        }, 30 * 60 * 1000);

        // Run on save (autosave-safe)
        this.context.subscriptions.push(
            vscode.workspace.onWillSaveTextDocument((e) => {
                if (e.reason === vscode.TextDocumentSaveReason.Manual) {
                    this.trigger().catch(() => { });
                } else {
                    // autosave/focus-out/etc => debounce to avoid spam
                    this.scheduleDebounced(60_000);
                }
            })
        );

        this.context.subscriptions.push({ dispose: () => this.dispose() });
    }

    dispose() {
        if (this.intervalTimer) clearInterval(this.intervalTimer);
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
    }

    private scheduleDebounced(ms: number) {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.trigger().catch(() => { });
        }, ms);
    }

    private async getWorkingDiffText(): Promise<string> {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) return "";

        const { execFile } = await import("child_process");

        const execFileAsync = (file: string, args: string[], cwd: string) =>
            new Promise<string>((resolve) => {
                execFile(file, args, { cwd }, (err, stdout) => {
                    if (err) return resolve("");
                    resolve(String(stdout ?? ""));
                });
            });

        // If you already use simple-git elsewhere, swap this implementation to reuse it.
        return execFileAsync("git", ["diff"], folder.uri.fsPath);
    }

    private async trigger() {
        if (this.running) {
            this.pending = true;
            return;
        }

        this.running = (async () => {
            try {
                const rawDiff = await this.getWorkingDiffText();
                const cleaned = preprocessDiff(rawDiff);
                if (!cleaned.trim()) return;

                const fp = sha256(cleaned);
                if (fp === this.lastFingerprint) return;
                this.lastFingerprint = fp;

                // Run your existing classifiers
                const [bug, feat, ref] = await Promise.all([
                    classifyAsBugFix(cleaned),
                    classifyAsFeature(cleaned),
                    classifyAsRefactoring(cleaned),
                ]);

                // Pick the best “true” result by confidence
                const candidates = [
                    { label: "Bug Fix" as const, ...bug },
                    { label: "Feature" as const, ...feat },
                    { label: "Refactor" as const, ...ref },
                ];

                const trueOnes = candidates.filter((c) => c.result === true);
                const best = (trueOnes.length ? trueOnes : candidates).sort((a, b) => b.confidence - a.confidence)[0];

                const finalResult: FinalClassification =
                    trueOnes.length === 0
                        ? { label: "Unclear", confidence: best.confidence, reasoning: best.reasoning }
                        : { label: best.label, confidence: best.confidence, reasoning: best.reasoning };

                this.publish(finalResult);
                await this.context.globalState.update("committed.lastClassification", finalResult);
            } finally {
                this.running = undefined;
                if (this.pending) {
                    this.pending = false;
                    await this.trigger();
                }
            }
        })();

        await this.running;
    }
}