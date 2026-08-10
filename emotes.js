import { db, doc, updateDoc } from './firebase.js';
import { state } from './state.js';
import { randInt } from './utils.js';

/* ================= ONLINE: EMOTES ================= */
export const EMOTES = {
  well_played: 'Well Played',
  nerd: '🤓',
  thinking: '🤔',
  good_luck: 'Good Luck'
};
export const EMOTE_COOLDOWN_MS = 3000;

export function showEmoteBubble(elId, emoteId) {
  const label = EMOTES[emoteId];
  if (!label) return;
  const el = document.getElementById(elId);
  el.textContent = label;
  el.classList.remove('hidden');
  el.classList.add('show');
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

export function sendEmote(emoteId) {
  const onlineState = state.onlineState;
  if (!onlineState || !EMOTES[emoteId]) return;
  const now = Date.now();
  if (now - state.lastEmoteSentAt < EMOTE_COOLDOWN_MS) return;
  state.lastEmoteSentAt = now;

  document.getElementById('emoteTray').classList.add('hidden');
  showEmoteBubble('myEmoteBubble', emoteId);

  const btn = document.getElementById('emoteBtn');
  btn.disabled = true;
  setTimeout(() => { btn.disabled = false; }, EMOTE_COOLDOWN_MS);

  if (onlineState.isBot) {
    setTimeout(() => {
      if (!state.onlineState || !state.onlineState.isBot) return;
      const ids = Object.keys(EMOTES);
      showEmoteBubble('oppEmoteBubble', ids[randInt(0, ids.length - 1)]);
    }, 900 + randInt(0, 700));
  } else {
    updateDoc(doc(db, 'matches', onlineState.matchId, 'players', state.currentUser.uid), {
      emote: emoteId, emoteAt: now
    }).catch(err => console.error('Failed to send emote', err));
  }
}

document.getElementById('emoteBtn').addEventListener('click', () => {
  document.getElementById('emoteTray').classList.toggle('hidden');
});
document.querySelectorAll('.emote-option').forEach(btn => {
  btn.addEventListener('click', () => sendEmote(btn.dataset.emote));
});
