import { db, doc, getDoc, setDoc, getDocs, collection, auth, GoogleAuthProvider, signInWithPopup, signOut,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile as updateAuthProfile } from './firebase.js';
import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { setTick } from './shell.js';
import { leagueForTrophies, renderLeagueCard } from './leagues.js';
import { startInboxListener } from './friends.js';
import { startPresenceHeartbeat } from './presence.js';
import { renderOnlineGate } from './matchmaking.js';
import { renderFriendsGate } from './friends.js';
import { runOnboardingFlow } from './privacy.js';
import { openAccountPromptModal } from './account-prompt.js';

export const AVATAR_PRESETS = ['🦉', '🐺', '🦊', '🐢', '🦅', '🐯', '🐬', '🦁'];

export const ACHIEVEMENTS = [
  { id: 'first_session', icon: '🎯', label: 'First session', category: 'offline', check: p => p.totalSessions >= 1 },
  { id: 'correct_100', icon: '🥉', label: '100 correct', category: 'offline', check: p => p.totalCorrect >= 100 },
  { id: 'correct_1000', icon: '🥈', label: '1,000 correct', category: 'offline', check: p => p.totalCorrect >= 1000 },
  { id: 'correct_5000', icon: '🥇', label: '5,000 correct', category: 'offline', check: p => p.totalCorrect >= 5000 },
  { id: 'streak_20', icon: '🔥', label: '20-streak', category: 'offline', check: p => p.bestStreakEver >= 20 },
  { id: 'streak_50', icon: '⚡', label: '50-streak', category: 'offline', check: p => p.bestStreakEver >= 50 },
  { id: 'online_first_win', icon: '🏁', label: 'First win', category: 'online', check: p => (p.onlineWins || 0) >= 1 },
  { id: 'online_wins_10', icon: '🗡️', label: '10 wins', category: 'online', check: p => (p.onlineWins || 0) >= 10 },
  { id: 'online_wins_50', icon: '⚔️', label: '50 wins', category: 'online', check: p => (p.onlineWins || 0) >= 50 },
  { id: 'comeback', icon: '🔁', label: 'Comeback', category: 'online', check: p => p._justComeback === true },
  { id: 'hyper_elite', icon: '👑', label: 'Hyperleague Elite', category: 'online', check: p => (p.peakTrophies || 0) >= 2500 },
];

export function defaultProfile(user) {
  return {
    username: null,
    email: user.email || '',
    photoURL: user.photoURL || '',
    avatarPreset: null,
    iqScore: 100,
    totalCorrect: 0,
    totalWrong: 0,
    totalSessions: 0,
    bestSession: null,
    bestStreakEver: 0,
    banners: [],
    age: null,
    gender: null,
    emailOptIn: false,
    trophies: 0,
    peakTrophies: 0,
    onlineWinStreak: 0,
    onlineLossStreak: 0,
    onlineWins: 0,
    onlineLosses: 0,
    onlineDraws: 0,
    friends: [],
    hasSeenTutorial: false,
    hasAcceptedPrivacyPolicy: false,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

/* ================= OWNER TAG =================
   TODO: set this to the exact Google account email you sign into Mental Desk with.
*/
export const OWNER_EMAIL = 'sebgreen1906@gmail.com';
export function isOwner(user) {
  return !!user && !!user.email && user.email === OWNER_EMAIL;
}

function profileRef() {
  return doc(db, 'users', state.currentUser.uid);
}

/* ================= USERNAME (unique, replaces the old free-text displayName) =================
   Claiming is done via an atomic Firestore "create-only" security rule on usernames/{name} —
   setDoc() throws a permission-denied error if that doc already exists (Firestore classifies it
   as an update, which the rules don't grant), so there's no read-then-write race to worry about.
*/
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;
export function isValidUsername(str) {
  return USERNAME_REGEX.test(str);
}

function sanitizeUsernameBase(raw) {
  const stripped = (raw || '').replace(/[^a-zA-Z0-9_]/g, '');
  return stripped.slice(0, 20) || 'Player';
}

async function claimUsername(candidate, uid) {
  try {
    await setDoc(doc(db, 'usernames', candidate.toLowerCase()), { uid, createdAt: Date.now() });
    return true;
  } catch (err) {
    return false; // already claimed by someone else
  }
}

async function resolveUsername(preferred, uid) {
  const base = sanitizeUsernameBase(preferred);
  if (await claimUsername(base, uid)) return base;
  for (let i = 2; i <= 50; i++) {
    const candidate = `${base}${i}`.slice(0, 20);
    if (await claimUsername(candidate, uid)) return candidate;
  }
  const fallback = `${base}${Date.now().toString().slice(-6)}`.slice(0, 20);
  await claimUsername(fallback, uid);
  return fallback;
}

export async function loadProfile() {
  const ref = profileRef();
  const snap = await getDoc(ref);
  if (snap.exists()) {
    state.profile = snap.data();
    const profile = state.profile;
    profile.trophies = profile.trophies || 0;
    profile.peakTrophies = profile.peakTrophies || 0;
    profile.onlineWinStreak = profile.onlineWinStreak || 0;
    profile.onlineLossStreak = profile.onlineLossStreak || 0;
    profile.onlineWins = profile.onlineWins || 0;
    profile.onlineLosses = profile.onlineLosses || 0;
    profile.onlineDraws = profile.onlineDraws || 0;
    profile.friends = profile.friends || [];
    profile.emailOptIn = profile.emailOptIn || false;
  } else {
    state.profile = defaultProfile(state.currentUser);
    await setDoc(ref, state.profile);
  }

  // Carries progress a guest made (privacy acceptance, tutorial completion, pending email
  // opt-in) into their profile the moment they sign in — otherwise these all default back
  // to false/unset on a brand-new profile and the whole onboarding sequence re-triggers.
  let migrated = false;

  // Every profile needs a unique username — brand-new profiles never had one, and profiles
  // created before this feature existed need one backfilled too. Email signups pass their
  // chosen name via state.pendingSignupUsername; everything else (Google, legacy accounts)
  // falls back to whatever name is already on hand, auto-suffixed if it's taken.
  if (!state.profile.username) {
    const preferred = state.pendingSignupUsername || state.currentUser.displayName || 'Player';
    state.profile.username = await resolveUsername(preferred, state.currentUser.uid);
    updateAuthProfile(state.currentUser, { displayName: state.profile.username }).catch(() => {});
    migrated = true;
  }
  state.pendingSignupUsername = null;

  const pendingOptIn = localStorage.getItem('md_pending_email_optin');
  if (pendingOptIn !== null) {
    state.profile.emailOptIn = pendingOptIn === '1';
    localStorage.removeItem('md_pending_email_optin');
    migrated = true;
  }
  if (!state.profile.hasAcceptedPrivacyPolicy && localStorage.getItem('md_privacy_accepted') === '1') {
    state.profile.hasAcceptedPrivacyPolicy = true;
    migrated = true;
  }
  if (!state.profile.hasSeenTutorial && localStorage.getItem('md_tutorial_seen') === '1') {
    state.profile.hasSeenTutorial = true;
    migrated = true;
  }
  if (state.pendingSignupAge != null) {
    state.profile.age = state.pendingSignupAge;
    state.pendingSignupAge = null;
    migrated = true;
  }
  if (migrated) saveProfile();

  applyProfileToTicker();
  renderProfile();
  syncPublicProfile();
  startInboxListener();
  startPresenceHeartbeat();
  renderOnlineGate();
  renderFriendsGate();
  runOnboardingFlow();
}

export function saveProfile() {
  if (!state.currentUser || !state.profile) return;
  state.profile.updatedAt = Date.now();
  setDoc(profileRef(), state.profile, { merge: true }).catch(err => console.error('Save failed', err));
  syncPublicProfile();
}

export function syncPublicProfile() {
  if (!state.currentUser || !state.profile) return;
  const profile = state.profile;
  const pub = {
    username: profile.username,
    usernameLower: (profile.username || '').toLowerCase(),
    avatarPreset: profile.avatarPreset || null,
    photoURL: profile.photoURL || '',
    trophies: profile.trophies || 0,
    peakTrophies: profile.peakTrophies || 0,
    isOwner: isOwner(state.currentUser),
    updatedAt: Date.now()
  };
  setDoc(doc(db, 'publicProfiles', state.currentUser.uid), pub, { merge: true })
    .catch(err => console.error('Public profile sync failed', err));
}

export function applyProfileToTicker() {
  const profile = state.profile;
  if (!profile) return;
  state.sessionsRun = profile.totalSessions;
  state.bestStreakEver = profile.bestStreakEver;
  setTick('SESSIONS RUN', state.sessionsRun);
  setTick('BEST STREAK', state.bestStreakEver);
  setTick('TROPHIES', profile.trophies || 0);
}

export function renderAvatarInto(el) {
  const profile = state.profile;
  el.innerHTML = '';
  if (profile && profile.avatarPreset) {
    el.textContent = profile.avatarPreset;
  } else if (profile && profile.photoURL) {
    const img = document.createElement('img');
    img.src = profile.photoURL;
    img.alt = 'avatar';
    img.style.width = '100%'; img.style.height = '100%'; img.style.objectFit = 'cover';
    el.appendChild(img);
  } else {
    el.textContent = '👤';
  }
}

export function renderAuthHeader() {
  const signinBtn = document.getElementById('signinBtn');
  const userChip = document.getElementById('userChip');
  const signoutBtn = document.getElementById('signoutBtn');
  if (state.currentUser) {
    signinBtn.style.display = 'none';
    userChip.style.display = 'flex';
    signoutBtn.style.display = 'inline-block';
    document.getElementById('userChipName').textContent =
      ((state.profile && state.profile.username) || state.currentUser.displayName || 'You') + (isOwner(state.currentUser) ? ' 🛡️' : '');
    renderAvatarInto(document.getElementById('userChipAvatar'));
  } else {
    signinBtn.style.display = 'flex';
    userChip.style.display = 'none';
    signoutBtn.style.display = 'none';
  }
}

export function renderProfile() {
  const signedOutPanel = document.getElementById('profileSignedOut');
  const signedInPanel = document.getElementById('profileSignedIn');
  const profile = state.profile;
  if (!state.currentUser || !profile) {
    signedOutPanel.style.display = 'block';
    signedInPanel.style.display = 'none';
    renderAuthHeader();
    return;
  }
  signedOutPanel.style.display = 'none';
  signedInPanel.style.display = 'block';

  document.getElementById('profileName').innerHTML =
    escapeHtml(profile.username) + (isOwner(state.currentUser) ? ' <span class="owner-badge">🛡️ Owner</span>' : '');
  document.getElementById('profileEmail').textContent = profile.email;
  document.getElementById('profileIq').textContent = profile.iqScore;
  renderAvatarInto(document.getElementById('profileAvatar'));

  document.getElementById('profTotalCorrect').textContent = profile.totalCorrect;
  document.getElementById('profTotalSessions').textContent = profile.totalSessions;
  document.getElementById('profBestStreak').textContent = profile.bestStreakEver;
  document.getElementById('profBestAcc').textContent = (profile.bestSession ? profile.bestSession.accuracy : 0) + '%';

  const onlineWins = profile.onlineWins || 0, onlineLosses = profile.onlineLosses || 0, onlineDraws = profile.onlineDraws || 0;
  const onlineTotal = onlineWins + onlineLosses + onlineDraws;
  document.getElementById('profOnlineWins').textContent = onlineWins;
  document.getElementById('profOnlineLosses').textContent = onlineLosses;
  document.getElementById('profOnlineDraws').textContent = onlineDraws;
  document.getElementById('profOnlineWinRate').textContent = (onlineTotal ? Math.round(onlineWins / onlineTotal * 100) : 0) + '%';

  renderBannerRow('bannerRowOffline', 'offline');
  renderBannerRow('bannerRowOnline', 'online');

  document.getElementById('ageInput').value = profile.age || '';
  document.getElementById('genderInput').value = profile.gender || '';
  document.getElementById('emailOptInInput').checked = !!profile.emailOptIn;

  document.getElementById('adminPanel').style.display = isOwner(state.currentUser) ? 'block' : 'none';

  renderLeagueCard('profileLeagueBadge', 'profileTrophies', 'profileProgressWrap', 'profileProgressFill', 'profileRange', 'profileHyperEliteWrap');

  renderAuthHeader();
}

export function renderBannerRow(elId, category) {
  const row = document.getElementById(elId);
  row.innerHTML = '';
  const earned = new Set(state.profile.banners || []);
  const inCategory = ACHIEVEMENTS.filter(a => a.category === category);
  const unlocked = inCategory.filter(a => earned.has(a.id));
  if (unlocked.length === 0) {
    row.innerHTML = '<span class="no-banners">No banners yet — keep practicing to unlock some.</span>';
  } else {
    unlocked.forEach(a => {
      const chip = document.createElement('div');
      chip.className = 'banner-chip';
      chip.innerHTML = `<span class="ic">${a.icon}</span>${a.label}`;
      row.appendChild(chip);
    });
  }
}

export function renderAvatarPicker() {
  const picker = document.getElementById('avatarPicker');
  picker.innerHTML = '';
  AVATAR_PRESETS.forEach(glyph => {
    const opt = document.createElement('div');
    opt.className = 'avatar-option' + (state.profile && state.profile.avatarPreset === glyph ? ' selected' : '');
    opt.textContent = glyph;
    opt.addEventListener('click', () => {
      state.profile.avatarPreset = glyph;
      renderAvatarPicker();
      renderProfile();
      saveProfile();
    });
    picker.appendChild(opt);
  });
}

export function syncSessionToProfile(result) {
  const profile = state.profile;
  profile.totalCorrect += result.score;
  profile.totalWrong += result.wrong;
  profile.totalSessions += 1;
  profile.bestStreakEver = Math.max(profile.bestStreakEver, result.bestStreak);

  const total = result.score + result.wrong;
  if (total >= 5) {
    const delta = Math.round((result.acc - 75) / 5);
    profile.iqScore = Math.max(50, Math.min(200, profile.iqScore + delta));
  }

  if (!profile.bestSession || result.score > profile.bestSession.score) {
    profile.bestSession = {
      score: result.score, accuracy: result.acc,
      avgTime: Number(result.avg.toFixed(1)), bestStreak: result.bestStreak, at: Date.now()
    };
  }

  ACHIEVEMENTS.forEach(a => {
    if (a.check(profile) && !profile.banners.includes(a.id)) {
      profile.banners.push(a.id);
    }
  });

  applyProfileToTicker();
  renderProfile();
  saveProfile();
}

export function doSignIn() {
  signInWithPopup(auth, new GoogleAuthProvider()).catch(err => {
    console.error('Sign-in failed', err);
    alert('Sign-in failed: ' + err.message);
  });
}

export async function createAccountWithEmail(email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function signInWithEmail(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

document.getElementById('avatarPickerToggle').addEventListener('click', () => {
  const picker = document.getElementById('avatarPicker');
  if (!picker.classList.contains('show')) renderAvatarPicker();
  picker.classList.toggle('show');
});

document.getElementById('userChip').addEventListener('click', () => {
  document.querySelector('nav.tabs button[data-view="profile"]').click();
});

document.getElementById('signinBtn').addEventListener('click', () => openAccountPromptModal('signin'));
document.getElementById('profileSigninBtn').addEventListener('click', () => openAccountPromptModal('signin'));
document.getElementById('signoutBtn').addEventListener('click', () => signOut(auth));

document.getElementById('ageInput').addEventListener('change', e => {
  if (!state.profile) return;
  const v = parseInt(e.target.value, 10);
  state.profile.age = Number.isFinite(v) ? v : null;
  saveProfile();
});
document.getElementById('genderInput').addEventListener('change', e => {
  if (!state.profile) return;
  state.profile.gender = e.target.value || null;
  saveProfile();
});
document.getElementById('emailOptInInput').addEventListener('change', e => {
  if (!state.profile) return;
  state.profile.emailOptIn = e.target.checked;
  saveProfile();
});

document.querySelectorAll('#statsModeToggle .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#statsModeToggle .chip').forEach(c => c.classList.remove('on'));
    chip.classList.add('on');
    const mode = chip.dataset.mode;
    document.getElementById('offlineStatsGrid').style.display = mode === 'offline' ? 'grid' : 'none';
    document.getElementById('onlineStatsGrid').style.display = mode === 'online' ? 'grid' : 'none';
  });
});

/* ================= OWNER: MAILING LIST EXPORT ================= */
function csvEscape(val) {
  const s = String(val ?? '');
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function exportMailingListCsv() {
  if (!isOwner(state.currentUser)) return;
  let snap;
  try {
    snap = await getDocs(collection(db, 'users'));
  } catch (err) {
    console.error('Mailing list export failed', err);
    alert('Export failed — check console for details (you may need to update Firestore rules to grant the owner read access to the users collection).');
    return;
  }

  const header = ['Email', 'Age', 'Gender', 'IQ Score', 'Trophies', 'League', 'Total Sessions', 'Online Wins', 'Online Losses', 'Best Streak Ever'];
  const rows = [header];
  snap.forEach(d => {
    const u = d.data();
    if (!u.emailOptIn) return;
    const league = leagueForTrophies(u.trophies || 0);
    rows.push([
      u.email || '', u.age ?? '', u.gender || '', u.iqScore ?? '',
      u.trophies ?? 0, league.name, u.totalSessions ?? 0,
      u.onlineWins ?? 0, u.onlineLosses ?? 0, u.bestStreakEver ?? 0
    ]);
  });

  if (rows.length === 1) {
    alert('No users have opted in to emails yet.');
    return;
  }

  const csv = rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mental-desk-mailing-list-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
document.getElementById('exportMailingListBtn').addEventListener('click', exportMailingListCsv);
