
(function () {
  'use strict';

  /* ------------------------ Storage helpers ------------------------ */
  const DEF = {
    apps: [],         // [{id,name}]
    tasks: [],        // [{id,appId,name,note}]
    logs: [],         // [{id,appId,taskId,amount,currency,tsISO,note}]
    settings: {
      currency: 'USD',
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Bangkok',
      reminders: []   // [{id,appId,hhmm,days:[0-6],message,enabled}]
    },
    seq: 1
  };

  const load = (k, d) => GM_getValue(k, d);
  const save = (k, v) => GM_setValue(k, v);
  const state = () => {
    const s = load('earnmate_state', null);
    if (s) return s;
    save('earnmate_state', DEF);
    return load('earnmate_state');
  };
  const commit = (s) => save('earnmate_state', s);

  const nextId = (s) => {
    s.seq = (s.seq || 1) + 1;
    return s.seq;
  };

  /* --------------------------- Utilities --------------------------- */
  const el = (tag, attrs = {}, children = []) => {
    const e = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') e.className = v;
      else if (k === 'style') Object.assign(e.style, v);
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) e.setAttribute(k, v);
    });
    (Array.isArray(children) ? children : [children]).forEach(c => {
      if (c === null || c === undefined) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  };

  const money = (n) => {
    const s = state();
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: s.settings.currency || 'USD' }).format(n);
    } catch {
      return (n.toFixed(2) + ' ' + (s.settings.currency || 'USD'));
    }
  };

  const parseFloatSafe = (v) => {
    const n = parseFloat((v || '').toString().replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };

  const fmtDate = (iso) => {
    try {
      return new Date(iso).toLocaleString([], { hour12: false });
    } catch { return iso; }
  };

  const periodStart = (kind, now = new Date()) => {
    const d = new Date(now);
    if (kind === 'day') {
      d.setHours(0, 0, 0, 0);
    } else if (kind === 'week') {
      const wd = (d.getDay() + 6) % 7; // Monday=0
      d.setDate(d.getDate() - wd);
      d.setHours(0, 0, 0, 0);
    } else if (kind === 'month') {
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
    }
    return d.toISOString();
  };

  const download = (filename, text, mime = 'text/plain') => {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  /* ----------------------------- Styles ---------------------------- */
  GM_addStyle(`
  .em-fab{position:fixed;z-index:2147483647;right:14px;bottom:16px;padding:10px 14px;border-radius:999px;background:#111827;color:#fff;font-weight:700;box-shadow:0 6px 18px rgba(0,0,0,.25);cursor:pointer;user-select:none}
  .em-fab:hover{transform:translateY(-1px)}
  .em-panel{position:fixed;z-index:2147483647;right:20px;bottom:72px;width:360px;max-height:80vh;display:none;flex-direction:column;background:#0b0f19;color:#e5e7eb;border:1px solid #1f2937;border-radius:18px;box-shadow:0 16px 40px rgba(0,0,0,.45);overflow:hidden}
  .em-header{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#111827;border-bottom:1px solid #1f2937;cursor:move}
  .em-title{font-weight:800;font-size:14px;letter-spacing:.4px}
  .em-close{cursor:pointer;font-size:14px;opacity:.9}
  .em-tabs{display:flex;gap:6px;padding:8px;border-bottom:1px solid #1f2937;background:#0d1322;overflow:auto}
  .em-tab{padding:6px 10px;border-radius:10px;background:#111827;border:1px solid #1f2937;cursor:pointer;font-size:12px;white-space:nowrap}
  .em-tab.active{background:#1f2937;border-color:#374151}
  .em-body{padding:10px 12px;overflow:auto}
  .em-row{display:flex;gap:6px;margin-bottom:8px}
  .em-input,.em-select,.em-text{flex:1;padding:8px 10px;border-radius:10px;background:#0d1322;color:#e5e7eb;border:1px solid #1f2937;font-size:12px}
  .em-btn{padding:7px 10px;border-radius:10px;background:#2563eb;border:none;color:#fff;font-weight:700;cursor:pointer}
  .em-btn.secondary{background:#374151}
  .em-btn.warn{background:#dc2626}
  .em-chip{display:inline-flex;align-items:center;padding:3px 8px;border-radius:999px;background:#111827;border:1px solid #374151;margin:2px;font-size:12px}
  .em-list{border:1px solid #1f2937;border-radius:10px;overflow:hidden}
  .em-list > div{display:flex;justify-content:space-between;gap:8px;padding:8px 10px;border-bottom:1px solid #1f2937}
  .em-list > div:last-child{border-bottom:none}
  .em-muted{opacity:.8;font-size:12px}
  `);

  /* --------------------------- UI Elements ------------------------- */
  const fab = el('div', { class: 'em-fab', title: 'Open EarnMate' }, '🐾 EarnMate');
  const panel = el('div', { class: 'em-panel' });
  const header = el('div', { class: 'em-header' }, [
    el('div', { class: 'em-title' }, 'EarnMate • Browser'),
    el('div', { class: 'em-close', title: 'Close', onclick: () => panel.style.display = 'none' }, '✕')
  ]);
  const tabs = el('div', { class: 'em-tabs' });
  const body = el('div', { class: 'em-body' });
  panel.append(header, tabs, body);
  document.body.append(fab, panel);

  // Drag panel by header
  (function makeDraggable() {
    let isDown = false, startX, startY, sx, sy;
    header.addEventListener('mousedown', (e) => {
      isDown = true; startX = e.clientX; startY = e.clientY;
      const r = panel.getBoundingClientRect(); sx = r.left; sy = r.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!isDown) return;
      panel.style.right = 'unset';
      panel.style.bottom = 'unset';
      panel.style.left = (sx + e.clientX - startX) + 'px';
      panel.style.top = (sy + e.clientY - startY) + 'px';
    });
    document.addEventListener('mouseup', () => isDown = false);
  })();

  fab.addEventListener('click', () => {
    panel.style.display = (panel.style.display === 'flex' ? 'none' : 'flex');
    panel.style.flexDirection = 'column';
    render();
  });

  // Menu command
  GM_registerMenuCommand('Open EarnMate Panel', () => { panel.style.display = 'flex'; render(); });

  // Tabs
  const tabDefs = [
    { id: 'apps', label: 'Apps' },
    { id: 'tasks', label: 'Tasks' },
    { id: 'log', label: 'Log' },
    { id: 'report', label: 'Report' },
    { id: 'export', label: 'Export/Import' },
    { id: 'settings', label: 'Settings' },
  ];
  let activeTab = 'apps';

  const renderTabs = () => {
    tabs.innerHTML = '';
    tabDefs.forEach(t => {
      const b = el('button', { class: 'em-tab' + (activeTab === t.id ? ' active' : ''), onclick: () => { activeTab = t.id; render(); } }, t.label);
      tabs.appendChild(b);
    });
  };

  /* --------------------------- Data helpers ------------------------ */
  const getAppName = (s, appId) => (s.apps.find(a => a.id === appId)?.name || '—');
  const getTaskName = (s, taskId) => (s.tasks.find(t => t.id === taskId)?.name || '—');

  /* ---------------------------- Renderers -------------------------- */
  const renderApps = (s) => {
    body.innerHTML = '';
    body.append(
      el('div', { class: 'em-row' }, [
        el('input', { class: 'em-input', placeholder: 'Tên app (ví dụ: novelah)', id: 'em-app-name' }),
        el('button', { class: 'em-btn', onclick: () => {
          const name = document.getElementById('em-app-name').value.trim();
          if (!name) return;
          if (s.apps.some(a => a.name.toLowerCase() === name.toLowerCase())) return alert('App đã tồn tại.');
          s.apps.push({ id: nextId(s), name });
          commit(s); render();
        } }, 'Thêm')
      ]),
      el('div', { class: 'em-list' },
        s.apps.length ? s.apps.map(a =>
          el('div', {}, [
            el('div', {}, [
              el('div', {}, a.name),
              el('div', { class: 'em-muted' }, `ID: ${a.id}`)
            ]),
            el('div', {}, [
              el('button', { class: 'em-btn secondary', onclick: () => {
                const nv = prompt('Đổi tên app:', a.name);
                if (!nv) return;
                a.name = nv.trim();
                commit(s); render();
              } }, 'Sửa'),
              ' ',
              el('button', { class: 'em-btn warn', onclick: () => {
                if (!confirm('Xóa app và mọi task/log liên quan?')) return;
                s.tasks = s.tasks.filter(t => t.appId !== a.id);
                s.logs = s.logs.filter(l => l.appId !== a.id);
                s.reminders = (s.settings.reminders || []).filter(r => r.appId !== a.id);
                s.apps = s.apps.filter(x => x.id !== a.id);
                commit(s); render();
              } }, 'Xóa')
            ])
          ])
        ) : el('div', {}, 'Chưa có app nào.')
      )
    );
  };

  const renderTasks = (s) => {
    body.innerHTML = '';
    const sel = el('select', { class: 'em-select', id: 'em-task-app' },
      [el('option', { value: '' }, '-- Chọn app --'), ...s.apps.map(a => el('option', { value: a.id }, a.name))]
    );
    const name = el('input', { class: 'em-input', placeholder: 'Tên nhiệm vụ (VD: Đọc 30 phút)', id: 'em-task-name' });
    const note = el('input', { class: 'em-input', placeholder: 'Ghi chú (tuỳ chọn)', id: 'em-task-note' });
    const addBtn = el('button', { class: 'em-btn', onclick: () => {
      const appId = parseInt(sel.value, 10);
      if (!appId) return alert('Chọn app trước.');
      const n = name.value.trim();
      if (!n) return;
      if (s.tasks.some(t => t.appId === appId && t.name.toLowerCase() === n.toLowerCase())) {
        return alert('Nhiệm vụ đã tồn tại trong app.');
      }
      s.tasks.push({ id: nextId(s), appId, name: n, note: note.value.trim() || '' });
      commit(s); render();
    } }, 'Thêm');
    body.append(el('div', { class: 'em-row' }, [sel]), el('div', { class: 'em-row' }, [name]), el('div', { class: 'em-row' }, [note, addBtn]));

    // list
    const list = el('div', { class: 'em-list' });
    const appId = parseInt(sel.value || '0', 10);
    const view = isNaN(appId) ? [] : s.tasks.filter(t => t.appId === appId);
    list.append(
      (view.length ? view : s.tasks).map(t => el('div', {}, [
        el('div', {}, [
          el('div', {}, t.name),
          el('div', { class: 'em-muted' }, `App: ${getAppName(s, t.appId)} • ID: ${t.id}`),
          t.note ? el('div', { class: 'em-muted' }, t.note) : null
        ]),
        el('div', {}, [
          el('button', { class: 'em-btn secondary', onclick: () => {
            const nv = prompt('Đổi tên nhiệm vụ:', t.name);
            if (!nv) return;
            t.name = nv.trim();
            const nt = prompt('Ghi chú (để trống nếu không):', t.note || '');
            t.note = (nt || '').trim();
            commit(s); render();
          } }, 'Sửa'),
          ' ',
          el('button', { class: 'em-btn warn', onclick: () => {
            if (!confirm('Xóa nhiệm vụ? (log cũ sẽ giữ nguyên)')) return;
            s.tasks = s.tasks.filter(x => x.id !== t.id);
            commit(s); render();
          } }, 'Xóa')
        ])
      ]))
    );
    body.append(list);
  };

  const renderLog = (s) => {
    body.innerHTML = '';
    if (!s.apps.length) return body.append(el('div', {}, 'Hãy thêm app trước.'));
    const appSel = el('select', { class: 'em-select', id: 'em-log-app' },
      s.apps.map(a => el('option', { value: a.id }, a.name))
    );
    const taskSel = el('select', { class: 'em-select', id: 'em-log-task' });
    const amount = el('input', { class: 'em-input', placeholder: `Số tiền (${s.settings.currency})`, id: 'em-log-amount', inputmode: 'decimal' });
    const note = el('input', { class: 'em-input', placeholder: 'Ghi chú (tuỳ chọn)', id: 'em-log-note' });
    const add = el('button', { class: 'em-btn', onclick: () => {
      const aid = parseInt(appSel.value, 10);
      const tid = parseInt(taskSel.value || '0', 10) || null;
      const val = parseFloatSafe(amount.value);
      if (!aid) return alert('Chọn app.');
      if (!val) return alert('Số tiền phải > 0.');
      s.logs.unshift({ id: nextId(s), appId: aid, taskId: tid, amount: val, currency: s.settings.currency || 'USD', tsISO: new Date().toISOString(), note: note.value.trim() || '' });
      amount.value = ''; note.value = '';
      commit(s); render();
    } }, 'Ghi');
    const refreshTasks = () => {
      const aid = parseInt(appSel.value, 10);
      taskSel.innerHTML = '';
      taskSel.append(el('option', { value: '' }, '-- Không gán task --'));
      s.tasks.filter(t => t.appId === aid).forEach(t => taskSel.append(el('option', { value: t.id }, t.name)));
    };
    appSel.addEventListener('change', refreshTasks);
    refreshTasks();

    body.append(el('div', { class: 'em-row' }, [appSel]), el('div', { class: 'em-row' }, [taskSel]), el('div', { class: 'em-row' }, [amount]), el('div', { class: 'em-row' }, [note, add]));

    // Recent logs
    const list = el('div', { class: 'em-list' });
    (s.logs.slice(0, 50)).forEach(L => {
      list.append(el('div', {}, [
        el('div', {}, [
          el('div', {}, `${getAppName(s, L.appId)} • ${L.taskId ? getTaskName(s, L.taskId) : '—'} • ${money(L.amount)}`),
          el('div', { class: 'em-muted' }, fmtDate(L.tsISO) + (L.note ? ` • ${L.note}` : ''))
        ]),
        el('div', {}, [
          el('button', { class: 'em-btn secondary', onclick: () => {
            const nv = prompt('Sửa số tiền:', L.amount);
            if (nv === null) return;
            L.amount = parseFloatSafe(nv);
            const nn = prompt('Sửa ghi chú:', L.note || '');
            L.note = (nn || '').trim();
            commit(s); render();
          } }, 'Sửa'),
          ' ',
          el('button', { class: 'em-btn warn', onclick: () => {
            if (!confirm('Xóa log này?')) return;
            s.logs = s.logs.filter(x => x.id !== L.id);
            commit(s); render();
          } }, 'Xóa')
        ])
      ]));
    });
    body.append(el('div', { class: 'em-row' }, [list]));
  };

  const renderReport = (s) => {
    body.innerHTML = '';
    const kinds = ['day', 'week', 'month'];
    const makeReport = (kind) => {
      const start = periodStart(kind);
      const rows = {};
      s.logs.filter(x => x.tsISO >= start).forEach(x => {
        const key = `${getAppName(s, x.appId)}|${x.currency}`;
        rows[key] = (rows[key] || 0) + (x.amount || 0);
      });
      return rows;
    };

    kinds.forEach(k => {
      const rows = makeReport(k);
      const section = el('div', {}, [
        el('div', { class: 'em-chip' }, `Báo cáo ${k}`),
        el('div', { class: 'em-list' },
          Object.keys(rows).length ? Object.entries(rows).sort((a,b)=>b[1]-a[1]).map(([k2, total]) => {
            const [appName, cur] = k2.split('|');
            return el('div', {}, [
              el('div', {}, `${appName}`),
              el('div', { class: 'em-muted' }, `${money(total)} (${cur})`)
            ]);
          }) : el('div', {}, 'Chưa có dữ liệu trong giai đoạn này.')
        )
      ]);
      body.append(section, el('div', { style: { height: '8px' } }, ''));
    });
  };

  const renderExport = (s) => {
    body.innerHTML = '';

    // CSV
    const csvBtn = el('button', { class: 'em-btn', onclick: () => {
      const headers = ['id', 'app', 'task', 'amount', 'currency', 'timestamp', 'note'];
      const lines = [headers.join(',')];
      s.logs.forEach(L => {
        const row = [
          L.id,
          `"${getAppName(s, L.appId).replace(/"/g, '""')}"`,
          `"${(L.taskId ? getTaskName(s, L.taskId) : '').replace(/"/g, '""')}"`,
          L.amount,
          L.currency,
          L.tsISO,
          `"${(L.note || '').replace(/"/g, '""')}"`
        ];
        lines.push(row.join(','));
      });
      download(`earnmate_${Date.now()}.csv`, lines.join('\n'), 'text/csv');
    } }, 'Xuất CSV');

    // JSON backup
    const jsonBtn = el('button', { class: 'em-btn secondary', onclick: () => {
      download(`earnmate_backup_${Date.now()}.json`, JSON.stringify(s, null, 2), 'application/json');
    } }, 'Sao lưu JSON');

    const importInput = el('input', { type: 'file', class: 'em-input' });
    const importBtn = el('button', { class: 'em-btn', onclick: async () => {
      if (!importInput.files?.length) return alert('Chọn file JSON trước.');
      const text = await importInput.files[0].text();
      try {
        const data = JSON.parse(text);
        if (!data.apps || !data.tasks || !data.logs) throw new Error('Invalid structure');
        commit(data);
        alert('Khôi phục thành công!');
        render();
      } catch (e) {
        alert('File không hợp lệ: ' + e.message);
      }
    } }, 'Khôi phục JSON');

    body.append(
      el('div', { class: 'em-row' }, [csvBtn, jsonBtn]),
      el('div', { class: 'em-row' }, [importInput, importBtn])
    );
  };

  const renderSettings = (s) => {
    body.innerHTML = '';

    const cur = el('input', { class: 'em-input', value: s.settings.currency || 'USD' });
    const tz = el('input', { class: 'em-input', value: s.settings.tz || 'Asia/Bangkok' });

    const saveBtn = el('button', { class: 'em-btn', onclick: () => {
      s.settings.currency = (cur.value || 'USD').toUpperCase();
      s.settings.tz = tz.value || s.settings.tz;
      commit(s); alert('Đã lưu cài đặt.');
    } }, 'Lưu');

    body.append(el('div', { class: 'em-row' }, [el('div', { class: 'em-chip' }, 'Hiển thị')]));
    body.append(el('div', { class: 'em-row' }, [cur, tz, saveBtn]));

    // Reminders
    body.append(el('div', { class: 'em-row' }, [el('div', { class: 'em-chip' }, 'Nhắc việc (trình duyệt phải đang mở)')]));
    const rApp = el('select', { class: 'em-select' }, s.apps.map(a => el('option', { value: a.id }, a.name)));
    const rTime = el('input', { class: 'em-input', placeholder: 'HH:MM (24h)', value: '20:00' });
    const rDays = el('input', { class: 'em-input', placeholder: 'Ngày trong tuần (VD: 1,2,3 cho T2-4)' });
    const rMsg = el('input', { class: 'em-input', placeholder: 'Nội dung thông báo (VD: Nhớ check-in)' });
    const rAdd = el('button', { class: 'em-btn', onclick: () => {
      if (!s.apps.length) return alert('Chưa có app.');
      const hhmm = (rTime.value || '').trim();
      if (!/^\d{2}:\d{2}$/.test(hhmm)) return alert('Định dạng giờ HH:MM.');
      const days = (rDays.value || '0,1,2,3,4,5,6').split(',').map(x => parseInt(x.trim(), 10)).filter(x => x>=0 && x<=6);
      const msg = (rMsg.value || '').trim() || 'Nhắc việc EarnMate';
      const obj = { id: nextId(s), appId: parseInt(rApp.value, 10), hhmm, days, message: msg, enabled: true };
      s.settings.reminders = s.settings.reminders || [];
      s.settings.reminders.push(obj);
      commit(s); render();
    } }, 'Thêm nhắc');

    body.append(el('div', { class: 'em-row' }, [rApp]), el('div', { class: 'em-row' }, [rTime]), el('div', { class: 'em-row' }, [rDays]), el('div', { class: 'em-row' }, [rMsg, rAdd]));

    const list = el('div', { class: 'em-list' });
    (s.settings.reminders || []).forEach(R => {
      list.append(el('div', {}, [
        el('div', {}, [
          el('div', {}, `${getAppName(s, R.appId)} • ${R.hhmm}`),
          el('div', { class: 'em-muted' }, `Days: ${R.days.join(',')} • ${R.message}`)
        ]),
        el('div', {}, [
          el('button', { class: 'em-btn secondary', onclick: () => {
            R.enabled = !R.enabled; commit(s); render();
          } }, R.enabled ? 'Tắt' : 'Bật'),
          ' ',
          el('button', { class: 'em-btn warn', onclick: () => {
            s.settings.reminders = s.settings.reminders.filter(x => x.id !== R.id);
            commit(s); render();
          } }, 'Xóa')
        ])
      ]));
    });
    body.append(list);

    // Notification permission
    const notif = el('button', { class: 'em-btn secondary', onclick: async () => {
      if (Notification.permission === 'granted') return alert('Đã được phép.');
      const p = await Notification.requestPermission();
      alert('Notification permission: ' + p);
    } }, 'Cấp quyền thông báo');
    body.append(el('div', { class: 'em-row' }, [notif]));
  };

  const render = () => {
    const s = state();
    renderTabs();
    if (activeTab === 'apps') return renderApps(s);
    if (activeTab === 'tasks') return renderTasks(s);
    if (activeTab === 'log') return renderLog(s);
    if (activeTab === 'report') return renderReport(s);
    if (activeTab === 'export') return renderExport(s);
    if (activeTab === 'settings') return renderSettings(s);
  };

  /* ------------------------- Reminder engine ----------------------- */
  let tickTimer = null, lastMinute = '';
  const tick = () => {
    const s = state();
    const now = new Date();
    const hhmm = now.toTimeString().slice(0,5); // HH:MM
    if (hhmm === lastMinute) return; // run once per minute
    lastMinute = hhmm;

    const today = now.getDay(); // 0=Sun
    (s.settings.reminders || []).forEach(R => {
      if (!R.enabled) return;
      if (!R.days.includes(today)) return;
      if (R.hhmm !== hhmm) return;
      try {
        new Notification(`EarnMate • ${getAppName(s, R.appId)}`, { body: R.message || 'Nhắc việc', tag: `earnmate-${R.id}` });
      } catch {
        // Fallback
        alert(`🔔 EarnMate: ${getAppName(s, R.appId)} • ${R.message}`);
      }
    });
  };
  const startTicker = () => {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(tick, 5 * 1000); // check every 5s, but fire once per minute
  };
  startTicker();

  /* --------------------------- First render ------------------------ */
  // Auto-open once on first install (optional; comment out if not desired)
  // panel.style.display = 'flex'; render();

})();