import { auth, signOut } from './firebase.js';
import { state } from './state.js';
import { changeUsername, changePassword, isPasswordAccount } from './profile.js';
import { openPrivacyModal } from './privacy.js';

/* ================= SETTINGS MODAL =================
   General | Privacy | Data controls | Security. Privacy's age/gender/email-optin fields and
   Data's owner-only mailing list export reuse the exact same input ids/wiring that already
   lived in profile.js before this modal existed — only their markup moved, not their JS.
*/
function switchSettingsTab(tab) {
  document.querySelectorAll('#settingsTabs .chip').forEach(c => c.classList.toggle('on', c.dataset.settingsTab === tab));
  document.getElementById('settingsTabGeneral').style.display = tab === 'general' ? 'block' : 'none';
  document.getElementById('settingsTabPrivacy').style.display = tab === 'privacy' ? 'block' : 'none';
  document.getElementById('settingsTabData').style.display = tab === 'data' ? 'block' : 'none';
  document.getElementById('settingsTabSecurity').style.display = tab === 'security' ? 'block' : 'none';
}

function resetUsernameFields() {
  document.getElementById('settingsUsernameInput').value = (state.profile && state.profile.username) || '';
  document.getElementById('settingsUsernameError').style.display = 'none';
  document.getElementById('settingsUsernameSuccess').style.display = 'none';
}

function renderSecurityTab() {
  const methodEl = document.getElementById('settingsSignInMethod');
  const pwSection = document.getElementById('settingsChangePasswordSection');
  if (isPasswordAccount()) {
    methodEl.textContent = 'Signed in with email & password.';
    pwSection.style.display = 'block';
  } else {
    methodEl.textContent = 'Signed in with Google — password changes are managed by your Google account.';
    pwSection.style.display = 'none';
  }
  document.getElementById('settingsCurrentPasswordInput').value = '';
  document.getElementById('settingsNewPasswordInput').value = '';
  document.getElementById('settingsPasswordError').style.display = 'none';
  document.getElementById('settingsPasswordSuccess').style.display = 'none';
}

export function openSettingsModal() {
  switchSettingsTab('general');
  resetUsernameFields();
  renderSecurityTab();
  document.getElementById('settingsModal').classList.remove('hidden');
}

export function closeSettingsModal() {
  document.getElementById('settingsModal').classList.add('hidden');
}

document.getElementById('settingsBtn').addEventListener('click', openSettingsModal);
document.getElementById('settingsModalClose').addEventListener('click', closeSettingsModal);
document.getElementById('settingsModal').addEventListener('click', e => {
  if (e.target.id === 'settingsModal') closeSettingsModal();
});

document.querySelectorAll('#settingsTabs .chip').forEach(chip => {
  chip.addEventListener('click', () => switchSettingsTab(chip.dataset.settingsTab));
});

document.getElementById('settingsPrivacyPolicyLink').addEventListener('click', () => {
  closeSettingsModal();
  openPrivacyModal();
});

/* ---- General: username ---- */
document.getElementById('settingsUsernameSaveBtn').addEventListener('click', async () => {
  const input = document.getElementById('settingsUsernameInput');
  const errEl = document.getElementById('settingsUsernameError');
  const successEl = document.getElementById('settingsUsernameSuccess');
  const newUsername = input.value.trim();
  errEl.style.display = 'none';
  successEl.style.display = 'none';
  if (!newUsername) return;
  try {
    await changeUsername(newUsername);
    successEl.textContent = 'Username updated.';
    successEl.style.display = 'block';
  } catch (err) {
    errEl.textContent = err.message === 'TAKEN' ? 'That username is already taken.'
      : err.message === 'INVALID_FORMAT' ? 'Username must be 3–20 characters: letters, numbers, and underscores only.'
      : 'Something went wrong — try again.';
    errEl.style.display = 'block';
  }
});

/* ---- Data controls: self-serve export ---- */
document.getElementById('downloadMyDataBtn').addEventListener('click', () => {
  if (!state.currentUser || !state.profile) return;
  const data = { uid: state.currentUser.uid, ...state.profile };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mental-desk-my-data-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

/* ---- Security: change password ---- */
function friendlyPasswordError(err) {
  const code = err && err.code;
  if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') return 'Current password is incorrect.';
  if (code === 'auth/weak-password') return 'New password should be at least 6 characters.';
  if (code === 'auth/too-many-requests') return 'Too many attempts — try again in a moment.';
  return (err && err.message) ? err.message : 'Something went wrong — try again.';
}

document.getElementById('settingsChangePasswordBtn').addEventListener('click', async () => {
  const current = document.getElementById('settingsCurrentPasswordInput').value;
  const next = document.getElementById('settingsNewPasswordInput').value;
  const errEl = document.getElementById('settingsPasswordError');
  const successEl = document.getElementById('settingsPasswordSuccess');
  errEl.style.display = 'none';
  successEl.style.display = 'none';
  if (!current || !next) {
    errEl.textContent = 'Enter your current and new password.';
    errEl.style.display = 'block';
    return;
  }
  if (next.length < 6) {
    errEl.textContent = 'New password should be at least 6 characters.';
    errEl.style.display = 'block';
    return;
  }
  try {
    await changePassword(current, next);
    document.getElementById('settingsCurrentPasswordInput').value = '';
    document.getElementById('settingsNewPasswordInput').value = '';
    successEl.textContent = 'Password updated.';
    successEl.style.display = 'block';
  } catch (err) {
    errEl.textContent = friendlyPasswordError(err);
    errEl.style.display = 'block';
  }
});

document.getElementById('settingsSignOutBtn').addEventListener('click', () => {
  closeSettingsModal();
  signOut(auth);
});
