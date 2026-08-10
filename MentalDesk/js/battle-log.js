import { db, doc, setDoc, collection, query, orderBy, limit, getDocs } from './firebase.js';
import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { LEAGUES, leagueForTrophies } from './leagues.js';
import { sendFriendRequest } from './friends.js';

/* ================= ONLINE: BATTLE LOG ================= */
export function formatRelativeTime(ts) {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return 'Just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`;
  const mo = Math.floor(day / 30);
  return `${mo} month${mo === 1 ? '' : 's'} ago`;
}

export async function computeExpectedScore(uid, avgDifficultyThisMatch) {
  try {
    const q = query(collection(db, 'users', uid, 'matchHistory'), orderBy('timestamp', 'desc'), limit(5));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    let totalScore = 0, totalDiff = 0, n = 0;
    snap.forEach(d => {
      const m = d.data();
      totalScore += m.displayScore || 0;
      totalDiff += m.avgDifficulty || 0.3;
      n++;
    });
    const avgScore = totalScore / n;
    const avgDiff = totalDiff / n || 0.3;
    const ratio = Math.max(0.5, Math.min(1.5, avgDiff / Math.max(0.05, avgDifficultyThisMatch)));
    return Math.round(avgScore * ratio);
  } catch (err) {
    console.error('Expected score calc failed', err);
    return null;
  }
}

export async function logMatchToHistory({ result, displayScore, oppDisplayScore, trophyDelta, forfeited }) {
  if (!state.currentUser || !state.onlineState) return;
  const onlineState = state.onlineState;
  const uid = state.currentUser.uid; // captured now — onlineState/currentUser may change while we await below

  const totalAnswered = (onlineState.myScore || 0) + (onlineState.myWrong || 0);
  const accuracy = totalAnswered ? Math.round((onlineState.myScore / totalAnswered) * 100) : 0;
  const times = (onlineState.answerHistory || []).map(h => h.time);
  const avgAnswerTime = times.length ? Number((times.reduce((a, b) => a + b, 0) / times.length).toFixed(1)) : 0;
  const diffs = onlineState.difficultyHistory || [];
  const avgDifficulty = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0.3;

  // Build the full entry BEFORE the await below — endMatch()/forfeitMatch() null out onlineState
  // right after calling this (fire-and-forget), so nothing here can read onlineState post-await.
  const entry = {
    opponentUid: onlineState.isBot ? null : onlineState.oppUid,
    opponentName: onlineState.oppName,
    opponentIsBot: !!onlineState.isBot,
    opponentTrophies: onlineState.oppTrophiesAtStart || 0,
    opponentLeagueId: leagueForTrophies(onlineState.oppTrophiesAtStart || 0).id,
    mode: onlineState.mode,
    result, forfeited: !!forfeited,
    displayScore, oppDisplayScore, trophyDelta,
    accuracy, avgAnswerTime,
    longestStreak: onlineState.myBestStreak || 0,
    totalAnswered, correctAnswers: onlineState.myScore || 0, incorrectAnswers: onlineState.myWrong || 0,
    skipped: onlineState.skipCount || 0,
    avgDifficulty: Number(avgDifficulty.toFixed(2)),
    timestamp: Date.now()
  };

  entry.expectedScore = await computeExpectedScore(uid, avgDifficulty);

  const ref = doc(collection(db, 'users', uid, 'matchHistory'));
  setDoc(ref, entry).catch(err => console.error('Failed to log match history', err));
}

export async function renderBattleLog() {
  const list = document.getElementById('battleLogList');
  if (!list || !state.currentUser) return;
  list.innerHTML = '<div class="empty-note">Loading…</div>';
  try {
    const q = query(collection(db, 'users', state.currentUser.uid, 'matchHistory'), orderBy('timestamp', 'desc'), limit(5));
    const snap = await getDocs(q);
    state.battleLogEntries = [];
    snap.forEach(d => state.battleLogEntries.push(d.data()));
    state.battleLogExpanded = false;
    renderBattleLogList();
  } catch (err) {
    console.error('Failed to load battle log', err);
    list.innerHTML = '<div class="empty-note">Couldn\'t load battle log.</div>';
  }
}

export function renderBattleLogList() {
  const list = document.getElementById('battleLogList');
  if (!list) return;
  list.innerHTML = '';
  if (state.battleLogEntries.length === 0) {
    list.innerHTML = '<div class="empty-note">No matches played yet — find a match to get started.</div>';
    return;
  }
  const shown = state.battleLogExpanded ? state.battleLogEntries : state.battleLogEntries.slice(0, 1);
  shown.forEach(m => renderBattleEntry(list, m));

  if (state.battleLogEntries.length > 1) {
    const toggle = document.createElement('button');
    toggle.className = 'battle-toggle-btn';
    toggle.textContent = state.battleLogExpanded
      ? '▲ Show fewer'
      : `▼ Show last ${state.battleLogEntries.length} matches`;
    toggle.addEventListener('click', () => {
      state.battleLogExpanded = !state.battleLogExpanded;
      renderBattleLogList();
    });
    list.appendChild(toggle);
  }
}

function renderBattleEntry(container, m) {
  const league = LEAGUES.find(l => l.id === m.opponentLeagueId) || LEAGUES[0];
  const isWin = m.result === 'win';
  const isDraw = m.result === 'draw';
  const row = document.createElement('div');
  row.className = 'battle-entry';
  const trophyHtml = (m.mode === 'friendly' || isDraw)
    ? `<span class="battle-trophy">${isDraw ? 'Draw' : 'Friendly'}</span>`
    : `<span class="battle-trophy ${m.trophyDelta >= 0 ? 'up' : 'down'}">${m.trophyDelta >= 0 ? '+' : ''}${m.trophyDelta} 🏆</span>`;
  const modeTag = m.mode === 'friendly' ? '🤝 Friendly Match' : '🏆 Ranked Match';
  const outcomeLabel = isDraw ? 'Draw' : (isWin ? 'Victory' : 'Defeat');
  const outcomeClass = isDraw ? 'draw' : (isWin ? 'win' : 'loss');
  row.innerHTML = `
    <div class="battle-top">
      <span class="battle-outcome ${outcomeClass}">${outcomeLabel}${m.forfeited ? ' (forfeit)' : ''}</span>
      ${trophyHtml}
    </div>
    <div class="battle-score">${m.displayScore} – ${m.oppDisplayScore}</div>
    <div class="battle-mode-tag">${modeTag}</div>
    <div class="battle-vs">vs ${escapeHtml(m.opponentName)}${m.opponentIsBot ? ' 🤖' : ''}</div>
    <div class="battle-meta">${league.icon} ${league.name} League · ${m.opponentTrophies || 0} trophies</div>
    <div class="battle-time">${formatRelativeTime(m.timestamp)}</div>
    <button class="battle-details-btn">▶ View Details</button>
  `;
  row.querySelector('.battle-details-btn').addEventListener('click', () => openMatchDetails(m));
  container.appendChild(row);
}

export function openMatchDetails(m) {
  document.getElementById('matchDetailsTitle').textContent =
    m.result === 'draw' ? 'Draw' : (m.result === 'win' ? 'Victory' : 'Defeat');
  const modeLabel = m.mode === 'friendly' ? 'Friendly Match' : 'Ranked Match';
  document.getElementById('matchDetailsSub').textContent =
    `vs ${m.opponentName}${m.opponentIsBot ? ' (bot)' : ''} · ${modeLabel} · ${formatRelativeTime(m.timestamp)}`;

  const stats = [
    ['Accuracy', m.accuracy + '%'],
    ['Avg answer time', m.avgAnswerTime + 's'],
    ['Longest streak', m.longestStreak],
    ['Total answered', m.totalAnswered],
    ['Correct answers', m.correctAnswers],
    ['Incorrect answers', m.incorrectAnswers],
    ['Skipped', m.skipped || 0],
  ];
  if (m.expectedScore != null) stats.push(['Expected score', m.expectedScore]);

  document.getElementById('matchDetailsStats').innerHTML = stats.map(([label, val]) =>
    `<div class="summary-stat"><div class="num">${val}</div><div class="lab">${label}</div></div>`
  ).join('');

  const friendWrap = document.getElementById('matchDetailsAddFriendWrap');
  friendWrap.innerHTML = '';
  if (!m.opponentIsBot && m.opponentUid && m.opponentUid !== state.currentUser.uid) {
    if ((state.profile.friends || []).includes(m.opponentUid)) {
      friendWrap.innerHTML = '<div class="empty-note">Already friends</div>';
    } else {
      const btn = document.createElement('button');
      btn.className = 'btn-small';
      btn.textContent = 'Add as friend';
      btn.addEventListener('click', () => {
        sendFriendRequest(m.opponentUid);
        btn.textContent = 'Sent';
        btn.disabled = true;
      });
      friendWrap.appendChild(btn);
    }
  }

  document.getElementById('matchDetailsModal').classList.remove('hidden');
}

export function closeMatchDetailsModal() {
  document.getElementById('matchDetailsModal').classList.add('hidden');
}

document.getElementById('matchDetailsClose').addEventListener('click', closeMatchDetailsModal);
document.getElementById('matchDetailsModal').addEventListener('click', e => {
  if (e.target.id === 'matchDetailsModal') closeMatchDetailsModal();
});
