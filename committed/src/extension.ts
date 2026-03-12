import * as vscode from "vscode";
import { CommittedViewProvider } from "./ui/CommittedViewProvider";
import { ClassificationScheduler, FinalClassification } from "./models/scheduler";
import { getGitHubClient, getGitDiff } from "./github";
import { parseHunks, stageHunks, unstageAll, commitChanges, pushChanges, getWorkingDiff } from "./git/gitOps";
import { classifyHunk, HunkClassification } from "./models/classifyHunk";
import { generateCommitMessage } from "./models/generateCommitMessage";
import { OllamaManager } from "./ollamaManager";

// -----------------------------------------------------------------------
// Activation
// -----------------------------------------------------------------------

let ollamaManager: OllamaManager | undefined;

async function notifyNewClassification(result: FinalClassification): Promise<void> {
	const action = await vscode.window.showInformationMessage(
		`Committed classified your current changes as ${result.label} (${result.probability.toFixed(2)}).`,
		"Open Committed",
	);

	if (action === "Open Committed") {
		await vscode.commands.executeCommand("committed.suggestions.focus");
	}
}

export function activate(context: vscode.ExtensionContext) {

	// Initialize and start Ollama
	ollamaManager = new OllamaManager();

	const viewProvider = new CommittedViewProvider(context.extensionUri);

	// Push Ollama status into the debug log
	viewProvider.pushLog("Extension activated");
	viewProvider.pushLog(`Workspace: ${vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "(none)"}`);
	viewProvider.pushLog(`Ollama manager initialized`);

	// Ensure Ollama is running, then ensure the model is pulled
	(async () => {
		try {
			await ollamaManager!.ensureOllamaRunning();
			viewProvider.pushLog("Ollama running — checking for model...");
			const modelReady = await ollamaManager!.ensureModel("llama3.2", (msg) => viewProvider.pushLog(msg));
			if (modelReady) {
				viewProvider.pushLog("Model llama3.2 is ready");
			} else {
				viewProvider.pushLog("Model llama3.2 could not be pulled — classification may fail");
			}
		} catch (err) {
			viewProvider.pushLog(`Ollama startup error: ${err}`);
		}
	})();

	// Monitor Ollama health periodically
	ollamaManager.monitorOllama();

	// Register command to install Ollama
	context.subscriptions.push(
		vscode.commands.registerCommand("committed.installOllama", async () => {
			await ollamaManager?.promptForOllamaInstall();
		})
	);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider("committed.suggestions", viewProvider)
	);

	// Scheduler: periodically classifies the working-tree diff
	const scheduler = new ClassificationScheduler(
		context,
		(result) => {
			viewProvider.publishClassification(result);
			void notifyNewClassification(result);
		},
		(msg) => { viewProvider.pushLog(msg); },
	);
	scheduler.start();

	context.subscriptions.push({ dispose: () => scheduler.dispose() });

	// ------------------------------------------------------------------
	// Accept → hunk classification → selective staging → commit → push
	// ------------------------------------------------------------------
	context.subscriptions.push(
		viewProvider.onAccept(async (classification) => {
			await handleAcceptClassification(classification, viewProvider, scheduler);
		})
	);

	// Reject → clear UI; scheduler will re-evaluate on next save / interval
	context.subscriptions.push(
		viewProvider.onReject(() => {
			viewProvider.reset();
		})
	);

	// ------------------------------------------------------------------
	// Dev / debug command (kept for convenience)
	// ------------------------------------------------------------------
	context.subscriptions.push(
		vscode.commands.registerCommand("committed.testGitHub", async () => {
			try {
				const octokit = await getGitHubClient();
				if (octokit) {
					const { data: user } = await octokit.users.getAuthenticated();
					vscode.window.showInformationMessage(`GitHub connected: ${user.login}`);
				} else {
					vscode.window.showWarningMessage("Could not connect to GitHub");
				}
				const diff = await getGitDiff();
				if (diff) {
					vscode.window.showInformationMessage(`Git diff: ${diff.length} characters`);
				} else {
					vscode.window.showInformationMessage("No git changes detected");
				}
			} catch (error) {
				vscode.window.showErrorMessage(`Error: ${error}`);
			}
		})
	);
}

export function deactivate() {
	if (ollamaManager) {
		ollamaManager.dispose();
	}
}

// -----------------------------------------------------------------------
// Orchestration: accept a classification and drive it through to a commit
// -----------------------------------------------------------------------

function mapLabel(label: FinalClassification["label"]): HunkClassification {
	switch (label) {
		case "Bug Fix": return "bug fix";
		case "Feature": return "feature";
		case "Refactor": return "refactor";
	}
}

async function handleAcceptClassification(
	classification: FinalClassification,
	viewProvider: CommittedViewProvider,
	scheduler: ClassificationScheduler,
): Promise<void> {
	scheduler.pause();

	try {
		// Phase 1 — automated: classify hunks, stage, generate message
		const result = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: "Committed", cancellable: true },
			async (progress, token) => {
				// 1. Fetch current working-tree diff
				progress.report({ message: "Reading diff…" });
				const diff = await getWorkingDiff();
				if (!diff.trim()) {
					vscode.window.showWarningMessage("Committed: No uncommitted changes detected.");
					return undefined;
				}
				if (token.isCancellationRequested) { return undefined; }

				// 2. Parse into individual hunks
				progress.report({ message: "Parsing hunks…" });
				const hunks = parseHunks(diff);
				if (hunks.length === 0) {
					vscode.window.showWarningMessage("Committed: Could not parse any hunks from the diff.");
					return undefined;
				}
				if (token.isCancellationRequested) { return undefined; }

				// 3. Classify each hunk for relevance to the detected category
				const hunkCategory = mapLabel(classification.label as "Bug Fix" | "Feature" | "Refactor");
				const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name ?? "project";
				progress.report({ message: `Classifying ${hunks.length} hunk(s)…` });

				const relevanceResults = await Promise.all(
					hunks.map((h) =>
						classifyHunk(h.content, hunkCategory, {
							projectDescription: workspaceName,
							filePath: h.filePath,
							commitGoal: classification.label,
						})
					),
				);
				if (token.isCancellationRequested) { return undefined; }

				// 4. Keep only relevant hunks
				const relevant = hunks.filter((_, i) => relevanceResults[i].relevant);
				if (relevant.length === 0) {
					vscode.window.showWarningMessage(
						"Committed: No hunks matched the classification. Nothing to stage.",
					);
					return undefined;
				}

				// 5. Stage relevant hunks
				progress.report({ message: `Staging ${relevant.length}/${hunks.length} hunk(s)…` });
				await stageHunks(relevant);

				// 6. Generate a commit message
				progress.report({ message: "Generating commit message…" });
				const stagedDiff = relevant.map((h) => h.fileHeader + "\n" + h.content).join("\n\n");
				const commitMsg = await generateCommitMessage(classification.label, stagedDiff);

				return { commitMsg, relevantCount: relevant.length, totalCount: hunks.length };
			},
		);

		if (!result) {
			// Progress was cancelled or an early-exit warning was shown
			scheduler.resume();
			return;
		}

		// Phase 2 — user confirmation
		const fullMessage = result.commitMsg.body
			? `${result.commitMsg.subject}\n\n${result.commitMsg.body}`
			: result.commitMsg.subject;

		const action = await vscode.window.showInformationMessage(
			`Staged ${result.relevantCount}/${result.totalCount} hunk(s) as "${classification.label}".\n\n` +
			`Commit message:\n${result.commitMsg.subject}`,
			{ modal: true },
			"Commit & Push",
		);

		if (action === "Commit & Push") {
			await commitChanges(fullMessage);
			await pushChanges();
			viewProvider.reset();
			vscode.window.showInformationMessage(
				`Committed: Successfully pushed ${classification.label} commit.`,
			);
		} else {
			// User dismissed / cancelled — unstage and let them start over
			await unstageAll();
			vscode.window.showInformationMessage("Committed: Commit cancelled. Changes unstaged.");
		}
	} catch (error) {
		await unstageAll().catch(() => { /* best-effort */ });
		vscode.window.showErrorMessage(`Committed: ${error}`);
	} finally {
		scheduler.resume();
	}
}
