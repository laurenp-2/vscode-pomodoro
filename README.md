# Dev Dashboard

A lightweight VS Code sidebar for staying focused while you work. It includes:

- A configurable Pomodoro timer with work and break sessions
- Live Git session stats for commits, insertions, and deletions
- A workspace-persistent todo list
- A status bar countdown clock

## Requirements

- [VS Code](https://code.visualstudio.com/) 1.85 or newer
- Git available on your `PATH`

## Run locally

1. Clone this repository and open it in VS Code.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Press `F5` or select **Run → Start Debugging**.

VS Code opens an Extension Development Host window with Dev Dashboard enabled. Select the Dev Dashboard icon in the Activity Bar to open it.

To rebuild automatically while developing, run:

```bash
npm run watch
```

## Install from a VSIX

To create an installable package:

```bash
npm install -g @vscode/vsce
vsce package
```

Then install the generated `.vsix` file from the Extensions view using **… → Install from VSIX…**.

## Settings

Configure the timer and Git refresh interval in VS Code settings:

- `devDashboard.pomodoroMinutes` — focus session length; default `25`
- `devDashboard.breakMinutes` — break length; default `5`
- `devDashboard.gitPollSeconds` — Git refresh interval; default `15`
