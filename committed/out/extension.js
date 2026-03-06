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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const CommittedViewProvider_1 = require("./ui/CommittedViewProvider");
const scheduler_1 = require("./models/scheduler");
const github_1 = require("./github");
const gitOps_1 = require("./git/gitOps");
const classifyHunk_1 = require("./models/classifyHunk");
const generateCommitMessage_1 = require("./models/generateCommitMessage");
const ollamaManager_1 = require("./ollamaManager");
// -----------------------------------------------------------------------
// Activation
// -----------------------------------------------------------------------
let ollamaManager;
function activate(context) {
    // Initialize and start Ollama
    ollamaManager = new ollamaManager_1.OllamaManager();
    const viewProvider = new CommittedViewProvider_1.CommittedViewProvider(context.extensionUri);
    // Push Ollama status into the debug log
    viewProvider.pushLog("Extension activated");
    viewProvider.pushLog(`Workspace: ${vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "(none)"}`);
    viewProvider.pushLog(`Ollama manager initialized`);
    // Ensure Ollama is running, then ensure the model is pulled
    (async () => {
        try {
            await ollamaManager.ensureOllamaRunning();
            viewProvider.pushLog("Ollama running — checking for model...");
            const modelReady = await ollamaManager.ensureModel("llama3.2", (msg) => viewProvider.pushLog(msg));
            if (modelReady) {
                viewProvider.pushLog("Model llama3.2 is ready");
            }
            else {
                viewProvider.pushLog("Model llama3.2 could not be pulled — classification may fail");
            }
        }
        catch (err) {
            viewProvider.pushLog(`Ollama startup error: ${err}`);
        }
    })();
    // Monitor Ollama health periodically
    ollamaManager.monitorOllama();
    // Register command to install Ollama
    context.subscriptions.push(vscode.commands.registerCommand("committed.installOllama", async () => {
        await ollamaManager?.promptForOllamaInstall();
    }));
    context.subscriptions.push(vscode.window.registerWebviewViewProvider("committed.suggestions", viewProvider));
    // Scheduler: periodically classifies the working-tree diff
    const scheduler = new scheduler_1.ClassificationScheduler(context, (result) => { viewProvider.publishClassification(result); }, (msg) => { viewProvider.pushLog(msg); });
    scheduler.start();
    context.subscriptions.push({ dispose: () => scheduler.dispose() });
    // ------------------------------------------------------------------
    // Accept → hunk classification → selective staging → commit → push
    // ------------------------------------------------------------------
    context.subscriptions.push(viewProvider.onAccept(async (classification) => {
        await handleAcceptClassification(classification, viewProvider, scheduler);
    }));
    // Reject → clear UI; scheduler will re-evaluate on next save / interval
    context.subscriptions.push(viewProvider.onReject(() => {
        viewProvider.reset();
    }));
    // ------------------------------------------------------------------
    // Dev / debug command (kept for convenience)
    // ------------------------------------------------------------------
    context.subscriptions.push(vscode.commands.registerCommand("committed.testGitHub", async () => {
        try {
            const octokit = await (0, github_1.getGitHubClient)();
            if (octokit) {
                const { data: user } = await octokit.users.getAuthenticated();
                vscode.window.showInformationMessage(`GitHub connected: ${user.login}`);
            }
            else {
                vscode.window.showWarningMessage("Could not connect to GitHub");
            }
            const diff = await (0, github_1.getGitDiff)();
            if (diff) {
                vscode.window.showInformationMessage(`Git diff: ${diff.length} characters`);
            }
            else {
                vscode.window.showInformationMessage("No git changes detected");
            }
        }
        catch (error) {
            vscode.window.showErrorMessage(`Error: ${error}`);
        }
    }));
}
function deactivate() {
    if (ollamaManager) {
        ollamaManager.dispose();
    }
}
// -----------------------------------------------------------------------
// Orchestration: accept a classification and drive it through to a commit
// -----------------------------------------------------------------------
function mapLabel(label) {
    switch (label) {
        case "Bug Fix": return "bug fix";
        case "Feature": return "feature";
        case "Refactor": return "refactor";
    }
}
async function handleAcceptClassification(classification, viewProvider, scheduler) {
    scheduler.pause();
    try {
        // Phase 1 — automated: classify hunks, stage, generate message
        const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Committed", cancellable: true }, async (progress, token) => {
            // 1. Fetch current working-tree diff
            progress.report({ message: "Reading diff…" });
            const diff = await (0, gitOps_1.getWorkingDiff)();
            if (!diff.trim()) {
                vscode.window.showWarningMessage("Committed: No uncommitted changes detected.");
                return undefined;
            }
            if (token.isCancellationRequested) {
                return undefined;
            }
            // 2. Parse into individual hunks
            progress.report({ message: "Parsing hunks…" });
            const hunks = (0, gitOps_1.parseHunks)(diff);
            if (hunks.length === 0) {
                vscode.window.showWarningMessage("Committed: Could not parse any hunks from the diff.");
                return undefined;
            }
            if (token.isCancellationRequested) {
                return undefined;
            }
            // 3. Classify each hunk for relevance to the detected category
            const hunkCategory = mapLabel(classification.label);
            const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name ?? "project";
            progress.report({ message: `Classifying ${hunks.length} hunk(s)…` });
            const relevanceResults = await Promise.all(hunks.map((h) => (0, classifyHunk_1.classifyHunk)(h.content, hunkCategory, {
                projectDescription: workspaceName,
                filePath: h.filePath,
                commitGoal: classification.label,
            })));
            if (token.isCancellationRequested) {
                return undefined;
            }
            // 4. Keep only relevant hunks
            const relevant = hunks.filter((_, i) => relevanceResults[i].relevant);
            if (relevant.length === 0) {
                vscode.window.showWarningMessage("Committed: No hunks matched the classification. Nothing to stage.");
                return undefined;
            }
            // 5. Stage relevant hunks
            progress.report({ message: `Staging ${relevant.length}/${hunks.length} hunk(s)…` });
            await (0, gitOps_1.stageHunks)(relevant);
            // 6. Generate a commit message
            progress.report({ message: "Generating commit message…" });
            const stagedDiff = relevant.map((h) => h.fileHeader + "\n" + h.content).join("\n\n");
            const commitMsg = await (0, generateCommitMessage_1.generateCommitMessage)(classification.label, stagedDiff);
            return { commitMsg, relevantCount: relevant.length, totalCount: hunks.length };
        });
        if (!result) {
            // Progress was cancelled or an early-exit warning was shown
            scheduler.resume();
            return;
        }
        // Phase 2 — user confirmation
        const fullMessage = result.commitMsg.body
            ? `${result.commitMsg.subject}\n\n${result.commitMsg.body}`
            : result.commitMsg.subject;
        const action = await vscode.window.showInformationMessage(`Staged ${result.relevantCount}/${result.totalCount} hunk(s) as "${classification.label}".\n\n` +
            `Commit message:\n${result.commitMsg.subject}`, { modal: true }, "Commit & Push");
        if (action === "Commit & Push") {
            await (0, gitOps_1.commitChanges)(fullMessage);
            await (0, gitOps_1.pushChanges)();
            viewProvider.reset();
            vscode.window.showInformationMessage(`Committed: Successfully pushed ${classification.label} commit.`);
        }
        else {
            // User dismissed / cancelled — unstage and let them start over
            await (0, gitOps_1.unstageAll)();
            vscode.window.showInformationMessage("Committed: Commit cancelled. Changes unstaged.");
        }
    }
    catch (error) {
        await (0, gitOps_1.unstageAll)().catch(() => { });
        vscode.window.showErrorMessage(`Committed: ${error}`);
    }
    finally {
        scheduler.resume();
    }
}
//# sourceMappingURL=extension.js.map