export function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const MAX_SKIPS = 3;

export function updateSkipButtonLabel(btnId, remaining) {
  const btn = document.getElementById(btnId);
  btn.textContent = remaining > 0 ? `Skip (${remaining} left)` : 'No skips left';
  btn.disabled = remaining <= 0;
}
