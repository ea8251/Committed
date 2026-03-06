import { spawn, ChildProcess, execSync } from "child_process";
import * as vscode from "vscode";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

export class OllamaManager {
    private ollamaProcess: ChildProcess | undefined;
    private isStarting = false;
    private statusBar: vscode.StatusBarItem;
    private installPromptShown = false;
    private ollamaInstallPath: string | undefined;

    constructor() {
        this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBar.text = "$(loading~spin) Ollama: Checking...";
        this.statusBar.command = "committed.installOllama";
        this.statusBar.show();
    }

    /**
     * Find Ollama executable on the system
     */
    private findOllamaExecutable(): string | undefined {
        const platform = process.platform;
        const possiblePaths: string[] = [];

        if (platform === "win32") {
            possiblePaths.push(
                join(process.env.APPDATA || "", "Programs", "Ollama", "ollama.exe"),
                join(process.env.PROGRAMFILES || "C:\\Program Files", "Ollama", "ollama.exe"),
                "C:\\Program Files\\Ollama\\ollama.exe",
                "C:\\Program Files (x86)\\Ollama\\ollama.exe"
            );
        } else if (platform === "darwin") {
            possiblePaths.push(
                "/Applications/Ollama.app/Contents/MacOS/ollama",
                join(process.env.HOME || "", ".ollama", "bin", "ollama")
            );
        } else {
            possiblePaths.push(
                "/usr/local/bin/ollama",
                "/usr/bin/ollama",
                join(process.env.HOME || "", ".ollama", "bin", "ollama")
            );
        }

        for (const path of possiblePaths) {
            if (existsSync(path)) {
                this.ollamaInstallPath = path;
                return path;
            }
        }

        // Try running 'ollama --version' to find it in PATH
        try {
            execSync("ollama --version", { stdio: "pipe" });
            return "ollama";
        } catch {
            return undefined;
        }
    }

    /**
     * Prompt user to install Ollama
     */
    async promptForOllamaInstall(): Promise<void> {
        if (this.installPromptShown) {
            return;
        }

        this.installPromptShown = true;

        const choice = await vscode.window.showWarningMessage(
            "Ollama is not installed. Committed needs Ollama to power LLM-based code classification.",
            "Install Ollama",
            "Remind Later",
            "Don't Ask Again"
        );

        if (choice === "Install Ollama") {
            await this.downloadAndInstallOllama();
        } else if (choice === "Don't Ask Again") {
            // Don't prompt again in this session
            this.installPromptShown = true;
        } else {
            // Remind later
            this.installPromptShown = false;
        }
    }

    /**
     * Download and install Ollama
     */
    async downloadAndInstallOllama(): Promise<void> {
        const platform = process.platform;
        let downloadUrl = "";
        let installerFileName = "";

        if (platform === "win32") {
            downloadUrl = "https://ollama.ai/download/OllamaSetup.exe";
            installerFileName = "OllamaSetup.exe";
        } else if (platform === "darwin") {
            downloadUrl = "https://ollama.ai/download/Ollama-darwin.zip";
            installerFileName = "Ollama-darwin.zip";
        } else {
            downloadUrl = "https://ollama.ai/download/ollama-linux.zip";
            installerFileName = "ollama-linux.zip";
        }

        const tempDir = join(process.env.TEMP || "/tmp", "ollama-installer");
        mkdirSync(tempDir, { recursive: true });
        const installerPath = join(tempDir, installerFileName);

        try {
            this.statusBar.text = "$(download) Ollama: Downloading installer...";

            // Show progress message
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: "Downloading Ollama...",
                    cancellable: false,
                },
                async (progress) => {
                    progress.report({ increment: 0 });

                    // For simplicity, we'll open the download page and let the user download manually
                    // This is more reliable than trying to download in the extension
                    const openDownload = await vscode.window.showInformationMessage(
                        "Committed will now open the Ollama download page. Download the installer for your OS and run it.",
                        "Open Download Page"
                    );

                    if (openDownload) {
                        await vscode.env.openExternal(vscode.Uri.parse("https://ollama.ai/download"));
                    }

                    progress.report({ increment: 100 });
                }
            );

            this.statusBar.text = "$(clock) Ollama: Waiting for installation...";
            this.statusBar.tooltip = "Please install Ollama and restart VS Code. Committed will automatically start it.";

            // Check periodically if Ollama was installed
            let retries = 0;
            const checkInterval = setInterval(async () => {
                retries++;
                const ollamaPath = this.findOllamaExecutable();

                if (ollamaPath) {
                    clearInterval(checkInterval);
                    this.statusBar.text = "$(loading~spin) Ollama: Starting...";
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                    await this.ensureOllamaRunning();
                } else if (retries > 180) {
                    // Stop checking after 30 minutes
                    clearInterval(checkInterval);
                    this.statusBar.text = "$(error) Ollama: Installation not detected";
                }
            }, 10000); // Check every 10 seconds
        } catch (error) {
            console.error("Error during Ollama installation:", error);
            this.statusBar.text = "$(error) Ollama: Installation failed";
        }
    }

    /**
     * Check if Ollama is running by attempting to connect to it
     */
    async isOllamaRunning(): Promise<boolean> {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 2000);
            
            const response = await fetch("http://localhost:11434/api/tags", {
                signal: controller.signal,
            });
            clearTimeout(timeout);
            return response.ok;
        } catch {
            return false;
        }
    }

    /**
     * Check if a specific model is available locally
     */
    async isModelAvailable(model: string): Promise<boolean> {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3000);
            const response = await fetch("http://localhost:11434/api/tags", {
                signal: controller.signal,
            });
            clearTimeout(timeout);
            if (!response.ok) { return false; }
            const data = await response.json() as { models?: { name: string }[] };
            return (data.models ?? []).some((m) => m.name === model || m.name.startsWith(model + ":"));
        } catch {
            return false;
        }
    }

    /**
     * Pull a model from Ollama, showing progress in the status bar and notifications
     */
    async ensureModel(model: string, log?: (msg: string) => void): Promise<boolean> {
        const available = await this.isModelAvailable(model);
        if (available) {
            log?.(`Model '${model}' is already available`);
            return true;
        }

        log?.(`Model '${model}' not found — pulling it now (this may take a few minutes)...`);
        this.statusBar.text = `$(cloud-download) Pulling ${model}...`;
        this.statusBar.tooltip = `Downloading model ${model}. This only happens once.`;

        try {
            const pulled = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Committed: Downloading model "${model}"…`,
                    cancellable: false,
                },
                async (progress) => {
                    progress.report({ message: "Starting download — this may take a few minutes." });

                    const response = await fetch("http://localhost:11434/api/pull", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name: model }),
                    });

                    if (!response.ok || !response.body) {
                        log?.(`Pull request failed: ${response.status} ${response.statusText}`);
                        return false;
                    }

                    // Read the streaming response
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let lastPercent = 0;

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) { break; }

                        const text = decoder.decode(value, { stream: true });
                        // Ollama sends newline-delimited JSON
                        for (const line of text.split("\n").filter(Boolean)) {
                            try {
                                const json = JSON.parse(line) as {
                                    status?: string;
                                    total?: number;
                                    completed?: number;
                                };
                                if (json.total && json.completed) {
                                    const percent = Math.round((json.completed / json.total) * 100);
                                    if (percent > lastPercent) {
                                        progress.report({
                                            message: `${json.status ?? "downloading"} — ${percent}%`,
                                            increment: percent - lastPercent,
                                        });
                                        this.statusBar.text = `$(cloud-download) ${model}: ${percent}%`;
                                        lastPercent = percent;
                                    }
                                } else if (json.status) {
                                    progress.report({ message: json.status });
                                    log?.(`Pull: ${json.status}`);
                                }
                            } catch { /* ignore parse errors in stream */ }
                        }
                    }

                    return true;
                }
            );

            if (pulled) {
                log?.(`Model '${model}' downloaded successfully`);
                this.statusBar.text = "$(check) Ollama: Running";
                vscode.window.showInformationMessage(`Committed: Model "${model}" is ready.`);
                return true;
            }
            return false;
        } catch (error) {
            log?.(`Failed to pull model '${model}': ${error}`);
            this.statusBar.text = "$(error) Model pull failed";
            vscode.window.showErrorMessage(
                `Committed: Failed to download model "${model}". You can pull it manually: ollama pull ${model}`
            );
            return false;
        }
    }

    /**
     * Start Ollama if it's not already running
     */
    async ensureOllamaRunning(): Promise<void> {
        if (this.isStarting) {
            return;
        }

        const running = await this.isOllamaRunning();
        if (running) {
            this.statusBar.text = "$(check) Ollama: Running";
            this.statusBar.tooltip = "Ollama is running and ready for LLM classification";
            console.log("Ollama is already running");
            return;
        }

        // Find Ollama executable
        const ollamaPath = this.findOllamaExecutable();
        if (!ollamaPath) {
            console.log("Ollama not found on system, prompting for installation");
            this.statusBar.text = "$(warning) Ollama: Not installed";
            this.statusBar.tooltip = "Click to install Ollama or visit ollama.ai";
            await this.promptForOllamaInstall();
            return;
        }

        this.isStarting = true;
        this.statusBar.text = "$(loading~spin) Ollama: Starting...";

        try {
            console.log(`Starting Ollama from: ${ollamaPath}`);

            this.ollamaProcess = spawn(ollamaPath, ["serve"], {
                detached: true,
                stdio: "pipe",
            });

            this.ollamaProcess.on("error", (err) => {
                console.error("Failed to start Ollama:", err);
                this.statusBar.text = "$(error) Ollama: Failed to start";
            });

            // Wait a moment for Ollama to start
            await new Promise((resolve) => setTimeout(resolve, 2000));

            // Check if it's actually running now
            const isRunning = await this.isOllamaRunning();
            if (isRunning) {
                console.log("Ollama started successfully");
                this.statusBar.text = "$(check) Ollama: Running";
                this.statusBar.tooltip = "Ollama is running and ready for LLM classification";
            } else {
                console.log("Ollama may not have started yet");
                this.statusBar.text = "$(clock) Ollama: Starting...";
                this.statusBar.tooltip = "Ollama is starting up, this may take a moment...";
            }
        } catch (error) {
            console.error("Error starting Ollama:", error);
            this.statusBar.text = "$(error) Ollama: Start failed";
        } finally {
            this.isStarting = false;
        }
    }

    /**
     * Monitor Ollama and restart if it crashes
     */
    monitorOllama(): void {
        setInterval(async () => {
            const running = await this.isOllamaRunning();
            if (!running) {
                const ollamaPath = this.findOllamaExecutable();
                if (ollamaPath) {
                    console.log("Ollama is not running, attempting to restart...");
                    await this.ensureOllamaRunning();
                }
            } else if (this.statusBar.text !== "$(check) Ollama: Running") {
                this.statusBar.text = "$(check) Ollama: Running";
            }
        }, 30000); // Check every 30 seconds
    }

    /**
     * Stop Ollama when the extension is deactivated
     */
    dispose(): void {
        if (this.ollamaProcess && !this.ollamaProcess.killed) {
            console.log("Stopping Ollama...");
            this.ollamaProcess.kill();
        }
        this.statusBar.dispose();
    }
}
