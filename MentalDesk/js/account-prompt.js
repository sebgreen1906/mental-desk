import { state } from './state.js';
import { doSignIn, createAccountWithEmail, signInWithEmail } from './profile.js';
import { runOnboardingFlow } from './privacy.js';

/* ================= ACCOUNT PROMPT (post-privacy, pre-tutorial) =================
   Optional step: create an email/password account, sign in with Google, or skip and
   continue as a guest. Only shown to signed-out users, and only once per browser
   (tracked via localStorage) unless they end up signing in some other way first.
*/
const ACCOUNT_PROMPT_KEY = 'md_account_prompt_seen';

export function hasSeenAccountPrompt() {
  return !!localStorage.getItem(ACCOUNT_PROMPT_KEY);
}

function showCreateMode() {
  document.getElementById('accountFormCreate').style.display = 'block';
  document.getElementById('accountFormSignin').style.display = 'none';
}
function showSigninMode() {
  document.getElementById('accountFormCreate').style.display = 'none';
  document.getElementById('accountFormSignin').style.display = 'block';
}
function clearErrors() {
  document.getElementById('acctErrorCreate').style.display = 'none';
  document.getElementById('acctErrorSignin').style.display = 'none';
}

export function openAccountPromptModal() {
  showCreateMode();
  clearErrors();
  ['acctNameInput', 'acctAgeInput', 'acctEmailInput', 'acctPasswordInput',
    'acctSigninEmailInput', 'acctSigninPasswordInput'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('accountModal').classList.remove('hidden');
}

export function dismissAccountPrompt() {
  const modal = document.getElementById('accountModal');
  if (modal.classList.contains('hidden')) return;
  localStorage.setItem(ACCOUNT_PROMPT_KEY, '1');
  modal.classList.add('hidden');
  runOnboardingFlow();
}

function friendlyAuthError(err) {
  const code = err && err.code;
  if (code === 'auth/email-already-in-use') return 'That email already has an account — try signing in instead.';
  if (code === 'auth/weak-password') return 'Password should be at least 6 characters.';
  if (code === 'auth/invalid-email') return "That email address doesn't look right.";
  if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') return 'Incorrect email or password.';
  if (code === 'auth/user-not-found') return 'No account found with that email.';
  return (err && err.message) ? err.message : 'Something went wrong — try again.';
}

document.getElementById('accountModalClose').addEventListener('click', dismissAccountPrompt);
document.getElementById('accountModal').addEventListener('click', e => {
  if (e.target.id === 'accountModal') dismissAccountPrompt();
});
document.getElementById('acctSkipBtn').addEventListener('click', dismissAccountPrompt);

document.getElementById('acctSwitchToSignin').addEventListener('click', () => { clearErrors(); showSigninMode(); });
document.getElementById('acctSwitchToCreate').addEventListener('click', () => { clearErrors(); showCreateMode(); });

document.getElementById('acctCreateBtn').addEventListener('click', async () => {
  const name = document.getElementById('acctNameInput').value.trim();
  const ageRaw = document.getElementById('acctAgeInput').value.trim();
  const email = document.getElementById('acctEmailInput').value.trim();
  const password = document.getElementById('acctPasswordInput').value;
  const errEl = document.getElementById('acctErrorCreate');
  if (!name || !email || !password) {
    errEl.textContent = 'Name, email, and password are required.';
    errEl.style.display = 'block';
    return;
  }
  const age = ageRaw ? parseInt(ageRaw, 10) : null;
  if (age != null && Number.isFinite(age)) state.pendingSignupAge = age;
  try {
    await createAccountWithEmail(email, password, name);
    document.getElementById('accountModal').classList.add('hidden');
  } catch (err) {
    state.pendingSignupAge = null;
    errEl.textContent = friendlyAuthError(err);
    errEl.style.display = 'block';
  }
});

document.getElementById('acctSigninBtn').addEventListener('click', async () => {
  const email = document.getElementById('acctSigninEmailInput').value.trim();
  const password = document.getElementById('acctSigninPasswordInput').value;
  const errEl = document.getElementById('acctErrorSignin');
  if (!email || !password) {
    errEl.textContent = 'Email and password are required.';
    errEl.style.display = 'block';
    return;
  }
  try {
    await signInWithEmail(email, password);
    document.getElementById('accountModal').classList.add('hidden');
  } catch (err) {
    errEl.textContent = friendlyAuthError(err);
    errEl.style.display = 'block';
  }
});

document.getElementById('acctGoogleBtn').addEventListener('click', () => {
  document.getElementById('accountModal').classList.add('hidden');
  doSignIn();
});

document.getElementById('acctPasswordInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('acctCreateBtn').click();
});
document.getElementById('acctSigninPasswordInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('acctSigninBtn').click();
});
