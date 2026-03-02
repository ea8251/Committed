import * as vscode from "vscode";

export class CommittedViewProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;
    private hasGenerated = false;

    constructor(private readonly extensionUri: vscode.Uri) { }

    resolveWebviewView(view: vscode.WebviewView) {
        this.view = view;

        view.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };

        view.webview.onDidReceiveMessage((msg) => {
            if (msg?.type === "generate") {
                this.generate();
            }
        });

        this.render();
    }

    generate() {
        this.hasGenerated = true;
        this.render();
    }

    private render() {
        if (!this.view) { return; }

        const buttonLabel = this.hasGenerated ? "Regenerate" : "Generate";

        const hunkText =
            "lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.";
        const messageText =
            "ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.";

        const dataHtml = this.hasGenerated
            ? `
				<div class="card">
					<div class="row">
						<div class="k">Hunk:</div>
						<div class="v">${escapeHtml(hunkText)}</div>
					</div>
					<div class="row">
						<div class="k">AI message:</div>
						<div class="v">${escapeHtml(messageText)}</div>
					</div>
				</div>
			`
            : "";

        this.view.webview.html = `<!doctype html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>Committed</title>
	<style>
		:root {
			--pad: 14px;
			--radius: 12px;
		}
		body {
			padding: var(--pad);
			font-family: var(--vscode-font-family);
			color: var(--vscode-foreground);
			background: var(--vscode-sideBar-background);
		}
		.h1 {
			font-weight: 800;
			font-size: 18px;
			margin: 0 0 12px 0;
		}
		.btn {
			width: 100%;
			border: 0;
			border-radius: 10px;
			padding: 12px 14px;
			cursor: pointer;
			font-weight: 800;
			font-size: 14px;
			color: var(--vscode-button-foreground);
			background: var(--vscode-button-background);
		}
		.btn:hover {
			background: var(--vscode-button-hoverBackground);
		}
		.stack {
			display: grid;
			gap: 12px;
		}
		.card {
			border-radius: var(--radius);
			padding: 12px;
			border: 1px solid var(--vscode-sideBar-border, rgba(255,255,255,0.08));
			background: var(--vscode-editorWidget-background);
		}
		.row {
			display: grid;
			grid-template-columns: 82px 1fr;
			gap: 10px;
			align-items: start;
			margin: 8px 0;
		}
		.k {
			font-weight: 800;
			opacity: 0.9;
		}
		.v {
			opacity: 0.95;
			line-height: 1.35;
			word-break: break-word;
		}
	</style>
</head>
<body>
	<div class="stack">
		<div class="h1">Committed</div>
		<button class="btn" id="gen">${buttonLabel}</button>
		${dataHtml}
	</div>

	<script>
		const vscode = acquireVsCodeApi();
		document.getElementById("gen").addEventListener("click", () => {
			vscode.postMessage({ type: "generate" });
		});
	</script>
</body>
</html>`;
    }
}

function escapeHtml(input: string) {
    return input
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
