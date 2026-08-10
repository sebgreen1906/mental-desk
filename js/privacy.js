import { state } from './state.js';
import { saveProfile } from './profile.js';
import { openTutorial } from './tutorial.js';

/* ================= PRIVACY POLICY ================= */
// Gates first-time use: shown before the tutorial, and unlike the other modals it can't be
// dismissed by clicking outside or (while unaccepted) via Escape — only "I Accept" proceeds.
export function hasAcceptedPrivacy() {
  return state.profile ? !!state.profile.hasAcceptedPrivacyPolicy : !!localStorage.getItem('md_privacy_accepted');
}

export function runOnboardingFlow() {
  if (!hasAcceptedPrivacy()) {
    openPrivacyModal();
    return;
  }
  const tutorialSeen = state.profile ? state.profile.hasSeenTutorial : localStorage.getItem('md_tutorial_seen');
  if (!tutorialSeen) openTutorial();
}

export function openPrivacyModal() {
  const accepted = hasAcceptedPrivacy();
  document.getElementById('privacyDeclineBtn').style.display = accepted ? 'none' : 'block';
  document.getElementById('privacyAcceptBtn').textContent = accepted ? 'Close' : 'I Accept';
  document.getElementById('privacyDeclineNote').style.display = 'none';
  document.getElementById('privacyModal').classList.remove('hidden');
}

export function closePrivacyModalIfAccepted() {
  if (hasAcceptedPrivacy()) document.getElementById('privacyModal').classList.add('hidden');
}

document.getElementById('privacyAcceptBtn').addEventListener('click', () => {
  localStorage.setItem('md_privacy_accepted', '1');
  if (state.profile && !state.profile.hasAcceptedPrivacyPolicy) {
    state.profile.hasAcceptedPrivacyPolicy = true;
    saveProfile();
  }
  document.getElementById('privacyModal').classList.add('hidden');
  runOnboardingFlow();
});
document.getElementById('privacyDeclineBtn').addEventListener('click', () => {
  const note = document.getElementById('privacyDeclineNote');
  note.textContent = "You'll need to accept the Privacy Policy to use Mental Desk.";
  note.style.display = 'block';
});
document.getElementById('privacyLinkFooter').addEventListener('click', openPrivacyModal);
