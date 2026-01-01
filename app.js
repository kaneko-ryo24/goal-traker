// Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(e => console.log('SW error:', e));
  });
}

// PWA Install
let deferredPrompt;
const installBanner = document.getElementById('installBanner');
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; installBanner.classList.add('show'); });
document.getElementById('installBtn').addEventListener('click', async () => { if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt = null; installBanner.classList.remove('show'); } });
document.getElementById('installClose').addEventListener('click', () => installBanner.classList.remove('show'));
window.addEventListener('appinstalled', () => installBanner.classList.remove('show'));

// Toast
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast ' + type; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// Data
const STORAGE_KEY = 'goalTrackerData';
let goals = [], records = {}, selectedDate = new Date(), editingGoalId = null;
let historyViewMode = 'month', historyDate = new Date(), selectedHistoryGoalId = null;

function loadData() {
  const s = localStorage.getItem(STORAGE_KEY);
  if (s) { const d = JSON.parse(s); goals = d.goals || []; records = d.records || {}; }
}
function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, goals, records, exportedAt: new Date().toISOString() }));
}

// Export/Import
function exportData() {
  const data = { version: 1, goals, records, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `goal-tracker-backup-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  showToast('✅ データをエクスポートしました！');
}
function importData(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.goals || !data.records) throw new Error('Invalid format');
      const gc = data.goals.length;
      const rc = Object.keys(data.records).reduce((s, k) => s + Object.keys(data.records[k]).length, 0);
      if (confirm(`インポートしますか？\n\n目標: ${gc}件\n記録: ${rc}件\n\n※現在のデータは上書きされます`)) {
        goals = data.goals; records = data.records; saveData();
        renderGoals(); populateHistoryGoalSelect(); renderHistoryView();
        showToast('✅ データをインポートしました！');
        document.getElementById('settingsOverlay').classList.remove('active');
      }
    } catch (err) { showToast('❌ ファイルの読み込みに失敗しました', 'error'); }
  };
  reader.readAsText(file);
}
function deleteAllData() {
  if (confirm('本当にすべてのデータを削除しますか？\n\nこの操作は取り消せません。')) {
    if (confirm('最終確認です。\n\nすべての目標と記録が完全に削除されます。よろしいですか？')) {
      goals = []; records = {}; saveData();
      renderGoals(); populateHistoryGoalSelect(); renderHistoryView();
      showToast('🗑️ すべてのデータを削除しました');
      document.getElementById('settingsOverlay').classList.remove('active');
    }
  }
}

// Date Utils
function formatDate(d) {
  const w = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()} (${w[d.getDay()]})`;
}
function getDateKey(d) { return d.toISOString().split('T')[0]; }
function isToday(d) { return getDateKey(d) === getDateKey(new Date()); }
function renderDate() {
  let h = formatDate(selectedDate);
  if (isToday(selectedDate)) h += '<span class="today-badge">今日</span>';
  document.getElementById('currentDate').innerHTML = h;
}

// Goal Utils
function getRecord(gid, dk) { if (!records[gid]) records[gid] = {}; return records[gid][dk]; }
function setRecord(gid, dk, v) { if (!records[gid]) records[gid] = {}; records[gid][dk] = v; saveData(); }

function calculateStats(gid) {
  const g = goals.find(x => x.id === gid);
  if (!g) return { streak: 0, total: 0, totalTime: 0 };
  const gr = records[gid] || {};
  let streak = 0, total = 0, totalTime = 0;
  for (const dk of Object.keys(gr)) {
    const r = gr[dk];
    if (g.type === 'time') { if (r && r >= g.targetTime) total++; if (r) totalTime += r; }
    else { if (r === true) total++; }
  }
  let cd = new Date();
  while (true) {
    const dk = getDateKey(cd), r = gr[dk];
    let ok = g.type === 'time' ? (r && r >= g.targetTime) : (r === true);
    if (ok) { streak++; cd.setDate(cd.getDate() - 1); }
    else {
      if (streak === 0) {
        cd.setDate(cd.getDate() - 1);
        const yk = getDateKey(cd), yr = gr[yk];
        let yok = g.type === 'time' ? (yr && yr >= g.targetTime) : (yr === true);
        if (yok) { streak++; cd.setDate(cd.getDate() - 1); continue; }
      }
      break;
    }
  }
  return { streak, total, totalTime };
}

function getStatus(g, r) {
  if (g.type === 'time') {
    if (r === undefined || r === null || r === '') return { symbol: '×', class: 'danger' };
    if (r >= g.targetTime) return { symbol: '○', class: 'success' };
    return { symbol: '△', class: 'warning' };
  } else {
    return r === true ? { symbol: '○', class: 'success' } : { symbol: '×', class: 'danger' };
  }
}

function renderGoals() {
  const c = document.getElementById('goalsList'), dk = getDateKey(selectedDate);
  if (goals.length === 0) {
    c.innerHTML = '<div class="empty-state"><div class="icon">🎯</div><p>まだ目標がありません</p><p>右下の + ボタンから追加しよう！</p></div>';
    return;
  }
  c.innerHTML = goals.map(g => {
    const r = getRecord(g.id, dk), st = calculateStats(g.id), s = getStatus(g, r);
    let inp = '';
    if (g.type === 'time') {
      inp = `<div class="goal-input-area"><div class="time-input-wrapper"><input type="number" class="time-input" value="${r||''}" placeholder="0" data-goal-id="${g.id}" min="0" inputmode="numeric"><span class="time-label">分</span><span class="time-target">/ 目標 ${g.targetTime}分</span></div><div class="status-display"><span class="status-circle ${s.class}">${s.symbol}</span></div></div>`;
    } else {
      inp = `<div class="goal-input-area"><div class="bool-buttons"><button class="bool-btn ${r===true?'selected-yes':''}" data-goal-id="${g.id}" data-value="true">○</button><button class="bool-btn ${r===false?'selected-no':''}" data-goal-id="${g.id}" data-value="false">×</button></div></div>`;
    }
    let stats = `<div class="stat"><span class="stat-icon">🔥</span><span class="stat-value">${st.streak}</span><span class="stat-label">連続</span></div><div class="stat"><span class="stat-icon">✓</span><span class="stat-value">${st.total}</span><span class="stat-label">達成</span></div>`;
    if (g.type === 'time') {
      const h = Math.floor(st.totalTime/60), m = st.totalTime%60;
      stats += `<div class="stat"><span class="stat-icon">⏱️</span><span class="stat-value">${h>0?h+'時間'+m+'分':m+'分'}</span><span class="stat-label">累計</span></div>`;
    }
    return `<div class="goal-card"><div class="goal-header"><div class="goal-info"><h3>${g.name}</h3><span class="goal-type-badge">${g.type==='time'?'⏱️ 時間記録':'✅ チェック'}</span></div><div class="goal-actions"><button class="goal-action-btn edit" data-goal-id="${g.id}">✏️</button><button class="goal-action-btn delete" data-goal-id="${g.id}">🗑️</button></div></div>${inp}<div class="goal-stats">${stats}</div></div>`;
  }).join('');
  document.querySelectorAll('.time-input').forEach(i => { i.addEventListener('change', handleTimeInput); i.addEventListener('blur', handleTimeInput); });
  document.querySelectorAll('.bool-btn').forEach(b => b.addEventListener('click', handleBoolInput));
  document.querySelectorAll('.goal-action-btn.delete').forEach(b => b.addEventListener('click', handleDeleteGoal));
  document.querySelectorAll('.goal-action-btn.edit').forEach(b => b.addEventListener('click', handleEditGoal));
}

function handleTimeInput(e) { setRecord(e.target.dataset.goalId, getDateKey(selectedDate), e.target.value ? parseInt(e.target.value) : null); renderGoals(); }
function handleBoolInput(e) { setRecord(e.target.dataset.goalId, getDateKey(selectedDate), e.target.dataset.value === 'true'); renderGoals(); }
function handleDeleteGoal(e) {
  const gid = e.target.dataset.goalId, g = goals.find(x => x.id === gid);
  if (confirm(`「${g.name}」を削除しますか？\n記録もすべて削除されます。`)) {
    goals = goals.filter(x => x.id !== gid); delete records[gid]; saveData(); renderGoals(); populateHistoryGoalSelect();
  }
}
function handleEditGoal(e) {
  const gid = e.target.dataset.goalId, g = goals.find(x => x.id === gid);
  if (g) {
    editingGoalId = gid;
    document.getElementById('modalTitle').textContent = '目標を編集';
    document.getElementById('goalName').value = g.name;
    document.getElementById('submitBtn').textContent = '更新';
    document.querySelectorAll('.type-option').forEach(o => o.classList.toggle('selected', o.dataset.type === g.type));
    document.getElementById('targetTimeGroup').style.display = g.type === 'time' ? 'block' : 'none';
    if (g.type === 'time') document.getElementById('targetTime').value = g.targetTime;
    document.getElementById('modalOverlay').classList.add('active');
  }
}

// History
function populateHistoryGoalSelect() {
  document.getElementById('historyGoalSelect').innerHTML = '<option value="">目標を選択...</option>' + goals.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
}
function renderHistoryView() {
  if (!selectedHistoryGoalId) { document.getElementById('historyContent').style.display = 'none'; document.getElementById('historyEmpty').style.display = 'block'; return; }
  document.getElementById('historyContent').style.display = 'block'; document.getElementById('historyEmpty').style.display = 'none';
  renderPeriodLabel(); renderHistoryStats();
  historyViewMode === 'month' ? renderMonthCalendar() : renderYearCalendar();
}
function renderPeriodLabel() {
  document.getElementById('periodLabel').textContent = historyViewMode === 'month' ? `${historyDate.getFullYear()}年${historyDate.getMonth()+1}月` : `${historyDate.getFullYear()}年`;
}
function renderHistoryStats() {
  const g = goals.find(x => x.id === selectedHistoryGoalId); if (!g) return;
  const gr = records[selectedHistoryGoalId] || {}, y = historyDate.getFullYear(), m = historyDate.getMonth();
  let days = [];
  if (historyViewMode === 'month') { const dim = new Date(y, m+1, 0).getDate(); for (let d = 1; d <= dim; d++) days.push(getDateKey(new Date(y, m, d))); }
  else { for (let mo = 0; mo < 12; mo++) { const dim = new Date(y, mo+1, 0).getDate(); for (let d = 1; d <= dim; d++) days.push(getDateKey(new Date(y, mo, d))); } }
  let achieved = 0, partial = 0, totalTime = 0;
  days.forEach(dk => { const r = gr[dk]; if (g.type === 'time') { if (r && r >= g.targetTime) achieved++; else if (r && r > 0) partial++; if (r) totalTime += r; } else { if (r === true) achieved++; } });
  const rate = days.length > 0 ? Math.round((achieved / days.length) * 100) : 0;
  let h = `<div class="history-stat-card"><div class="history-stat-value">${achieved}</div><div class="history-stat-label">達成日数</div></div><div class="history-stat-card"><div class="history-stat-value">${rate}%</div><div class="history-stat-label">達成率</div></div>`;
  if (g.type === 'time') { const hr = Math.floor(totalTime/60), mn = totalTime%60; h += `<div class="history-stat-card"><div class="history-stat-value">${hr>0?hr+'h'+mn+'m':mn+'m'}</div><div class="history-stat-label">合計時間</div></div><div class="history-stat-card"><div class="history-stat-value">${partial}</div><div class="history-stat-label">△の日数</div></div>`; }
  document.getElementById('historyStats').innerHTML = h;
}
function renderMonthCalendar() {
  const g = goals.find(x => x.id === selectedHistoryGoalId); if (!g) return;
  const gr = records[selectedHistoryGoalId] || {}, y = historyDate.getFullYear(), m = historyDate.getMonth(), tk = getDateKey(new Date());
  const fd = new Date(y, m, 1), sw = fd.getDay(), dim = new Date(y, m+1, 0).getDate();
  const wd = ['日','月','火','水','木','金','土'];
  let h = `<div class="calendar-container"><div class="calendar-header"><div class="calendar-title">${g.name}</div><div class="calendar-legend"><div class="legend-item"><div class="legend-dot success"></div>○</div>${g.type==='time'?'<div class="legend-item"><div class="legend-dot warning"></div>△</div>':''}<div class="legend-item"><div class="legend-dot danger"></div>×</div></div></div><div class="calendar-weekdays">${wd.map(w=>`<div class="weekday">${w}</div>`).join('')}</div><div class="calendar-grid">`;
  for (let i = 0; i < sw; i++) h += '<div class="calendar-day empty"></div>';
  for (let d = 1; d <= dim; d++) { const dk = getDateKey(new Date(y, m, d)), r = gr[dk], s = getStatus(g, r); h += `<div class="calendar-day ${s.class} ${dk===tk?'today':''}" data-date="${dk}"><div class="day-num">${d}</div><div class="day-status">${s.symbol}</div></div>`; }
  h += '</div></div>';
  document.getElementById('calendarView').innerHTML = h;
  document.querySelectorAll('.calendar-day:not(.empty)').forEach(day => {
    day.addEventListener('click', () => {
      const [yy,mm,dd] = day.dataset.date.split('-').map(Number);
      selectedDate = new Date(yy, mm-1, dd); renderDate(); renderGoals();
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'today'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'todayTab'));
    });
  });
}
function renderYearCalendar() {
  const g = goals.find(x => x.id === selectedHistoryGoalId); if (!g) return;
  const gr = records[selectedHistoryGoalId] || {}, y = historyDate.getFullYear();
  const mn = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  let h = '<div class="year-grid">';
  for (let mo = 0; mo < 12; mo++) {
    const sw = new Date(y, mo, 1).getDay(), dim = new Date(y, mo+1, 0).getDate();
    h += `<div class="month-card"><div class="month-card-title">${mn[mo]}</div><div class="month-mini-grid">`;
    for (let i = 0; i < sw; i++) h += '<div class="mini-day"></div>';
    for (let d = 1; d <= dim; d++) { const dk = getDateKey(new Date(y, mo, d)), r = gr[dk], s = getStatus(g, r); h += `<div class="mini-day ${s.class}"></div>`; }
    h += '</div></div>';
  }
  h += '</div>';
  document.getElementById('calendarView').innerHTML = h;
}

// Events
document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => {
  const t = b.dataset.tab;
  document.querySelectorAll('.tab-btn').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(x => x.classList.remove('active'));
  b.classList.add('active'); document.getElementById(t + 'Tab').classList.add('active');
}));
document.getElementById('prevDay').addEventListener('click', () => { selectedDate.setDate(selectedDate.getDate()-1); renderDate(); renderGoals(); });
document.getElementById('nextDay').addEventListener('click', () => { selectedDate.setDate(selectedDate.getDate()+1); renderDate(); renderGoals(); });
document.getElementById('historyGoalSelect').addEventListener('change', e => { selectedHistoryGoalId = e.target.value || null; renderHistoryView(); });
document.querySelectorAll('.view-mode-btn').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.view-mode-btn').forEach(x => x.classList.remove('active')); b.classList.add('active');
  historyViewMode = b.dataset.mode; renderHistoryView();
}));
document.getElementById('prevPeriod').addEventListener('click', () => { historyViewMode === 'month' ? historyDate.setMonth(historyDate.getMonth()-1) : historyDate.setFullYear(historyDate.getFullYear()-1); renderHistoryView(); });
document.getElementById('nextPeriod').addEventListener('click', () => { historyViewMode === 'month' ? historyDate.setMonth(historyDate.getMonth()+1) : historyDate.setFullYear(historyDate.getFullYear()+1); renderHistoryView(); });

// Goal Modal
const modal = document.getElementById('modalOverlay'), form = document.getElementById('goalForm');
document.getElementById('addGoalBtn').addEventListener('click', () => {
  editingGoalId = null;
  document.getElementById('modalTitle').textContent = '新しい目標を追加';
  document.getElementById('submitBtn').textContent = '追加';
  form.reset();
  document.querySelectorAll('.type-option').forEach((o,i) => o.classList.toggle('selected', i===0));
  document.getElementById('targetTimeGroup').style.display = 'block';
  modal.classList.add('active');
});
document.getElementById('cancelBtn').addEventListener('click', () => { modal.classList.remove('active'); editingGoalId = null; });
modal.addEventListener('click', e => { if (e.target === modal) { modal.classList.remove('active'); editingGoalId = null; } });
document.querySelectorAll('.type-option').forEach(o => o.addEventListener('click', () => {
  document.querySelectorAll('.type-option').forEach(x => x.classList.remove('selected')); o.classList.add('selected');
  document.getElementById('targetTimeGroup').style.display = o.dataset.type === 'time' ? 'block' : 'none';
}));
form.addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('goalName').value.trim();
  const type = document.querySelector('.type-option.selected').dataset.type;
  const targetTime = type === 'time' ? parseInt(document.getElementById('targetTime').value) : null;
  if (!name) return;
  if (type === 'time' && !targetTime) { alert('目標時間を入力してください'); return; }
  if (editingGoalId) {
    const i = goals.findIndex(g => g.id === editingGoalId);
    if (i !== -1) goals[i] = { ...goals[i], name, type, targetTime };
  } else {
    goals.push({ id: Date.now().toString(), name, type, targetTime, createdAt: new Date().toISOString() });
  }
  saveData(); renderGoals(); populateHistoryGoalSelect();
  modal.classList.remove('active'); form.reset(); editingGoalId = null;
});

// Settings Modal
const settingsOverlay = document.getElementById('settingsOverlay');
document.getElementById('settingsBtn').addEventListener('click', () => settingsOverlay.classList.add('active'));
document.getElementById('settingsCloseBtn').addEventListener('click', () => settingsOverlay.classList.remove('active'));
settingsOverlay.addEventListener('click', e => { if (e.target === settingsOverlay) settingsOverlay.classList.remove('active'); });
document.getElementById('exportBtn').addEventListener('click', exportData);
document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
document.getElementById('importFile').addEventListener('change', e => { if (e.target.files[0]) { importData(e.target.files[0]); e.target.value = ''; } });
document.getElementById('deleteAllBtn').addEventListener('click', deleteAllData);

// Init
loadData(); renderDate(); renderGoals(); populateHistoryGoalSelect();
