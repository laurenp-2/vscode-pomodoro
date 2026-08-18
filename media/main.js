// This script runs *inside the webview* (a sandboxed browser context), not in the
// extension host. It can only talk to extension.ts via postMessage — no Node/vscode APIs here.
(function () {
  const vscode = acquireVsCodeApi();

  const clockEl = document.getElementById("clock");
  const modeEl = document.getElementById("mode");
  const startBtn = document.getElementById("startBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  const resetBtn = document.getElementById("resetBtn");
  const clockEditor = document.getElementById("clockEditor");
  const timerProgressEl = document.getElementById("timerProgress");
  const gitStatsEl = document.getElementById("gitStats");
  const todoInput = document.getElementById("todoInput");
  const todoListEl = document.getElementById("todoList");

  startBtn.addEventListener("click", () => vscode.postMessage({ type: "start" }));
  pauseBtn.addEventListener("click", () => vscode.postMessage({ type: "pause" }));
  resetBtn.addEventListener("click", () => vscode.postMessage({ type: "reset" }));

  function setDuration() {
    const minutes = Number(clockEditor.value);
    if (Number.isFinite(minutes) && minutes >= 1 && minutes <= 240) {
      vscode.postMessage({ type: "setDuration", minutes });
    }
  }

  function stopEditingDuration() {
    clockEditor.hidden = true;
    clockEl.hidden = false;
  }

  clockEl.addEventListener("click", () => {
    clockEditor.value = String(Math.round(lastTimer.durationMs / 60000));
    clockEl.hidden = true;
    clockEditor.hidden = false;
    clockEditor.focus();
    clockEditor.select();
  });
  clockEditor.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      setDuration();
      stopEditingDuration();
    } else if (e.key === "Escape") {
      stopEditingDuration();
    }
  });
  clockEditor.addEventListener("blur", () => {
    if (!clockEditor.hidden) {
      setDuration();
      stopEditingDuration();
    }
  });

  todoInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && todoInput.value.trim()) {
      vscode.postMessage({ type: "addTodo", text: todoInput.value });
      todoInput.value = "";
    }
  });

  function formatClock(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    }
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  let lastTimer = { durationMs: 25 * 60 * 1000 };

  function renderTimer(timer) {
    lastTimer = timer;
    clockEl.textContent = formatClock(timer.remainingMs);
    modeEl.textContent = timer.mode === "work" ? "focus" : "break";
    const progress = Math.max(0, Math.min(1, timer.remainingMs / timer.durationMs));
    const dashOffset = String(339.292 * (1 - progress));
    timerProgressEl.setAttribute("stroke-dashoffset", dashOffset);
    timerProgressEl.style.setProperty("stroke-dashoffset", dashOffset);
    startBtn.disabled = timer.running;
    pauseBtn.disabled = !timer.running;
  }

  function renderGitStats(git) {
    if (!git || !git.ok) {
      gitStatsEl.textContent = git?.reason ?? "unavailable";
      return;
    }
    gitStatsEl.innerHTML = `
      <div class="stat-row"><span>Branch</span><b>${git.branch}</b></div>
      <div class="stat-row"><span>Commits this session</span><b>${git.commitsThisSession}</b></div>
      <div class="stat-row"><span>Lines changed</span><b><span class="ins">+${git.insertions}</span> <span class="del">-${git.deletions}</span></b></div>
    `;
  }

  function renderTodos(todos) {
    todoListEl.innerHTML = "";
    for (const todo of todos) {
      const li = document.createElement("li");
      li.className = todo.done ? "done" : "";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = todo.done;
      checkbox.addEventListener("change", () =>
        vscode.postMessage({ type: "toggleTodo", id: todo.id })
      );

      const label = document.createElement("span");
      label.className = "todo-text";
      label.textContent = todo.text;

      const del = document.createElement("button");
      del.className = "todo-delete";
      del.textContent = "×";
      del.addEventListener("click", () =>
        vscode.postMessage({ type: "deleteTodo", id: todo.id })
      );

      li.appendChild(checkbox);
      li.appendChild(label);
      li.appendChild(del);
      todoListEl.appendChild(li);
    }
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type === "state") {
      renderTimer(msg.timer);
      renderGitStats(msg.git);
      renderTodos(msg.todos);
    }
  });
})();
