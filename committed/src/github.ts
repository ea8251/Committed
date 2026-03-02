import * as vscode from 'vscode';

async function getGitHubToken(): Promise<string | null> {
    const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
    if (session) {
        return session.accessToken;
    }
    return null;
}

export async function getGitHubClient() {
    const token = await getGitHubToken();
    if (token) {
        const { Octokit } = await import('@octokit/rest');
        return new Octokit({ auth: token });
    }
    return null;
}

export async function getGitDiff(): Promise<string | null> {
    const gitExtension = vscode.extensions.getExtension<{ getAPI(version: number): any }>('vscode.git')?.exports;
    if (!gitExtension) {
        return null;
    }

    const git = gitExtension.getAPI(1);
    const repo = git.repositories[0];

    if (!repo) {
        return null;
    }

    // Get diff of all changes (staged + unstaged)
    const diff = await repo.diff(true);
    return diff;
}