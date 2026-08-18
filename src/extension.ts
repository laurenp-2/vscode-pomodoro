import * as vscode from "vscode";
import { exec } from "child_process";
import * as util from "util";

const execAsync = util.promisify(exec);

// ---------- types ----------

interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

interface TimerState {
  mode: "work" | "break";
  remainingMs: number;
  durationMs: number;
  running: boolean;
}

interface GitStats {
  ok: boolean;
  reason?: string;
  branch?: string;
  commitsThisSession?: number;
  insertions?: number;
  deletions?: number;
  filesChanged?: number;
}

// ---------- helpers ----------

function config() {
  return vscode.workspace.getConfiguration("devDashboard");
}

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

async function git(cwd: string, args: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`git ${args}`, { cwd });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** Parses `git diff --shortstat` output like:
 *  " 3 files changed, 42 insertions(+), 7 deletions(-)"
 */
function parseShortstat(output: string | null) {
  const result = { files: 0, insertions: 0, deletions: 0 };
  if (!output) return result;
  const filesMatch = output.match(/(\d+) files? changed/);
  const insMatch = output.match(/(\d+) insertions?\(\+\)/);
  const delMatch = output.match(/(\d+) deletions?\(-\)/);
  if (filesMatch) result.files = parseInt(filesMatch[1], 10);
  if (insMatch) result.insertions = parseInt(insMatch[1], 10);
  if (delMatch) result.deletions = parseInt(delMatch[1], 10);
  return result;
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function nonce(): string {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

// ---------- provider ----------

class DashboardProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "devDashboard.panel";

  private view?: vscode.WebviewView;
  private timer: TimerState;
  private todos: TodoItem[];
  private lastGitStats: GitStats = { ok: false, reason: "loading…" };

  private sessionStartHash?: string;
  private tickHandle?: ReturnType<typeof setInterval>;
  private gitHandle?: ReturnType<typeof setInterval>;

  private statusBarItem: vscode.StatusBarItem;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext
  ) {
    this.todos = context.workspaceState.get<TodoItem[]>("devDashboard.todos", []);
    this.timer = {
      mode: "work",
      durationMs: this.defaultDurationMs("work"),
      remainingMs: this.defaultDurationMs("work"),
      running: false,
    };

    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.statusBarItem.command = "workbench.view.extension.devDashboardContainer";
    this.statusBarItem.text = `$(clock) ${formatClock(this.timer.remainingMs)}`;
    this.statusBarItem.tooltip = "Open Dev Dashboard";
    this.statusBarItem.show();
    context.subscriptions.push(this.statusBarItem);
  }

  // called once VS Code needs to render the sidebar view
  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));

    // view can be recreated when hidden/shown again — always push fresh state
    this.pushState();
  }

  dispose() {
    if (this.tickHandle) clearInterval(this.tickHandle);
    if (this.gitHandle) clearInterval(this.gitHandle);
  }

  /** Starts the 1s timer tick and the periodic git-stats refresh. Call once from activate(). */
  startClocks() {
    this.tickHandle = setInterval(() => this.tick(), 1000);

    void this.resetSessionStats(); // captures baseline + first refresh

    const pollSeconds = config().get<number>("gitPollSeconds", 15);
    this.gitHandle = setInterval(() => void this.refreshGitStats(), pollSeconds * 1000);
  }

  // ---- pomodoro ----

  private defaultDurationMs(mode: TimerState["mode"]): number {
    const setting = mode === "work" ? "pomodoroMinutes" : "breakMinutes";
    return config().get<number>(setting, mode === "work" ? 25 : 5) * 60 * 1000;
  }

  private tick() {
    if (this.timer.running) {
      this.timer.remainingMs -= 1000;
      if (this.timer.remainingMs <= 0) {
        const finishedMode = this.timer.mode;
        this.timer.mode = finishedMode === "work" ? "break" : "work";
        this.timer.durationMs = this.defaultDurationMs(this.timer.mode);
        this.timer.remainingMs = this.timer.durationMs;
        this.timer.running = false;

        const message =
          finishedMode === "work"
            ? "Focus session done — take a break! 🍅"
            : "Break's over — back to it. 💻";
        void vscode.window.showInformationMessage(message);
      }
    }
    this.updateStatusBar();
    this.pushState();
  }

  private updateStatusBar() {
    this.statusBarItem.text = `$(clock) ${formatClock(this.timer.remainingMs)}`;
  }

  private startTimer() {
    this.timer.running = true;
    this.pushState();
  }

  private pauseTimer() {
    this.timer.running = false;
    this.pushState();
  }

  private resetTimer() {
    this.timer.remainingMs = this.timer.durationMs;
    this.timer.running = false;
    this.updateStatusBar();
    this.pushState();
  }

  private setTimerDuration(minutes: unknown) {
    const value = typeof minutes === "number" ? minutes : Number(minutes);
    // Keep the control useful while preventing an accidental multi-day timer.
    if (!Number.isFinite(value) || value < 1 || value > 240) return;

    this.timer.durationMs = Math.round(value * 60 * 1000);
    this.timer.remainingMs = this.timer.durationMs;
    this.timer.running = false;
    this.updateStatusBar();
    this.pushState();
  }

  // ---- todos ----

  private addTodo(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.todos.push({ id: nonce(), text: trimmed, done: false });
    this.saveTodos();
  }

  private toggleTodo(id: string) {
    const item = this.todos.find((t) => t.id === id);
    if (item) item.done = !item.done;
    this.saveTodos();
  }

  private deleteTodo(id: string) {
    this.todos = this.todos.filter((t) => t.id !== id);
    this.saveTodos();
  }

  private saveTodos() {
    void this.context.workspaceState.update("devDashboard.todos", this.todos);
    this.pushState();
  }

  // ---- git session stats ----

  async resetSessionStats() {
    const root = workspaceRoot();
    if (!root) {
      this.lastGitStats = { ok: false, reason: "Open a folder to see git stats." };
      this.pushState();
      return;
    }
    const head = await git(root, "rev-parse HEAD");
    if (!head) {
      this.lastGitStats = { ok: false, reason: "Not a git repository." };
      this.pushState();
      return;
    }
    this.sessionStartHash = head;
    await this.refreshGitStats();
  }

  private async refreshGitStats() {
    const root = workspaceRoot();
    if (!root || !this.sessionStartHash) return;

    const branch = (await git(root, "rev-parse --abbrev-ref HEAD")) ?? "?";
    const commitsRaw = await git(
      root,
      `rev-list --count ${this.sessionStartHash}..HEAD`
    );
    const commitsThisSession = commitsRaw ? parseInt(commitsRaw, 10) : 0;

    // committed-since-session-start + staged + unstaged, summed together
    const committed = parseShortstat(
      await git(root, `diff --shortstat ${this.sessionStartHash} HEAD`)
    );
    const staged = parseShortstat(await git(root, "diff --cached --shortstat"));
    const unstaged = parseShortstat(await git(root, "diff --shortstat"));

    this.lastGitStats = {
      ok: true,
      branch,
      commitsThisSession,
      insertions: committed.insertions + staged.insertions + unstaged.insertions,
      deletions: committed.deletions + staged.deletions + unstaged.deletions,
      filesChanged: committed.files + staged.files + unstaged.files,
    };
    this.pushState();
  }

  // ---- messaging ----

  private handleMessage(msg: any) {
    switch (msg.type) {
      case "start":
        this.startTimer();
        break;
      case "pause":
        this.pauseTimer();
        break;
      case "reset":
        this.resetTimer();
        break;
      case "setDuration":
        this.setTimerDuration(msg.minutes);
        break;
      case "addTodo":
        this.addTodo(msg.text);
        break;
      case "toggleTodo":
        this.toggleTodo(msg.id);
        break;
      case "deleteTodo":
        this.deleteTodo(msg.id);
        break;
      case "resetSession":
        void this.resetSessionStats();
        break;
    }
  }

  private pushState() {
    this.view?.webview.postMessage({
      type: "state",
      timer: this.timer,
      todos: this.todos,
      git: this.lastGitStats,
    });
  }

  // ---- html ----

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "main.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "main.css")
    );
    const cspNonce = nonce();

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${cspNonce}';" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Dev Dashboard</title>
</head>
<body>
  <section class="card">
    <div class="card-title">Pomodoro</div>
    <div class="pomodoro">
      <div class="timer-ring" role="timer" aria-live="polite">
        <svg viewBox="0 0 128 128" aria-hidden="true">
          <circle class="timer-ring-track" cx="64" cy="64" r="54" />
          <circle id="timerProgress" class="timer-ring-progress" cx="64" cy="64" r="54" stroke-dasharray="339.292" stroke-dashoffset="0" />
        </svg>
        <div class="timer-ring-content">
          <button id="clock" class="clock" type="button" title="Change timer length" aria-label="Change timer length">25:00</button>
          <input id="clockEditor" class="clock-editor" type="number" min="1" max="240" step="1" inputmode="numeric" aria-label="Timer length in minutes" hidden />
          <div class="mode" id="mode">focus</div>
        </div>
      </div>
      <div class="btn-row pomodoro-actions">
        <button id="startBtn" class="pomodoro-button pomodoro-start">Start focus</button>
        <button id="pauseBtn" class="pomodoro-button pomodoro-pause">Pause</button>
        <button id="resetBtn" class="pomodoro-button pomodoro-reset">Reset</button>
      </div>
    </div>
  </section>

 

  <section class="card">
    <div class="card-title">Todo</div>
    <ul id="todoList" class="todo-list"></ul>
    <div class="todo-input-row">
      <input id="todoInput" type="text" placeholder="Add todo" />
    </div>
  </section>

 <section class="card">
    <div class="card-title">Session Git Stats</div>
    <div id="gitStats" class="git-stats">loading…</div>
  </section>

  <script nonce="${cspNonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

// ---------- activation ----------

export function activate(context: vscode.ExtensionContext) {
  const provider = new DashboardProvider(context.extensionUri, context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(DashboardProvider.viewType, provider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("devDashboard.resetSession", () =>
      provider.resetSessionStats()
    )
  );

  provider.startClocks();
  context.subscriptions.push({ dispose: () => provider.dispose() });
}

export function deactivate() {}
