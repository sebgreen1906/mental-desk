import { state } from './state.js';
import { forfeitMatch } from './match.js';
import { stopFriendsRefresh, renderFriendsGate } from './friends.js';
import { renderOnlineGate } from './matchmaking.js';

/* ================= TICKER ================= */
const tickerData = [
  { l: 'STREAK', v: '0' }, { l: 'ACCURACY', v: '—' }, { l: 'AVG TIME', v: '—' },
  { l: 'SESSIONS RUN', v: '0' }, { l: 'TROPHIES', v: '0' }, { l: 'BEST STREAK', v: '0' }
];
export function renderTicker() {
  const track = document.getElementById('tickerTrack');
  const build = () => tickerData.map(t => `<span class="tick">${t.l} <b>${t.v}</b></span>`).join('');
  track.innerHTML = build() + build();
}
renderTicker();
export function setTick(label, value) {
  const item = tickerData.find(t => t.l === label);
  if (item) { item.v = value; renderTicker(); }
}

/* ================= TABS ================= */
document.querySelectorAll('nav.tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    if (state.onlineState && btn.dataset.view !== 'online') {
      const msg = state.onlineState.mode === 'friendly'
        ? 'Leaving now forfeits this friendly match. Continue?'
        : 'Leaving this match now forfeits it and costs you 30 trophies. Continue?';
      const proceed = confirm(msg);
      if (!proceed) return;
      forfeitMatch();
    }
    document.querySelectorAll('nav.tabs button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + btn.dataset.view).classList.add('active');
    if (btn.dataset.view !== 'friends') stopFriendsRefresh();
    if (btn.dataset.view === 'online') renderOnlineGate();
    if (btn.dataset.view === 'friends') renderFriendsGate();
  });
});
