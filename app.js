(function() {
  'use strict';

  const Store = {
    KEY: 'todayspeak_tasks',

    load() {
      try {
        const data = localStorage.getItem(this.KEY);
        return data ? JSON.parse(data) : [];
      } catch { return []; }
    },

    save(tasks) {
      try {
        localStorage.setItem(this.KEY, JSON.stringify(tasks));
      } catch (e) {
        showToast('Storage full — some tasks may not be saved');
      }
    },

    add(task) {
      const tasks = this.load();
      task.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      task.createdAt = Date.now();
      task.completed = false;
      tasks.unshift(task);
      this.save(tasks);
      return tasks;
    },

    toggle(id) {
      const tasks = this.load();
      const t = tasks.find(t => t.id === id);
      if (t) { t.completed = !t.completed; this.save(tasks); }
      return tasks;
    },

    remove(id) {
      const tasks = this.load().filter(t => t.id !== id);
      this.save(tasks);
      return tasks;
    },

    clearCompleted() {
      const tasks = this.load().filter(t => !t.completed);
      this.save(tasks);
      return tasks;
    }
  };

  function splitTranscript(text) {
    const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);
    const fragments = [];
    for (const sentence of sentences) {
      const parts = sentence.split(/\s+(and|then|also)\s+/i);
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.length > 0) {
          const commaParts = trimmed.split(/\s*,\s*/);
          for (const cp of commaParts) {
            const c = cp.trim();
            if (c.length > 0) fragments.push(c);
          }
        }
      }
    }
    return fragments;
  }

  function smartParse(transcript) {
    const fragments = splitTranscript(transcript);
    return fragments.map(f => parseFragment(f)).filter(t => t !== null);
  }

  function parseFragment(text) {
    let t = text.trim();
    if (t.length === 0) return null;

    let priority = 'normal';
    let dueDate = null;
    let dueLabel = null;

    const urgencyRegex = /\b(asap|urgent(ly)?|immediately|as soon as possible|critical|important|deadline|right away|high priority|now|asap!?)\b/i;
    const urgencyMatch = t.match(urgencyRegex);
    if (urgencyMatch) {
      priority = 'high';
      t = t.replace(urgencyRegex, '').trim();
    }

    const timeRegex = /at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i;
    const timeMatch = t.match(timeRegex);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]);
      const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      const meridiem = timeMatch[3].toLowerCase();
      if (meridiem === 'pm' && hours < 12) hours += 12;
      if (meridiem === 'am' && hours === 12) hours = 0;
      const date = new Date();
      date.setHours(hours, minutes, 0, 0);
      if (date <= new Date()) date.setDate(date.getDate() + 1);
      dueDate = date.toISOString();
      dueLabel = timeMatch[0].replace(/^at\s+/i, '');
      t = t.replace(timeRegex, '').trim();
    }

    if (!dueDate) {
      const relRegex = /\b(tomorrow|tonight|this\s+(morning|afternoon|evening)|(?:this\s+)?(morning|afternoon|evening))\b/i;
      const relMatch = t.match(relRegex);
      if (relMatch) {
        const matched = relMatch[0].toLowerCase().trim();
        const date = new Date();
        const hr = date.getHours();

        if (matched === 'tomorrow') {
          date.setDate(date.getDate() + 1);
          date.setHours(9, 0, 0, 0);
          dueLabel = 'tomorrow';
        } else if (matched === 'tonight' || matched === 'this evening' || matched === 'evening') {
          if (hr >= 21) date.setDate(date.getDate() + 1);
          date.setHours(21, 0, 0, 0);
          dueLabel = matched === 'tonight' ? 'tonight' : 'evening';
        } else if (matched === 'morning' || matched === 'this morning') {
          if (hr >= 12) date.setDate(date.getDate() + 1);
          date.setHours(9, 0, 0, 0);
          dueLabel = 'morning';
        } else if (matched === 'afternoon' || matched === 'this afternoon') {
          if (hr >= 17) date.setDate(date.getDate() + 1);
          date.setHours(14, 0, 0, 0);
          dueLabel = 'afternoon';
        }

        dueDate = date.toISOString();
        t = t.replace(relRegex, '').trim();
      }
    }

    t = t.replace(/[,\s]+$/, '').trim();
    t = t.charAt(0).toUpperCase() + t.slice(1);

    if (t.length === 0) return null;

    return { text: t, priority, dueDate, dueLabel, completed: false };
  }

  function sortAndGroup(tasks) {
    const incomplete = tasks.filter(t => !t.completed);
    const completed = tasks.filter(t => t.completed);

    incomplete.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority === 'high' ? -1 : 1;
      if (a.dueDate && b.dueDate) return new Date(a.dueDate) - new Date(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return b.createdAt - a.createdAt;
    });

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 86400000);

    const groups = { today: [], tomorrow: [], week: [], later: [], completed: [] };

    for (const task of incomplete) {
      if (!task.dueDate) {
        groups.later.push(task);
      } else {
        const due = new Date(task.dueDate);
        const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
        const diff = dueDay.getTime() - today.getTime();
        if (diff === 0) groups.today.push(task);
        else if (diff === 86400000) groups.tomorrow.push(task);
        else if (diff > 0 && diff < 7 * 86400000) groups.week.push(task);
        else groups.later.push(task);
      }
    }

    groups.completed = completed;
    return groups;
  }

  function render(tasks) {
    const container = document.getElementById('taskList');
    const empty = document.getElementById('emptyState');
    const groups = sortAndGroup(tasks);

    const hasTasks = Object.values(groups).some(g => g.length > 0);
    container.style.display = hasTasks ? 'block' : 'none';
    empty.style.display = hasTasks ? 'none' : 'flex';

    const labels = {
      today: 'Today',
      tomorrow: 'Tomorrow',
      week: 'This Week',
      later: 'Someday',
      completed: 'Completed'
    };

    let html = '';
    for (const [key, items] of Object.entries(groups)) {
      if (items.length === 0) continue;
      html += `<div class="section-label">${labels[key]}</div>`;
      for (const task of items) {
        html += renderTask(task);
      }
    }

    container.innerHTML = html;

    container.querySelectorAll('.task-check').forEach(el => {
      el.addEventListener('click', () => {
        const tasks = Store.toggle(el.dataset.id);
        render(tasks);
      });
    });
    container.querySelectorAll('.task-delete').forEach(el => {
      el.addEventListener('click', () => {
        const tasks = Store.remove(el.dataset.id);
        render(tasks);
      });
    });
  }

  function renderTask(task) {
    const checked = task.completed ? ' checked' : '';
    const checkedIcon = task.completed
      ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
      : '';
    const completedClass = task.completed ? ' completed' : '';

    let badges = '';
    if (task.dueLabel) {
      badges += `<span class="badge badge-time">${task.dueLabel}</span>`;
    }
    if (task.priority === 'high') {
      badges += `<span class="badge badge-urgent">URGENT</span>`;
    }

    return `
      <div class="task-item${completedClass}">
        <button class="task-check${checked}" data-id="${task.id}" aria-label="${task.completed ? 'Mark incomplete' : 'Mark complete'}">${checkedIcon}</button>
        <div class="task-body">
          <span class="task-text">${escapeHtml(task.text)}</span>
          <div class="task-meta">${badges}</div>
        </div>
        <button class="task-delete" data-id="${task.id}" aria-label="Delete task">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`;
  }

  function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
  }

  let toastTimer;

  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2500);
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let isListening = false;
  let retryCount = 0;
  let permissionRequested = false;

  const micBtn = document.getElementById('micBtn');
  const statusText = document.getElementById('statusText');
  const interimText = document.getElementById('interimText');

  function initSpeech() {
    if (!SpeechRecognition) {
      document.getElementById('micSection').style.display = 'none';
      document.getElementById('fallbackSection').classList.remove('hidden');
      document.getElementById('addBtn').addEventListener('click', addFromText);
      document.getElementById('textInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') addFromText();
      });
      return;
    }

    micBtn.addEventListener('click', toggleMic);
  }

  async function requestMicPermission() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      permissionRequested = true;
      return true;
    } catch {
      showToast('Microphone access denied — enable it in settings');
      return false;
    }
  }

  function createRecognition() {
    if (recognition) {
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try { recognition.abort(); } catch {}
    }

    recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      isListening = true;
      retryCount = 0;
      micBtn.classList.add('listening');
      statusText.textContent = 'Listening...';
      interimText.classList.remove('hidden');
      interimText.textContent = '';
    };

    recognition.onresult = (e) => {
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += text;
        else interim += text;
      }
      if (interim) interimText.textContent = interim;
      if (final) {
        interimText.textContent = final;
        processTranscript(final);
      }
    };

    recognition.onerror = (e) => {
      console.error('Speech error:', e.error);
      if (e.error === 'aborted' && retryCount < 3) {
        retryCount++;
        setTimeout(() => {
          try { recognition.start(); } catch {}
        }, 500);
        return;
      }
      resetMic();
      if (e.error === 'not-allowed') {
        showToast('Microphone access denied — enable it in settings');
      } else if (e.error === 'no-speech') {
        showToast('No speech detected — try again');
      } else if (e.error !== 'aborted') {
        showToast('Voice error: ' + e.error);
      }
    };

    recognition.onend = () => {
      if (isListening) {
        if (retryCount < 3) {
          retryCount++;
          setTimeout(() => {
            try { recognition.start(); } catch {}
          }, 500);
          return;
        }
      }
      resetMic();
    };
  }

  async function toggleMic() {
    if (!recognition && !SpeechRecognition) return;

    if (isListening) {
      recognition.stop();
      resetMic();
      return;
    }

    if (!permissionRequested) {
      statusText.textContent = 'Requesting mic...';
      const granted = await requestMicPermission();
      if (!granted) {
        resetMic();
        return;
      }
    }

    createRecognition();
    retryCount = 0;
    try {
      recognition.start();
    } catch (e) {
      showToast('Voice recognition unavailable');
    }
  }

  function resetMic() {
    isListening = false;
    micBtn.classList.remove('listening', 'processing');
    statusText.textContent = 'Tap to speak';
    interimText.classList.add('hidden');
    interimText.textContent = '';
  }

  function processTranscript(text) {
    micBtn.classList.remove('listening');
    micBtn.classList.add('processing');
    statusText.textContent = 'Organizing...';

    const tasks = smartParse(text);
    if (tasks.length === 0) {
      showToast('Could not parse tasks — try again');
      resetMic();
      return;
    }

    let current = Store.load();
    for (const task of tasks) {
      current = Store.add(task);
    }
    render(current);

    const count = tasks.length;
    showToast(`${count} task${count > 1 ? 's' : ''} added`);
    resetMic();
  }

  function addFromText() {
    const input = document.getElementById('textInput');
    const text = input.value.trim();
    if (!text) return;

    const tasks = smartParse(text);
    if (tasks.length === 0) {
      showToast('Could not parse task');
      return;
    }

    let current = Store.load();
    for (const task of tasks) {
      current = Store.add(task);
    }
    render(current);
    input.value = '';

    const count = tasks.length;
    showToast(`${count} task${count > 1 ? 's' : ''} added`);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const tasks = Store.load();
    render(tasks);
    initSpeech();

    document.getElementById('clearBtn').addEventListener('click', () => {
      const current = Store.load();
      const hasCompleted = current.some(t => t.completed);
      if (!hasCompleted) {
        showToast('No completed tasks to clear');
        return;
      }
      const updated = Store.clearCompleted();
      render(updated);
      showToast('Completed tasks cleared');
    });
  });

})();
