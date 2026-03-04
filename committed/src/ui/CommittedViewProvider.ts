import * as vscode from "vscode";

type FinalClassification = {
    label: "Bug Fix" | "Feature" | "Refactor" | "Unclear";
    confidence: number;
    reasoning?: string;
};

export class CommittedViewProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;
    private hasGenerated = false;

    private lastClassification?: FinalClassification;

    constructor(private readonly extensionUri: vscode.Uri) { }

    resolveWebviewView(view: vscode.WebviewView) {
        this.view = view;

        view.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };

        view.webview.onDidReceiveMessage((msg) => {
            if (msg?.type === "generate") {
                // Ask extension host to run classification now (host should handle actual work)
                this.hasGenerated = true;
                this.render();
                this.view?.webview.postMessage({ type: "requestGenerate" });
                return;
            }

            // Pass-through events for extension host to handle (persisting acceptance, etc.)
            if (msg?.type === "accept") {
                this.view?.webview.postMessage({ type: "accepted", payload: this.lastClassification });
                return;
            }

            if (msg?.type === "reject") {
                // Clear UI immediately; extension should mark re-run on next save
                const prev = this.lastClassification;
                this.hasGenerated = false;
                this.lastClassification = undefined;
                this.render();
                this.view?.webview.postMessage({ type: "rejected", payload: prev });
                return;
            }

            if (msg?.type === "toggleReasoning") {
                // purely UI state; no-op server side
                return;
            }
        });

        this.render();
    }

    generate() {
        this.hasGenerated = true;
        this.render();
    }

    /** Called by extension code when a new classification arrives */
    public publishClassification(result: FinalClassification) {
        this.lastClassification = result;
        this.hasGenerated = true;

        // If the webview is already loaded, push message (fast)
        this.view?.webview.postMessage({ type: "classification", payload: result });

        // Also re-render so HTML contains latest on initial load / refresh
        this.render();
    }

    private render() {
        if (!this.view) {
            return;
        }

        const webview = this.view.webview;
        const nonce = getNonce();

        const csp = [
            `default-src 'none'`,
            `img-src ${webview.cspSource} https: data:`,
            `style-src ${webview.cspSource} 'unsafe-inline'`,
            `script-src 'nonce-${nonce}'`,
        ].join("; ");

        const buttonLabel = this.hasGenerated ? "Regenerate" : "Generate";
        const classification = this.lastClassification;

        const classificationHtml = classification
            ? `
        <div class="card">
          <div class="row">
            <div class="k">Type:</div>
            <div class="v"><span class="pill" id="type">${escapeHtml(classification.label)}</span></div>
          </div>
          <div class="row">
            <div class="k">Confidence:</div>
            <div class="v" id="conf">${Number(classification.confidence).toFixed(2)}</div>
          </div>

          <div class="row">
            <div class="k">Reasoning:</div>
            <div class="v">
              <label class="toggle">
                <input type="checkbox" id="showReasoning" />
                Show
              </label>
            </div>
          </div>

          <div class="reasoning" id="reasoning" style="display:none;">${escapeHtml(
                classification.reasoning ?? "—"
            )}</div>

          <div class="actions">
            <button class="btn secondary" id="accept">Accept</button>
            <button class="btn danger" id="reject">Reject</button>
          </div>
        </div>
      `
            : `
        <div class="card">
          <div class="row">
            <div class="k">Type:</div>
            <div class="v" id="type">—</div>
          </div>
          <div class="row">
            <div class="k">Confidence:</div>
            <div class="v" id="conf">—</div>
          </div>
          <div class="actions">
            <button class="btn secondary" id="accept" disabled>Accept</button>
            <button class="btn danger" id="reject" disabled>Reject</button>
          </div>
        </div>
      `;

        const dataHtml = this.hasGenerated
            ? `
        <div class="card" id="dataCard">
          <div class="row">
            <div class="k">Hunk:</div>
            <div class="v" id="hunk">—</div>
          </div>
          <div class="row">
            <div class="k">AI message:</div>
            <div class="v" id="aiMessage">—</div>
          </div>
        </div>
      `
            : "";

        this.view.webview.html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Committed</title>
  <style>
    :root { --pad: 14px; --radius: 12px; }
    body {
      padding: var(--pad);
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
    }
    .h1 { font-weight: 800; font-size: 18px; margin: 0 0 12px 0; }
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
    .btn:hover { background: var(--vscode-button-hoverBackground); }
    .btn.secondary {
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
    }
    .btn.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
    }
    .btn.danger {
      color: var(--vscode-editor-background);
      background: var(--vscode-errorForeground);
    }
    .stack { display: grid; gap: 12px; }
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
    .k { font-weight: 800; opacity: 0.9; }
    .v { opacity: 0.95; line-height: 1.35; word-break: break-word; }

    .pill {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-weight: 800;
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-input-background);
    }

    .toggle { display: inline-flex; gap: 8px; align-items: center; }
    .reasoning {
      margin-top: 8px;
      padding: 10px;
      border-radius: 10px;
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-editor-background);
      white-space: pre-wrap;
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      opacity: 0.95;
    }

    .actions {
      margin-top: 12px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
  </style>
</head>
<body>
  <div class="stack">
    <div class="h1">Committed</div>

    ${classificationHtml}

    <button class="btn" id="gen">${escapeHtml(buttonLabel)}</button>

    ${dataHtml}
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    const genBtn = document.getElementById("gen");
    if (genBtn) {
      genBtn.addEventListener("click", () => {
        vscode.postMessage({ type: "generate" });
      });
    }

    const acceptBtn = document.getElementById("accept");
    if (acceptBtn) {
      acceptBtn.addEventListener("click", () => {
        vscode.postMessage({ type: "accept" });
      });
    }

    const rejectBtn = document.getElementById("reject");
    if (rejectBtn) {
      rejectBtn.addEventListener("click", () => {
        vscode.postMessage({ type: "reject" });
      });
    }

    // Reasoning toggle (only if it exists in DOM)
    const showReasoning = document.getElementById("showReasoning");
    const reasoning = document.getElementById("reasoning");
    if (showReasoning && reasoning) {
      showReasoning.addEventListener("change", () => {
        reasoning.style.display = showReasoning.checked ? "block" : "none";
        vscode.postMessage({ type: "toggleReasoning", payload: { show: showReasoning.checked } });
      });
    }

    function setClassification(c) {
      const typeEl = document.getElementById("type");
      const confEl = document.getElementById("conf");
      const reasoningEl = document.getElementById("reasoning");

      if (typeEl) typeEl.textContent = c?.label ?? "—";
      if (confEl) confEl.textContent = c ? Number(c.confidence).toFixed(2) : "—";
      if (reasoningEl) reasoningEl.textContent = c?.reasoning ?? "—";

      const a = document.getElementById("accept");
      const r = document.getElementById("reject");
      if (a) a.disabled = !c;
      if (r) r.disabled = !c;
    }

    // Live updates from extension
    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (!msg || typeof msg.type !== "string") {
        return;
      }

      if (msg.type === "classification") {
        setClassification(msg.payload);
        return;
      }

      // Optional: if your extension later posts these, you can show them.
      if (msg.type === "suggestion") {
        const hunkEl = document.getElementById("hunk");
        const aiEl = document.getElementById("aiMessage");
        if (hunkEl && msg.payload?.hunk) hunkEl.textContent = msg.payload.hunk;
        if (aiEl && msg.payload?.message) aiEl.textContent = msg.payload.message;
        return;
      }
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

function getNonce() {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}