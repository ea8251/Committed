import * as vscode from "vscode";
import crypto from "crypto";

import { classifyAsBugFix, classifyAsFeature, classifyAsRefactoring, preprocessDiff } from "../models/classifyDiff";

export const PROBABILITY_THRESHOLD = 0.75;

export type FinalClassification = {
    label: "Bug Fix" | "Feature" | "Refactor";
    probability: number;
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
    private paused = false;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly publish: (result: FinalClassification) => void,
        private readonly log: (message: string) => void = () => { },
    ) { }

    start() {
        this.log("Scheduler started. Triggers: manual save, 30-min interval.");

        // Every 30 minutes
        this.intervalTimer = setInterval(() => {
            this.log("30-min interval trigger");
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
        if (this.intervalTimer) {
            clearInterval(this.intervalTimer);
        }
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
    }

    pause() {
        this.paused = true;
    }

    resume() {
        this.paused = false;
        this.lastFingerprint = undefined;
    }

    private scheduleDebounced(ms: number) {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.trigger().catch(() => { });
        }, ms);
    }

    /** Manually trigger classification (e.g. from the Generate button) */
    public manualTrigger(): void {
        this.log("Manual trigger requested");
        this.trigger().catch((err) => {
            this.log(`Manual trigger error: ${err}`);
        });
    }

    private async getWorkingDiffText(): Promise<string> {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
            this.log("No workspace folder found — cannot get diff");
            return "";
        }

        const { execFile } = await import("child_process");

        const execFileAsync = (file: string, args: string[], cwd: string) =>
            new Promise<string>((resolve) => {
                execFile(file, args, { cwd }, (err, stdout) => {
                    if (err) {
                        return resolve("");
                    }
                    resolve(String(stdout ?? ""));
                });
            });

        // If you already use simple-git elsewhere, swap this implementation to reuse it.
        return execFileAsync("git", ["diff"], folder.uri.fsPath);
    }

    private async trigger() {
        if (this.paused) {
            return;
        }
        if (this.running) {
            this.pending = true;
            return;
        }

        this.running = (async () => {
            try {
                this.log("Getting working-tree diff...");
                const rawDiff = await this.getWorkingDiffText();
                const cleaned = preprocessDiff(rawDiff);
                if (!cleaned.trim()) {
                    this.log("No diff found (working tree is clean)");
                    return;
                }

                this.log(`Diff found (${cleaned.length} chars)`);

                const fp = sha256(cleaned);
                if (fp === this.lastFingerprint) {
                    this.log("Diff unchanged since last classification — skipping");
                    return;
                }
                this.lastFingerprint = fp;

                this.log("Running 3 classifiers (bug / feature / refactor)...");
                // Run your existing classifiers
                const [bug, feat, ref] = await Promise.all([
                    classifyAsBugFix(cleaned),
                    classifyAsFeature(cleaned),
                    classifyAsRefactoring(cleaned),
                ]);
                this.log(`Bug: prob=${bug.probability.toFixed(2)}`);
                this.log(`Feature: prob=${feat.probability.toFixed(2)}`);
                this.log(`Refactor: prob=${ref.probability.toFixed(2)}`);

                // Pick the best candidate by probability, only if it meets the threshold
                const candidates = [
                    { label: "Bug Fix" as const, ...bug },
                    { label: "Feature" as const, ...feat },
                    { label: "Refactor" as const, ...ref },
                ];

                const aboveThreshold = candidates.filter((c) => c.probability >= PROBABILITY_THRESHOLD);

                if (aboveThreshold.length === 0) {
                    this.log(`⏭️ No classifier met probability threshold ${PROBABILITY_THRESHOLD} — staying silent`);
                    return;
                }

                const best = aboveThreshold.sort((a, b) => b.probability - a.probability)[0];

                const finalResult: FinalClassification = {
                    label: best.label,
                    probability: best.probability,
                    reasoning: best.reasoning,
                };

                this.log(`✅ Final: ${finalResult.label} (${finalResult.probability.toFixed(2)})`);
                this.publish(finalResult);
                await this.context.globalState.update("committed.lastClassification", finalResult);
            } catch (error) {
                this.log(`❌ Classification error: ${error}`);
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