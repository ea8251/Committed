// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { CommittedViewProvider } from "./ui/CommittedViewProvider";
import { ClassificationScheduler } from "./models/scheduler";
import { getGitHubClient, getGitDiff } from "./github";
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// // Use the console to output diagnostic information (console.log) and errors (console.error)
	// // This line of code will only be executed once when your extension is activated
	// console.log('Congratulations, your extension "committed" is now active!');

	// // The command has been defined in the package.json file
	// // Now provide the implementation of the command with registerCommand
	// // The commandId parameter must match the command field in package.json
	// const disposable = vscode.commands.registerCommand('committed.helloWorld', () => {
	// 	// The code you place here will be executed every time your command is executed
	// 	// Display a message box to the user
	// 	vscode.window.showInformationMessage('Hello!');
	// });

	// context.subscriptions.push(disposable);

	const viewProvider = new CommittedViewProvider(context.extensionUri);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider("committed.suggestions", viewProvider)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("committed.generateSuggestions", () => {
			viewProvider.generate();
		})
	);

	const scheduler = new ClassificationScheduler(context, (result) => {
		viewProvider.publishClassification(result);
	});
	scheduler.start();
	context.subscriptions.push({ dispose: () => scheduler.dispose() });

	// Test command for GitHub and Git diff
	context.subscriptions.push(
		vscode.commands.registerCommand("committed.testGitHub", async () => {
			try {
				// Test GitHub client
				const octokit = await getGitHubClient();
				if (octokit) {
					const { data: user } = await octokit.users.getAuthenticated();
					vscode.window.showInformationMessage(`GitHub connected: ${user.login}`);
				} else {
					vscode.window.showWarningMessage('Could not connect to GitHub');
				}

				// Test git diff
				const diff = await getGitDiff();
				if (diff) {
					console.log('Git diff:', diff);
					vscode.window.showInformationMessage(`Git diff: ${diff.length} characters`);
				} else {
					vscode.window.showInformationMessage('No git changes detected');
				}
			} catch (error) {
				vscode.window.showErrorMessage(`Error: ${error}`);
			}
		})
	);

}

// This method is called when your extension is deactivated
export function deactivate() { }
