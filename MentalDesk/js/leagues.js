import { state } from './state.js';

export const LEAGUES = [
  { id: 'iron', name: 'Iron', min: 0, max: 499, icon: '🔩', color: '#8B94A3' },
  { id: 'bronze', name: 'Bronze', min: 500, max: 999, icon: '🥉', color: '#C97A3D' },
  { id: 'silver', name: 'Silver', min: 1000, max: 1499, icon: '🥈', color: '#C7CDD6' },
  { id: 'gold', name: 'Gold', min: 1500, max: 1999, icon: '🥇', color: '#F5C518' },
  { id: 'diamond', name: 'Diamond', min: 2000, max: 2499, icon: '💎', color: '#5DD9F5' },
  {
    id: 'hyper', name: 'Hyperleague', min: 2500, max: 3000, icon: '👑',
    gradient: 'linear-gradient(135deg,#FF5CD6,#F5A623,#5DD9F5)'
  },
];
export const TROPHY_CAP = 3000;

export function leagueForTrophies(t) {
  return LEAGUES.find(l => t >= l.min && t <= l.max) || LEAGUES[LEAGUES.length - 1];
}

export function trophyDelta(myTrophies, oppTrophies, won) {
  const diff = won ? (oppTrophies - myTrophies) : (myTrophies - oppTrophies);
  const adj = Math.max(-3, Math.min(3, Math.round(diff / 150)));
  return 30 + adj; // 27..33
}

export function leagueBadgeHtml(league) {
  const style = league.gradient
    ? `background:${league.gradient};color:#0B0E11;`
    : `background:${league.color};color:#0B0E11;`;
  return `<span class="league-badge" style="${style}">${league.icon} ${league.name}</span>`;
}

export function renderLeagueCard(badgeId, trophiesId, progressWrapId, progressFillId, rangeId, hyperWrapId) {
  const profile = state.profile;
  if (!profile) return;
  const trophies = profile.trophies || 0;
  const league = leagueForTrophies(trophies);
  document.getElementById(badgeId).innerHTML = leagueBadgeHtml(league);
  document.getElementById(trophiesId).textContent = trophies;
  const span = league.max - league.min;
  const pct = span > 0 ? Math.min(100, Math.round(((trophies - league.min) / span) * 100)) : 100;
  document.getElementById(progressFillId).style.width = pct + '%';
  document.getElementById(progressWrapId).classList.toggle('hyper', league.id === 'hyper');
  document.getElementById(rangeId).textContent = league.id === 'hyper'
    ? `${league.min} – ${TROPHY_CAP} (cap)`
    : `${league.min} – ${league.max}`;
  document.getElementById(hyperWrapId).style.display = (profile.peakTrophies || 0) >= 2500 ? 'block' : 'none';
}

export function openLeagueModal() {
  renderLeagueLadder();
  document.getElementById('leagueModal').classList.remove('hidden');
}
export function closeLeagueModal() {
  document.getElementById('leagueModal').classList.add('hidden');
}
export function renderLeagueLadder() {
  const ladder = document.getElementById('leagueLadder');
  ladder.innerHTML = '';
  const myTrophies = state.profile ? (state.profile.trophies || 0) : 0;
  const myLeague = leagueForTrophies(myTrophies);
  LEAGUES.forEach(l => {
    const tier = document.createElement('div');
    tier.className = 'league-tier' + (l.id === myLeague.id ? ' current' : '') + (l.id === 'hyper' ? ' hyper' : '');
    const rangeText = l.id === 'hyper' ? `${l.min}+ (cap ${TROPHY_CAP})` : `${l.min} – ${l.max}`;
    tier.innerHTML = `
      <div class="tier-icon">${l.icon}</div>
      <div class="tier-name">${l.name}</div>
      <div class="tier-range">${rangeText}</div>
      ${l.id === myLeague.id ? '<div class="tier-you">You are here</div>' : ''}
    `;
    ladder.appendChild(tier);
  });
}

document.getElementById('lobbyLeagueBadge').addEventListener('click', openLeagueModal);
document.getElementById('profileLeagueBadge').addEventListener('click', openLeagueModal);
document.getElementById('leagueModalClose').addEventListener('click', closeLeagueModal);
document.getElementById('leagueModal').addEventListener('click', e => {
  if (e.target.id === 'leagueModal') closeLeagueModal();
});
