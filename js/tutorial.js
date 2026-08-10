import { state } from './state.js';
import { saveProfile } from './profile.js';

/* ================= TUTORIAL ================= */
const TUTORIAL_STEPS = [
  {
    title: 'Welcome to Mental Desk',
    body: `Mental Desk trains fast, accurate mental arithmetic — the same reflexes tested in
      finance and consulting interviews. There are two ways to play: <b>Speed Drills</b>,
      solo practice at your own pace, and <b>Online</b>, 60-second ranked duels against
      other players. This quick walkthrough covers scoring, leagues, and trophies.`
  },
  {
    title: 'Speed Drills & your IQ Score',
    body: `Pick your operations, difficulty, and session length, then answer as many
      problems as you can. Every session updates your <b>IQ Score</b> — it starts at 100
      and moves up or down based on your accuracy. It's a personal skill tracker for
      offline practice only, and is never affected by anything that happens online.`
  },
  {
    title: 'Online Duels',
    body: `In Online mode, you and an opponent — a real player, or a bot if none are
      available — both get 60 seconds of the same style of questions. You never see their
      questions, only their live score. Whoever scores more when time's up wins. Questions
      start easy, step up gradually, and get genuinely hard in the last 25 seconds.`
  },
  {
    title: 'The Streak Multiplier',
    body: `Every correct answer scores points — but a streak makes each one worth more:
      normal answers score ×1, reach a 5-answer streak and you earn ×2 per answer, reach
      10 and it's ×3. One wrong answer resets your streak back to ×1. Try it below:`,
    interactive: 'streakDemo'
  },
  {
    title: 'Leagues & Trophies',
    body: `Winning a ranked online match earns you <b>Trophies</b> — losing costs you some
      too, with the amount depending on the trophy gap between you and your opponent
      (upsetting a much stronger opponent pays out more). Trophies place you into a
      league: Iron → Bronze → Silver → Gold → Diamond → Hyperleague, up to a 3,000-trophy
      cap. Tap any league badge in the app any time to see the full ladder.`
  },
  {
    title: 'IQ Score vs Trophies',
    body: `These are two completely separate numbers. <b>IQ Score</b> reflects your own
      accuracy in solo Speed Drills — no opponent, no risk, just tracking your personal
      improvement. <b>Trophies</b> are your competitive rank from ranked Online
      matches — they only move from real ranked duels, never from Speed Drills, and never
      from a Friendly private match with a friend. A high IQ Score doesn't guarantee a
      high trophy count, or vice versa — they measure different things.`
  },
  {
    title: 'Stay in the loop',
    body: `Want to hear about new features, leagues, and events? We'll only email you
      occasionally — never spam — and you can turn it off any time from your Profile page.`,
    interactive: 'emailOptIn'
  }
];

export function openTutorial() {
  state.tutorialStepIndex = 0;
  renderTutorialStep();
  document.getElementById('tutorialModal').classList.remove('hidden');
}

export function closeTutorialModal() {
  const modal = document.getElementById('tutorialModal');
  if (modal.classList.contains('hidden')) return;
  modal.classList.add('hidden');
  localStorage.setItem('md_tutorial_seen', '1');
  if (state.profile && !state.profile.hasSeenTutorial) {
    state.profile.hasSeenTutorial = true;
    saveProfile();
  }
}

function renderTutorialStep() {
  const step = TUTORIAL_STEPS[state.tutorialStepIndex];
  document.getElementById('tutorialTitle').textContent = step.title;
  document.getElementById('tutorialBody').innerHTML = step.body;

  const dots = document.getElementById('tutorialDots');
  dots.innerHTML = TUTORIAL_STEPS.map((_, i) =>
    `<span class="tutorial-dot${i === state.tutorialStepIndex ? ' active' : ''}"></span>`).join('');

  const interactiveWrap = document.getElementById('tutorialInteractive');
  interactiveWrap.innerHTML = '';
  if (step.interactive === 'streakDemo') renderStreakDemo(interactiveWrap);
  if (step.interactive === 'emailOptIn') renderTutorialEmailOptIn(interactiveWrap);

  document.getElementById('tutorialBackBtn').style.visibility = state.tutorialStepIndex === 0 ? 'hidden' : 'visible';
  document.getElementById('tutorialNextBtn').textContent =
    state.tutorialStepIndex === TUTORIAL_STEPS.length - 1 ? "Let's play!" : 'Next';
}

function renderStreakDemo(container) {
  state.tutorialDemoStreak = 0;
  container.innerHTML = `
    <div class="streak-demo">
      <div class="streak-demo-row">
        <div>Streak<b id="demoStreak">0</b></div>
        <div>Multiplier<b id="demoMult">×1</b></div>
      </div>
      <div class="btn-row">
        <button class="btn-secondary" id="demoCorrectBtn">Tap for a correct answer</button>
        <button class="btn-secondary" id="demoResetBtn">Reset</button>
      </div>
      <div class="streak-demo-note" id="demoNote"></div>
    </div>
  `;
  const streakEl = container.querySelector('#demoStreak');
  const multEl = container.querySelector('#demoMult');
  const noteEl = container.querySelector('#demoNote');
  const updateDemo = () => {
    streakEl.textContent = state.tutorialDemoStreak;
    const mult = state.tutorialDemoStreak >= 10 ? 3 : state.tutorialDemoStreak >= 5 ? 2 : 1;
    multEl.textContent = `×${mult}`;
    noteEl.textContent = state.tutorialDemoStreak >= 10 ? 'Maxed out — every answer now scores triple!'
      : state.tutorialDemoStreak >= 5 ? 'Streak of 5+ reached — double points!'
      : 'Keep going — 5 in a row doubles your points.';
  };
  container.querySelector('#demoCorrectBtn').addEventListener('click', () => {
    state.tutorialDemoStreak++;
    updateDemo();
  });
  container.querySelector('#demoResetBtn').addEventListener('click', () => {
    state.tutorialDemoStreak = 0;
    updateDemo();
  });
  updateDemo();
}

function renderTutorialEmailOptIn(container) {
  const checked = state.profile ? !!state.profile.emailOptIn : localStorage.getItem('md_pending_email_optin') === '1';
  container.innerHTML = `
    <label style="display:flex;align-items:center;gap:8px;margin-top:16px;font-size:13px;color:var(--text-dim);cursor:pointer;">
      <input type="checkbox" id="tutorialEmailOptIn" ${checked ? 'checked' : ''} />
      Get occasional emails from Mental Desk
    </label>
    <div class="save-hint" id="tutorialEmailNote" style="margin-top:8px;"></div>
  `;
  container.querySelector('#tutorialEmailNote').textContent = state.profile
    ? '' : "Sign in with Google to lock this in — we'll remember your choice.";
  container.querySelector('#tutorialEmailOptIn').addEventListener('change', e => {
    if (state.profile) {
      state.profile.emailOptIn = e.target.checked;
      saveProfile();
      const profileCheckbox = document.getElementById('emailOptInInput');
      if (profileCheckbox) profileCheckbox.checked = e.target.checked;
    } else {
      localStorage.setItem('md_pending_email_optin', e.target.checked ? '1' : '0');
    }
  });
}

document.getElementById('helpBtn').addEventListener('click', openTutorial);
document.getElementById('tutorialClose').addEventListener('click', closeTutorialModal);
document.getElementById('tutorialModal').addEventListener('click', e => {
  if (e.target.id === 'tutorialModal') closeTutorialModal();
});
document.getElementById('tutorialBackBtn').addEventListener('click', () => {
  if (state.tutorialStepIndex > 0) { state.tutorialStepIndex--; renderTutorialStep(); }
});
document.getElementById('tutorialNextBtn').addEventListener('click', () => {
  if (state.tutorialStepIndex < TUTORIAL_STEPS.length - 1) {
    state.tutorialStepIndex++;
    renderTutorialStep();
  } else {
    closeTutorialModal();
  }
});
