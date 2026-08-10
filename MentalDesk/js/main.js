import { auth, onAuthStateChanged } from './firebase.js';
import { state } from './state.js';

// Side-effecting feature modules — each wires up its own DOM listeners on import.
// Imported explicitly (rather than relying on incidental transitive reachability)
// so the dependency on each module's wiring running is obvious from this file alone.
import './shell.js';
import './drill.js';
import './profile.js';
import './leagues.js';
import './presence.js';
import './difficulty.js';
import './matchmaking.js';
import './match.js';
import './emotes.js';
import './battle-log.js';
import './friends.js';
import './tutorial.js';
import './privacy.js';
import './account-prompt.js';

import { loadProfile, renderProfile } from './profile.js';
import { stopInboxListener } from './friends.js';
import { stopPresenceHeartbeat } from './presence.js';
import { stopFriendsRefresh, renderFriendsGate } from './friends.js';
import { stopMatchmakingListeners, renderOnlineGate, joinFriendLobby } from './matchmaking.js';
import { runOnboardingFlow, closePrivacyModalIfAccepted } from './privacy.js';
import { closeLeagueModal } from './leagues.js';
import { closeMatchDetailsModal } from './battle-log.js';
import { closeTutorialModal } from './tutorial.js';
import { dismissAccountPrompt } from './account-prompt.js';

/* ================= ONLINE: JOIN VIA SHARED LINK (?join=CODE) ================= */
// Runs after every other module has registered its DOM listeners (main.js is the
// last module evaluated, since everything above is one of its dependencies), so the
// tab-switch click below is guaranteed to land on an already-wired listener.
(function checkPendingJoinFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('join');
  if (code) {
    state.pendingJoinCode = code.trim().toUpperCase();
    history.replaceState(null, '', window.location.pathname);
    document.querySelector('nav.tabs button[data-view="online"]').click();
  }
})();

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeLeagueModal(); closeMatchDetailsModal(); closeTutorialModal();
    closePrivacyModalIfAccepted(); dismissAccountPrompt();
  }
});

onAuthStateChanged(auth, async (user) => {
  state.currentUser = user;
  if (user) {
    await loadProfile();
    if (state.pendingJoinCode) {
      const code = state.pendingJoinCode;
      state.pendingJoinCode = null;
      document.querySelector('nav.tabs button[data-view="online"]').click();
      joinFriendLobby(code);
    }
  } else {
    state.profile = null;
    stopInboxListener();
    stopPresenceHeartbeat();
    stopFriendsRefresh();
    stopMatchmakingListeners();
    if (state.onlineState) {
      if (state.onlineState.timer) clearInterval(state.onlineState.timer);
      if (state.onlineState.botTimeout) clearTimeout(state.onlineState.botTimeout);
      if (state.onlineState.oppUnsub) state.onlineState.oppUnsub();
      state.onlineState = null;
    }
    renderProfile();
    renderOnlineGate();
    renderFriendsGate();
    runOnboardingFlow();
  }
});
