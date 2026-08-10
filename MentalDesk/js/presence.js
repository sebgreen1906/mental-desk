/* There's no realtime presence backend here (that needs Firebase Realtime Database +
   onDisconnect, a bigger infra lift) — instead each client pings its own publicProfiles
   doc with a timestamp every 60s while the tab is visible, and a friend is shown as
   "Online" if that timestamp is within the last 2 minutes. Good enough approximation
   without needing new infrastructure; someone who abruptly loses connection can show as
   online for up to ~2 minutes after actually leaving.
*/
import { db, doc, updateDoc } from './firebase.js';
import { state } from './state.js';

export const PRESENCE_INTERVAL_MS = 60000;
export const ONLINE_THRESHOLD_MS = 120000;

export function sendPresenceHeartbeat() {
  if (!state.currentUser) return;
  updateDoc(doc(db, 'publicProfiles', state.currentUser.uid), { lastActive: Date.now() })
    .catch(err => console.error('Presence heartbeat failed', err));
}
export function startPresenceHeartbeat() {
  stopPresenceHeartbeat();
  sendPresenceHeartbeat();
  state.presenceInterval = setInterval(() => {
    if (document.visibilityState === 'visible') sendPresenceHeartbeat();
  }, PRESENCE_INTERVAL_MS);
}
export function stopPresenceHeartbeat() {
  if (state.presenceInterval) { clearInterval(state.presenceInterval); state.presenceInterval = null; }
}
export function isFriendOnline(lastActive) {
  return !!lastActive && (Date.now() - lastActive) < ONLINE_THRESHOLD_MS;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.currentUser) sendPresenceHeartbeat();
});
