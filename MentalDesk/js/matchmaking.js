import { db, doc, getDoc, setDoc, deleteDoc, onSnapshot, collection, query, where, limit, getDocs, runTransaction } from './firebase.js';
import { state } from './state.js';
import { randInt } from './utils.js';
import { renderLeagueCard } from './leagues.js';
import { renderBattleLog } from './battle-log.js';
import { enterMatch, startBotMatch } from './match.js';
import { doSignIn } from './profile.js';

/* ================= ONLINE: GATE / PANELS ================= */
export function renderOnlineGate() {
  const signedOut = document.getElementById('onlineSignedOut');
  if (!state.currentUser || !state.profile) {
    signedOut.style.display = 'block';
    ['onlineLobby', 'onlineQueue', 'onlineFriendWait', 'onlineMatch', 'onlineResult'].forEach(id => {
      document.getElementById(id).style.display = 'none';
    });
    return;
  }
  signedOut.style.display = 'none';
  showOnlinePanel('lobby');
}

export function showOnlinePanel(name) {
  const panels = { lobby: 'onlineLobby', queue: 'onlineQueue', friendWait: 'onlineFriendWait', match: 'onlineMatch', result: 'onlineResult' };
  Object.entries(panels).forEach(([k, id]) => {
    document.getElementById(id).style.display = (k === name) ? 'block' : 'none';
  });
  if (name === 'lobby') renderLobby();
}

export function renderLobby() {
  if (!state.profile) return;
  renderLeagueCard('lobbyLeagueBadge', 'lobbyTrophies', 'lobbyProgressWrap', 'lobbyProgressFill', 'lobbyRange', 'hyperEliteWrap');
  renderBattleLog();
}

/* ================= ONLINE: MATCHMAKING ================= */
export function engagementSearchCenter() {
  const profile = state.profile;
  let center = profile.trophies || 0;
  if ((profile.onlineLossStreak || 0) >= 2) center -= Math.min(150, profile.onlineLossStreak * 40);
  if ((profile.onlineWinStreak || 0) >= 3) center += Math.min(150, profile.onlineWinStreak * 30);
  return Math.max(0, center);
}

export async function startMatchmaking() {
  showOnlinePanel('queue');
  document.getElementById('queueStatusText').textContent = 'Looking for someone around your trophy count…';
  const center = engagementSearchCenter();
  state.mmState = { range: 100, center, cancelled: false };

  try {
    await setDoc(doc(db, 'matchQueue', state.currentUser.uid), {
      uid: state.currentUser.uid, trophies: state.profile.trophies || 0, searchCenter: center,
      displayName: state.profile.displayName, avatarPreset: state.profile.avatarPreset || null,
      photoURL: state.profile.photoURL || '', queuedAt: Date.now(), status: 'waiting'
    });
  } catch (err) {
    console.error('Failed to join matchmaking queue', err);
  }

  state.mmState.ownUnsub = onSnapshot(doc(db, 'matchQueue', state.currentUser.uid), (snap) => {
    if (!state.mmState || state.mmState.cancelled) return;
    const data = snap.data();
    if (data && data.status === 'matched' && data.matchId) {
      enterMatch(data.matchId);
    }
  });

  searchForCandidates();
  state.mmState.widenTimer = setInterval(() => {
    if (!state.mmState || state.mmState.cancelled) return;
    state.mmState.range = Math.min(500, state.mmState.range + 100);
    searchForCandidates();
  }, 3000);
  state.mmState.botTimer = setTimeout(() => {
    if (!state.mmState || state.mmState.cancelled) return;
    startBotMatch();
  }, 7000);
}

async function searchForCandidates() {
  const mmState = state.mmState;
  if (!mmState || mmState.cancelled) return;
  try {
    const q = query(collection(db, 'matchQueue'),
      where('status', '==', 'waiting'),
      where('trophies', '>=', mmState.center - mmState.range),
      where('trophies', '<=', mmState.center + mmState.range),
      limit(8));
    const snap = await getDocs(q);
    const candidates = [];
    snap.forEach(d => { if (d.id !== state.currentUser.uid) candidates.push(d); });
    for (const candidate of candidates) {
      if (!state.mmState || state.mmState.cancelled) return;
      const claimed = await tryClaimMatch(candidate.id);
      if (claimed) return;
    }
  } catch (err) {
    console.error('Matchmaking search failed (if this is a "requires an index" error, click the console link to create it, then retry)', err);
  }
}

async function tryClaimMatch(opponentUid) {
  if (!state.mmState || state.mmState.cancelled) return false;
  const matchId = `${[state.currentUser.uid, opponentUid].sort().join('_')}_${Date.now()}`;
  try {
    await runTransaction(db, async (tx) => {
      const oppRef = doc(db, 'matchQueue', opponentUid);
      const oppSnap = await tx.get(oppRef);
      if (!oppSnap.exists() || oppSnap.data().status !== 'waiting') {
        throw new Error('opponent no longer waiting');
      }
      const oppData = oppSnap.data();
      tx.update(oppRef, { status: 'matched', matchId });
      tx.set(doc(db, 'matches', matchId), {
        playerIds: [state.currentUser.uid, opponentUid],
        playerNames: { [state.currentUser.uid]: state.profile.displayName, [opponentUid]: oppData.displayName || 'Opponent' },
        playerTrophies: { [state.currentUser.uid]: state.profile.trophies || 0, [opponentUid]: oppData.trophies || 0 },
        mode: 'ranked',
        startedAt: Date.now(),
        status: 'active'
      });
    });
  } catch (err) {
    return false; // someone else claimed it first — try the next candidate
  }
  await deleteDoc(doc(db, 'matchQueue', state.currentUser.uid)).catch(() => {});
  const claimedMatchId = matchId;
  stopMatchmakingListeners();
  enterMatch(claimedMatchId);
  return true;
}

export function stopMatchmakingListeners() {
  if (state.mmState) {
    state.mmState.cancelled = true;
    if (state.mmState.widenTimer) clearInterval(state.mmState.widenTimer);
    if (state.mmState.botTimer) clearTimeout(state.mmState.botTimer);
    if (state.mmState.ownUnsub) state.mmState.ownUnsub();
  }
  state.mmState = null;
}

export function cancelMatchmaking() {
  stopMatchmakingListeners();
  if (state.currentUser) deleteDoc(doc(db, 'matchQueue', state.currentUser.uid)).catch(() => {});
  showOnlinePanel('lobby');
}

document.getElementById('findMatchBtn').addEventListener('click', startMatchmaking);
document.getElementById('cancelQueueBtn').addEventListener('click', cancelMatchmaking);
document.getElementById('rematchBtn').addEventListener('click', startMatchmaking);
document.getElementById('onlineDoneBtn').addEventListener('click', () => showOnlinePanel('lobby'));

/* ================= ONLINE: FRIEND LOBBY (unranked, invite code) ================= */
const LOBBY_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I/L — avoids misreads

function generateLobbyCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += LOBBY_CODE_CHARS[randInt(0, LOBBY_CODE_CHARS.length - 1)];
  return code;
}

export async function createFriendLobby(challengeTargetUid, challengeTargetName) {
  let code, ref, snap;
  for (let attempt = 0; attempt < 5; attempt++) {
    code = generateLobbyCode();
    ref = doc(db, 'lobbies', code);
    snap = await getDoc(ref);
    if (!snap.exists()) break;
  }
  try {
    await setDoc(ref, {
      code, hostUid: state.currentUser.uid, hostName: state.profile.displayName,
      hostAvatarPreset: state.profile.avatarPreset || null, hostPhotoURL: state.profile.photoURL || '',
      hostTrophies: state.profile.trophies || 0,
      guestUid: null, status: 'waiting', matchId: null, createdAt: Date.now()
    });
  } catch (err) {
    console.error('Failed to create private match', err);
    alert('Could not create a private match — try again.');
    return;
  }

  if (challengeTargetUid) {
    setDoc(doc(db, 'users', challengeTargetUid, 'inbox', state.currentUser.uid), {
      type: 'friend_challenge',
      fromUid: state.currentUser.uid, fromName: state.profile.displayName,
      fromAvatarPreset: state.profile.avatarPreset || null, fromPhotoURL: state.profile.photoURL || '',
      fromTrophies: state.profile.trophies || 0,
      code, createdAt: Date.now()
    }).catch(err => console.error('Failed to send challenge notification', err));
  }

  state.lobbyState = { code, unsub: null, challengeTargetUid: challengeTargetUid || null };
  document.getElementById('lobbyCodeDisplay').textContent = code;
  document.getElementById('friendWaitTitle').textContent =
    challengeTargetName ? `Waiting for ${challengeTargetName}` : 'Waiting for your friend';
  document.getElementById('friendWaitSub').textContent = challengeTargetName
    ? `${challengeTargetName} has been notified — or share the code/link below too:`
    : 'Share this code, or send them a link that joins automatically:';
  showOnlinePanel('friendWait');

  state.lobbyState.unsub = onSnapshot(ref, (s) => {
    const data = s.data();
    if (data && data.status === 'matched' && data.matchId) {
      if (state.lobbyState && state.lobbyState.unsub) state.lobbyState.unsub();
      state.lobbyState = null;
      enterMatch(data.matchId);
    }
  });
}

export async function joinFriendLobby(rawCode) {
  const code = (rawCode || '').trim().toUpperCase();
  if (!code) return;
  const ref = doc(db, 'lobbies', code);
  const matchId = `friendly_${code}_${Date.now()}`;
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('That invite code was not found.');
      const data = snap.data();
      if (data.status !== 'waiting') throw new Error('That invite is no longer available.');
      if (data.hostUid === state.currentUser.uid) throw new Error("You can't join your own private match.");
      tx.update(ref, { status: 'matched', guestUid: state.currentUser.uid, matchId });
      tx.set(doc(db, 'matches', matchId), {
        playerIds: [data.hostUid, state.currentUser.uid],
        playerNames: { [data.hostUid]: data.hostName, [state.currentUser.uid]: state.profile.displayName },
        playerTrophies: { [data.hostUid]: data.hostTrophies || 0, [state.currentUser.uid]: state.profile.trophies || 0 },
        mode: 'friendly',
        startedAt: Date.now(),
        status: 'active'
      });
    });
  } catch (err) {
    alert(err.message || 'Could not join that private match.');
    return;
  }
  enterMatch(matchId);
}

export function cancelFriendLobby() {
  if (state.lobbyState) {
    if (state.lobbyState.unsub) state.lobbyState.unsub();
    deleteDoc(doc(db, 'lobbies', state.lobbyState.code)).catch(() => {});
  }
  state.lobbyState = null;
  showOnlinePanel('lobby');
}

document.getElementById('createLobbyBtn').addEventListener('click', () => createFriendLobby());
document.getElementById('joinLobbyBtn').addEventListener('click', () =>
  joinFriendLobby(document.getElementById('joinCodeInput').value));
document.getElementById('joinCodeInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') joinFriendLobby(e.target.value);
});
document.getElementById('cancelLobbyBtn').addEventListener('click', cancelFriendLobby);

export function lobbyInviteLink(code) {
  return `${window.location.origin}${window.location.pathname}?join=${code}`;
}
document.getElementById('copyLobbyLinkBtn').addEventListener('click', async () => {
  if (!state.lobbyState) return;
  const link = lobbyInviteLink(state.lobbyState.code);
  const name = (state.profile && state.profile.displayName) || 'Someone';
  const message = `${name} has challenged you to a Desk Duel! ${link}`;
  const btn = document.getElementById('copyLobbyLinkBtn');
  const original = btn.textContent;
  try {
    await navigator.clipboard.writeText(message);
    btn.textContent = 'Copied!';
  } catch (err) {
    console.error('Clipboard copy failed', err);
    window.prompt('Copy this message:', message);
    btn.textContent = original;
    return;
  }
  setTimeout(() => { btn.textContent = original; }, 1500);
});

document.getElementById('onlineSigninBtn').addEventListener('click', doSignIn);
