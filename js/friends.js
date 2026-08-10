import { db, doc, getDoc, setDoc, deleteDoc, onSnapshot, collection, query, orderBy, startAt, endAt, limit, getDocs } from './firebase.js';
import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { leagueForTrophies } from './leagues.js';
import { isFriendOnline } from './presence.js';
import { joinFriendLobby, createFriendLobby, cancelFriendLobby } from './matchmaking.js';
import { isOwner, saveProfile } from './profile.js';
import { openAccountPromptModal } from './account-prompt.js';

/* ================= FRIENDS ================= */
export function startInboxListener() {
  if (state.inboxUnsub) state.inboxUnsub();
  state.inboxUnsub = onSnapshot(collection(db, 'users', state.currentUser.uid, 'inbox'), (snap) => {
    const requests = [];
    const challenges = [];
    snap.forEach(d => {
      const data = d.data();
      if (data.type === 'friend_request') {
        requests.push({ id: d.id, ...data });
      } else if (data.type === 'friend_challenge') {
        challenges.push({ id: d.id, ...data });
      } else if (data.type === 'friend_accept') {
        if (state.profile && !state.profile.friends.includes(data.byUid)) {
          state.profile.friends.push(data.byUid);
          saveProfile();
          renderFriendList();
        }
        deleteDoc(doc(db, 'users', state.currentUser.uid, 'inbox', d.id)).catch(() => {});
      } else if (data.type === 'challenge_declined') {
        if (state.lobbyState && state.lobbyState.code === data.code) {
          cancelFriendLobby();
          alert(`${data.byName || 'Your friend'} declined the challenge.`);
        }
        deleteDoc(doc(db, 'users', state.currentUser.uid, 'inbox', d.id)).catch(() => {});
      }
    });
    renderRequestList(requests);
    renderChallengeList(challenges);
  }, err => console.error('Inbox listener failed', err));
}

export function stopInboxListener() {
  if (state.inboxUnsub) { state.inboxUnsub(); state.inboxUnsub = null; }
}

function renderChallengeList(challenges) {
  const list = document.getElementById('challengeList');
  if (!list) return;
  list.innerHTML = '';
  if (challenges.length === 0) {
    list.innerHTML = '<div class="empty-note">No pending challenges.</div>';
    return;
  }
  challenges.forEach(c => {
    const row = document.createElement('div');
    row.className = 'friend-row';
    row.innerHTML = `
      <div class="favatar">${friendGlyph({ avatarPreset: c.fromAvatarPreset, photoURL: c.fromPhotoURL })}</div>
      <div class="finfo">
        <div class="fname">${escapeHtml(c.fromName || 'Anonymous')}</div>
        <div class="fmeta">Challenged you to a Desk Duel</div>
      </div>
      <button class="btn-small accept">Accept</button>
      <button class="btn-small decline">Decline</button>
    `;
    row.querySelector('.accept').addEventListener('click', () => acceptChallenge(c));
    row.querySelector('.decline').addEventListener('click', () => declineChallenge(c));
    list.appendChild(row);
  });
}

function acceptChallenge(c) {
  if (state.onlineState) {
    alert("Finish or forfeit your current match first.");
    return;
  }
  deleteDoc(doc(db, 'users', state.currentUser.uid, 'inbox', c.id)).catch(() => {});
  document.querySelector('nav.tabs button[data-view="online"]').click();
  joinFriendLobby(c.code);
}

function declineChallenge(c) {
  setDoc(doc(db, 'users', c.fromUid, 'inbox', state.currentUser.uid), {
    type: 'challenge_declined', byUid: state.currentUser.uid, byName: state.profile.username,
    code: c.code, createdAt: Date.now()
  }).catch(err => console.error('Failed to notify decline', err));
  deleteDoc(doc(db, 'users', state.currentUser.uid, 'inbox', c.id)).catch(() => {});
}

export function startFriendsRefresh() {
  stopFriendsRefresh();
  state.friendsRefreshInterval = setInterval(() => {
    if (state.currentUser && state.profile) renderFriendList();
  }, 30000);
}
export function stopFriendsRefresh() {
  if (state.friendsRefreshInterval) { clearInterval(state.friendsRefreshInterval); state.friendsRefreshInterval = null; }
}

export function renderFriendsGate() {
  const signedOut = document.getElementById('friendsSignedOut');
  const signedIn = document.getElementById('friendsSignedIn');
  if (!state.currentUser || !state.profile) {
    signedOut.style.display = 'block';
    signedIn.style.display = 'none';
    return;
  }
  signedOut.style.display = 'none';
  signedIn.style.display = 'block';
  renderFriendList();
  startFriendsRefresh();
}

function friendGlyph(data) {
  if (data.avatarPreset) return escapeHtml(data.avatarPreset);
  if (data.photoURL) return `<img src="${escapeHtml(data.photoURL)}" alt="" style="width:100%;height:100%;object-fit:cover;">`;
  return '👤';
}

document.getElementById('friendSearchBtn').addEventListener('click', doFriendSearch);
document.getElementById('friendSearchInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') doFriendSearch();
});

async function doFriendSearch() {
  const term = document.getElementById('friendSearchInput').value.trim().toLowerCase();
  const resultList = document.getElementById('friendResultList');
  resultList.innerHTML = '';
  if (!term) return;
  try {
    const q = query(collection(db, 'publicProfiles'),
      orderBy('usernameLower'), startAt(term), endAt(term + ''), limit(10));
    const snap = await getDocs(q);
    if (snap.empty) {
      resultList.innerHTML = '<div class="empty-note">No players found.</div>';
      return;
    }
    snap.forEach(d => {
      if (d.id === state.currentUser.uid) return;
      renderFriendResultRow(resultList, d.id, d.data());
    });
  } catch (err) {
    console.error('Friend search failed', err);
    resultList.innerHTML = '<div class="empty-note">Search failed — try again.</div>';
  }
}

function renderFriendResultRow(container, uid, data) {
  const row = document.createElement('div');
  row.className = 'friend-row';
  const league = leagueForTrophies(data.trophies || 0);
  const isFriend = (state.profile.friends || []).includes(uid);
  row.innerHTML = `
    <div class="favatar">${friendGlyph(data)}</div>
    <div class="finfo">
      <div class="fname">${escapeHtml(data.username || 'Anonymous')}${data.isOwner ? ' <span class="owner-badge">🛡️ Owner</span>' : ''}</div>
      <div class="fmeta">${league.icon} ${league.name} · ${data.trophies || 0} trophies</div>
    </div>
    ${isFriend ? '<span class="empty-note">Friends</span>' : '<button class="btn-small">Add</button>'}
  `;
  if (!isFriend) {
    row.querySelector('button').addEventListener('click', (e) => {
      sendFriendRequest(uid);
      e.target.textContent = 'Sent';
      e.target.disabled = true;
    });
  }
  container.appendChild(row);
}

export function sendFriendRequest(targetUid) {
  setDoc(doc(db, 'users', targetUid, 'inbox', state.currentUser.uid), {
    type: 'friend_request',
    fromUid: state.currentUser.uid,
    fromName: state.profile.username,
    fromAvatarPreset: state.profile.avatarPreset || null,
    fromPhotoURL: state.profile.photoURL || '',
    fromTrophies: state.profile.trophies || 0,
    fromIsOwner: isOwner(state.currentUser),
    createdAt: Date.now()
  }).catch(err => console.error('Send friend request failed', err));
}

function renderRequestList(requests) {
  const list = document.getElementById('requestList');
  list.innerHTML = '';
  if (requests.length === 0) {
    list.innerHTML = '<div class="empty-note">No pending requests.</div>';
    return;
  }
  requests.forEach(r => {
    const row = document.createElement('div');
    row.className = 'friend-row';
    row.innerHTML = `
      <div class="favatar">${friendGlyph({ avatarPreset: r.fromAvatarPreset, photoURL: r.fromPhotoURL })}</div>
      <div class="finfo">
        <div class="fname">${escapeHtml(r.fromName || 'Anonymous')}${r.fromIsOwner ? ' <span class="owner-badge">🛡️ Owner</span>' : ''}</div>
        <div class="fmeta">${r.fromTrophies || 0} trophies</div>
      </div>
      <button class="btn-small accept">Accept</button>
      <button class="btn-small decline">Decline</button>
    `;
    row.querySelector('.accept').addEventListener('click', () => acceptFriendRequest(r));
    row.querySelector('.decline').addEventListener('click', () => declineFriendRequest(r));
    list.appendChild(row);
  });
}

async function acceptFriendRequest(r) {
  if (!state.profile.friends.includes(r.fromUid)) {
    state.profile.friends.push(r.fromUid);
    saveProfile();
  }
  try {
    // Written before the original request is deleted below — the security rules
    // require that request to still exist as proof this accept is a real reciprocal action.
    await setDoc(doc(db, 'users', r.fromUid, 'inbox', state.currentUser.uid), {
      type: 'friend_accept', byUid: state.currentUser.uid, createdAt: Date.now()
    });
  } catch (err) {
    console.error('Accept notify failed', err);
  }
  deleteDoc(doc(db, 'users', state.currentUser.uid, 'inbox', r.id)).catch(() => {});
  renderFriendList();
}

function declineFriendRequest(r) {
  deleteDoc(doc(db, 'users', state.currentUser.uid, 'inbox', r.id)).catch(() => {});
}

export async function renderFriendList() {
  const list = document.getElementById('friendList');
  if (!list) return;
  list.innerHTML = '';
  const friends = state.profile.friends || [];
  if (friends.length === 0) {
    list.innerHTML = '<div class="empty-note">No friends yet — search for players above.</div>';
    return;
  }
  const rows = await Promise.all(friends.map(async uid => {
    try {
      const snap = await getDoc(doc(db, 'publicProfiles', uid));
      return snap.exists() ? { uid, data: snap.data() } : null;
    } catch (err) { return null; }
  }));
  const valid = rows.filter(Boolean).sort((a, b) => (b.data.trophies || 0) - (a.data.trophies || 0));
  if (valid.length === 0) {
    list.innerHTML = '<div class="empty-note">No friends yet — search for players above.</div>';
    return;
  }
  valid.forEach(({ uid, data }) => {
    const league = leagueForTrophies(data.trophies || 0);
    const online = isFriendOnline(data.lastActive);
    const row = document.createElement('div');
    row.className = 'friend-row';
    row.innerHTML = `
      <div class="favatar">${friendGlyph(data)}</div>
      <div class="finfo">
        <div class="fname">${escapeHtml(data.username || 'Anonymous')}${data.isOwner ? ' <span class="owner-badge">🛡️ Owner</span>' : ''}</div>
        <div class="fmeta">${league.icon} ${league.name} · ${data.trophies || 0} trophies${(data.peakTrophies || 0) >= 2500 ? ' · 👑' : ''}</div>
        <div class="fpresence"><span class="presence-dot ${online ? 'online' : ''}"></span>${online ? 'Online' : 'Offline'}</div>
      </div>
      <div class="factions">
        <button class="btn-small" data-challenge-uid="${uid}">⚔️ Challenge</button>
      </div>
    `;
    row.querySelector('[data-challenge-uid]').addEventListener('click', () =>
      sendFriendChallenge(uid, data.username || 'Anonymous'));
    list.appendChild(row);
  });
}

function sendFriendChallenge(uid, name) {
  if (state.onlineState) {
    alert("Finish or forfeit your current match before challenging someone else.");
    return;
  }
  if (state.lobbyState) {
    alert("You're already waiting on a private match — cancel it first from the Online tab.");
    return;
  }
  document.querySelector('nav.tabs button[data-view="online"]').click();
  createFriendLobby(uid, name);
}

document.getElementById('friendsSigninBtn').addEventListener('click', () => openAccountPromptModal('signin'));
