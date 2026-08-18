# Changelog

All notable changes to Dev Dashboard are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned

- Standup summary of the day's commits via a local Ollama model
- Exact per-commit line attribution using `git log --numstat`
- Optional daily auto-reset of the session baseline

## [0.1.0] - 2026-08-18

### Added

- Activity Bar icon and Side Bar dashboard panel
- Pomodoro timer with configurable work and break lengths, auto-switching
  between modes and a notification when a session ends
- Session Git stats: current branch, commits since the session baseline, and
  lines added/removed including staged and unstaged changes
- Workspace-persistent todo list with add, toggle and delete
- Status bar countdown that opens the panel when clicked
- `Dev Dashboard: Reset Session Stats` command, also available as a refresh
  icon in the panel's title bar
