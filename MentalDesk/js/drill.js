import { state } from './state.js';
import { randInt, MAX_SKIPS, updateSkipButtonLabel } from './utils.js';
import { setTick } from './shell.js';
import { syncSessionToProfile } from './profile.js';

/* ================= DRILL: SETTINGS ================= */
const difficultyHints = {
  easy: 'Single-digit × and ÷, single-digit + and −.',
  hard: 'Double-digit × single-digit, or double-digit ÷ single-digit. Double-digit + and −.',
  expert: 'Double-digit × double-digit, or double-digit ÷ double-digit. Double-digit + and −.'
};

document.querySelectorAll('#opChips .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    chip.classList.toggle('on');
    state.ops = [...document.querySelectorAll('#opChips .chip.on')].map(c => c.dataset.op);
    if (state.ops.length === 0) { chip.classList.add('on'); state.ops = [chip.dataset.op]; }
  });
});
document.querySelectorAll('#digitChips .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#digitChips .chip').forEach(c => c.classList.remove('on'));
    chip.classList.add('on');
    state.difficulty = chip.dataset.digit;
    document.getElementById('difficultyHint').textContent = difficultyHints[state.difficulty];
  });
});
document.querySelectorAll('#lengthChips .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#lengthChips .chip').forEach(c => c.classList.remove('on'));
    chip.classList.add('on');
    const len = chip.dataset.length;
    if (len === 'infinite') {
      state.lengthMode = { type: 'infinite', value: null };
    } else if (len.startsWith('count')) {
      state.lengthMode = { type: 'count', value: parseInt(len.replace('count', '')) };
    } else {
      state.lengthMode = { type: 'time', value: parseInt(len) };
    }
  });
});

/* ================= PROBLEM GENERATION ================= */
function addSubRange(diff) {
  return diff === 'easy' ? [1, 9] : [10, 99]; // hard & expert both use double-digit + / −
}
function multPair(diff) {
  if (diff === 'easy') {
    return [randInt(1, 9), randInt(1, 9)];
  } else if (diff === 'hard') {
    const two = randInt(10, 99), one = randInt(1, 9);
    return Math.random() < 0.5 ? [two, one] : [one, two];
  }
  return [randInt(10, 99), randInt(10, 99)]; // expert
}
function divPair(diff) {
  if (diff === 'easy') {
    const d = randInt(1, 9), q = randInt(1, 9);
    return { d, q, dividend: d * q };
  } else if (diff === 'hard') {
    const d = randInt(2, 9); // single-digit divisor
    const qlo = Math.max(1, Math.ceil(10 / d));
    const qhi = Math.floor(99 / d);
    const q = randInt(qlo, qhi); // dividend lands in double digits
    return { d, q, dividend: d * q };
  }
  const d = randInt(10, 99), q = randInt(10, 99); // expert: double ÷ double
  return { d, q, dividend: d * q };
}
function genProblem(opsList, diff) {
  const op = opsList[randInt(0, opsList.length - 1)];
  let a, b, answer, text;
  if (op === '+') {
    const r = addSubRange(diff);
    a = randInt(r[0], r[1]); b = randInt(r[0], r[1]); answer = a + b; text = `${a} + ${b}`;
  } else if (op === '-') {
    const r = addSubRange(diff);
    a = randInt(r[0], r[1]); b = randInt(r[0], r[1]);
    if (b > a) { [a, b] = [b, a]; }
    answer = a - b; text = `${a} − ${b}`;
  } else if (op === '×') {
    [a, b] = multPair(diff); answer = a * b; text = `${a} × ${b}`;
  } else { // division, always integer by construction
    const res = divPair(diff); answer = res.q; text = `${res.dividend} ÷ ${res.d}`;
  }
  return { text, answer };
}

/* ================= SESSION STATE ================= */
function startSession() {
  state.session = {
    score: 0, wrong: 0, streak: 0, bestStreak: 0,
    times: [], missed: [], current: null, questionStart: 0,
    timer: null, timeLeft: state.lengthMode.type === 'time' ? state.lengthMode.value : null,
    countTarget: state.lengthMode.type === 'count' ? state.lengthMode.value : null,
    seen: 0, skipCount: 0
  };
  document.getElementById('drillSettings').style.display = 'none';
  document.getElementById('drillSummary').style.display = 'none';
  document.getElementById('drillSession').style.display = 'block';
  updateHud();
  updateSkipButtonLabel('skipBtn', MAX_SKIPS);
  nextProblem();
  document.getElementById('answerInput').focus();

  const session = state.session;
  if (state.lengthMode.type === 'time') {
    document.getElementById('hudClock').textContent = session.timeLeft;
    session.timer = setInterval(() => {
      session.timeLeft--;
      document.getElementById('hudClock').textContent = session.timeLeft;
      if (session.timeLeft <= 0) { endSession(); }
    }, 1000);
  } else if (state.lengthMode.type === 'count') {
    document.getElementById('hudClock').textContent = state.lengthMode.value;
  } else {
    document.getElementById('hudClock').textContent = '∞';
  }
}

function nextProblem() {
  const session = state.session;
  session.current = genProblem(state.ops, state.difficulty);
  document.getElementById('problemText').textContent = session.current.text;
  const input = document.getElementById('answerInput');
  input.value = '';
  input.classList.remove('wrong');
  document.getElementById('problemCard').classList.remove('correct-flash', 'wrong-flash');
  session.questionStart = performance.now();
  input.focus();
}

function updateHud() {
  const session = state.session;
  document.getElementById('hudScore').textContent = session.score;
  document.getElementById('hudStreak').textContent = session.streak;
  const total = session.score + session.wrong;
  const acc = total ? Math.round(session.score / total * 100) : 100;
  document.getElementById('hudAcc').textContent = acc + '%';
  document.getElementById('hudCount').textContent = state.lengthMode.type === 'count'
    ? `${session.seen}/${session.countTarget}` : session.seen;
}

function submitAnswer() {
  const session = state.session;
  const input = document.getElementById('answerInput');
  if (input.value.trim() === '') return;
  const val = parseInt(input.value.trim(), 10);
  const elapsed = (performance.now() - session.questionStart) / 1000;
  session.seen++;
  const card = document.getElementById('problemCard');
  if (val === session.current.answer) {
    session.score++; session.streak++;
    session.bestStreak = Math.max(session.bestStreak, session.streak);
    session.times.push(elapsed);
    card.classList.add('correct-flash');
  } else {
    session.wrong++; session.streak = 0;
    session.missed.push({ text: session.current.text, yours: input.value, right: session.current.answer });
    card.classList.add('wrong-flash');
    input.classList.add('wrong');
  }
  updateHud();

  if (state.lengthMode.type === 'count' && session.seen >= session.countTarget) {
    session.advanceTimer = setTimeout(endSession, 220);
    return;
  }
  session.advanceTimer = setTimeout(nextProblem, 220);
}

function skipProblem() {
  const session = state.session;
  if (!session || session.skipCount >= MAX_SKIPS) return;
  if (session.advanceTimer) clearTimeout(session.advanceTimer);
  session.skipCount++;
  updateSkipButtonLabel('skipBtn', MAX_SKIPS - session.skipCount);
  nextProblem();
}

document.getElementById('answerInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') submitAnswer();
});
document.getElementById('submitBtn').addEventListener('click', submitAnswer);
document.getElementById('submitBtn').addEventListener('pointerdown', e => {
  e.preventDefault(); // keep the on-screen keyboard open instead of blurring the input
});
document.getElementById('skipBtn').addEventListener('click', skipProblem);
document.getElementById('skipBtn').addEventListener('pointerdown', e => e.preventDefault());

function endSession() {
  const session = state.session;
  if (session.timer) clearInterval(session.timer);
  document.getElementById('drillSession').style.display = 'none';
  document.getElementById('drillSummary').style.display = 'block';

  const total = session.score + session.wrong;
  const acc = total ? Math.round(session.score / total * 100) : 0;
  const avg = session.times.length ? (session.times.reduce((a, b) => a + b, 0) / session.times.length) : 0;

  document.getElementById('sumScore').textContent = session.score;
  document.getElementById('sumAcc').textContent = acc + '%';
  document.getElementById('sumAvg').textContent = avg.toFixed(1) + 's';
  document.getElementById('sumBest').textContent = session.bestStreak;

  const list = document.getElementById('missedList');
  list.innerHTML = '';
  document.getElementById('missedWrap').style.display = session.missed.length ? 'block' : 'none';
  session.missed.forEach(m => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${m.text}</span><span><span class="yours">you: ${m.yours}</span> &nbsp; <span class="right">ans: ${m.right}</span></span>`;
    list.appendChild(li);
  });

  setTick('STREAK', session.bestStreak);
  setTick('ACCURACY', acc + '%');
  setTick('AVG TIME', avg.toFixed(1) + 's');

  if (state.currentUser && state.profile) {
    syncSessionToProfile({ score: session.score, wrong: session.wrong, acc, avg, bestStreak: session.bestStreak });
  } else {
    state.sessionsRun++; setTick('SESSIONS RUN', state.sessionsRun);
    state.bestStreakEver = Math.max(state.bestStreakEver, session.bestStreak);
    setTick('BEST STREAK', state.bestStreakEver);
  }
}

document.getElementById('exitSessionBtn').addEventListener('click', endSession);
document.getElementById('startBtn').addEventListener('click', startSession);
document.getElementById('retryBtn').addEventListener('click', startSession);
document.getElementById('reconfigBtn').addEventListener('click', () => {
  document.getElementById('drillSummary').style.display = 'none';
  document.getElementById('drillSettings').style.display = 'block';
});
