import { db, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot } from './firebase.js';
import { state } from './state.js';
import { randInt, MAX_SKIPS, updateSkipButtonLabel } from './utils.js';
import { showOnlinePanel, stopMatchmakingListeners } from './matchmaking.js';
import { ACHIEVEMENTS } from './profile.js';
import { applyProfileToTicker, saveProfile } from './profile.js';
import { LEAGUES, TROPHY_CAP, leagueForTrophies, trophyDelta } from './leagues.js';
import { logMatchToHistory } from './battle-log.js';
import { showEmoteBubble } from './emotes.js';
import {
  MATCH_DURATION, leagueAllowsBothMultiDigit, genProblemStaged, computeTargetStage
} from './difficulty.js';

export function engagementDifficultyNudge() {
  const profile = state.profile;
  let nudge = 0;
  if ((profile.onlineLossStreak || 0) >= 2) nudge -= Math.min(0.12, profile.onlineLossStreak * 0.03);
  if ((profile.onlineWinStreak || 0) >= 3) nudge += Math.min(0.12, profile.onlineWinStreak * 0.02);
  return nudge;
}

/* ================= ONLINE: LIVE MATCH ================= */
const ONLINE_OPS = ['+', '-', '×', '÷'];

export async function enterMatch(matchId) {
  stopMatchmakingListeners();
  await deleteDoc(doc(db, 'matchQueue', state.currentUser.uid)).catch(() => {});

  const matchSnap = await getDoc(doc(db, 'matches', matchId));
  if (!matchSnap.exists()) { showOnlinePanel('lobby'); return; }
  const matchData = matchSnap.data();
  const oppUid = matchData.playerIds.find(id => id !== state.currentUser.uid);

  state.onlineState = {
    matchId, oppUid, isBot: false, mode: matchData.mode || 'ranked',
    startedAt: matchData.startedAt,
    oppTrophiesAtStart: matchData.playerTrophies ? matchData.playerTrophies[oppUid] : (state.profile.trophies || 0),
    myScore: 0, myWrong: 0, myStreak: 0, myBestStreak: 0, myMatchScore: 0,
    oppMatchScore: 0, current: null, questionStart: 0, timer: null,
    oppName: (matchData.playerNames && matchData.playerNames[oppUid]) || 'Opponent',
    engagementNudge: engagementDifficultyNudge(), answerHistory: [], questionIndex: 0,
    skipCount: 0, difficultyHistory: []
  };

  document.getElementById('matchOppName').textContent = state.onlineState.oppName;

  await setDoc(doc(db, 'matches', matchId, 'players', state.currentUser.uid), {
    score: 0, wrong: 0, streak: 0, bestStreak: 0, matchScore: 0, lastUpdate: Date.now()
  }).catch(err => console.error('Failed to initialize match player doc', err));

  state.onlineState.oppUnsub = onSnapshot(doc(db, 'matches', matchId, 'players', oppUid), (snap) => {
    if (snap.exists() && state.onlineState) {
      const data = snap.data();
      state.onlineState.oppMatchScore = data.matchScore || 0;
      document.getElementById('matchOppScore').textContent = Math.round(state.onlineState.oppMatchScore);
      if (data.emoteAt && data.emoteAt !== state.onlineState.lastSeenOppEmoteAt) {
        state.onlineState.lastSeenOppEmoteAt = data.emoteAt;
        showEmoteBubble('oppEmoteBubble', data.emote);
      }
    }
  });

  startMatchLoop();
}

// Target range of CORRECT answers per 60s match, by league (bot's final correct count
// lands close to a random point in this range, not just a loose average).
const BOT_LEAGUE_TARGET_RANGE = {
  iron: [2, 5], bronze: [3, 6], silver: [4, 8], gold: [8, 20], diamond: [12, 30], hyper: [20, 55]
};
const BOT_FIRST_NAMES = ['Alex', 'Jordan', 'Sam', 'Taylor', 'Casey', 'Riley', 'Morgan', 'Jamie', 'Avery', 'Quinn',
  'Drew', 'Skyler', 'Reese', 'Harper', 'Rowan', 'Emerson', 'Finley', 'Blake', 'Dakota', 'Peyton',
  'Kai', 'Milo', 'Nova', 'Zane', 'Ivy', 'Leo', 'Ruby', 'Max', 'Ari', 'Sage'];

function generateBotUsername() {
  const name = BOT_FIRST_NAMES[randInt(0, BOT_FIRST_NAMES.length - 1)];
  const num = randInt(10, 999);
  return Math.random() < 0.5 ? `${name}${num}` : `${name}_${num}`;
}

export function startBotMatch() {
  stopMatchmakingListeners();
  if (state.currentUser) deleteDoc(doc(db, 'matchQueue', state.currentUser.uid)).catch(() => {});

  const profile = state.profile;
  const league = leagueForTrophies(profile.trophies || 0);
  const range = BOT_LEAGUE_TARGET_RANGE[league.id] || [4, 8];
  let target = randInt(range[0], range[1]);
  if ((profile.onlineLossStreak || 0) >= 2) target = Math.max(0, target - Math.round(profile.onlineLossStreak * 0.5));
  if ((profile.onlineWinStreak || 0) >= 3) target = target + Math.round(profile.onlineWinStreak * 0.5);

  state.onlineState = {
    matchId: null, oppUid: 'bot', isBot: true, mode: 'ranked', botStreak: 0,
    botTargetCorrect: target, botCorrectCount: 0, botTicks: 0,
    botTrophies: Math.max(0, (profile.trophies || 0) + randInt(-80, 80)),
    startedAt: Date.now(),
    oppTrophiesAtStart: null,
    myScore: 0, myWrong: 0, myStreak: 0, myBestStreak: 0, myMatchScore: 0,
    oppMatchScore: 0, current: null, questionStart: 0, timer: null,
    oppName: generateBotUsername(),
    engagementNudge: engagementDifficultyNudge(), answerHistory: [], questionIndex: 0,
    skipCount: 0, difficultyHistory: []
  };
  state.onlineState.oppTrophiesAtStart = state.onlineState.botTrophies;

  document.getElementById('matchOppName').textContent = state.onlineState.oppName;

  startMatchLoop();
  runBotSimulation();
}

function runBotSimulation() {
  const onlineState = state.onlineState;
  if (!onlineState || !onlineState.isBot) return;
  const elapsed = (Date.now() - onlineState.startedAt) / 1000;
  if (elapsed >= MATCH_DURATION) return;
  onlineState.botTimeout = setTimeout(() => {
    if (!state.onlineState || !state.onlineState.isBot) return;
    state.onlineState.botTicks++;
    // Each ~1s tick, aim the remaining hit-rate so the match lands on botTargetCorrect by time-up.
    const remainingTicks = Math.max(1, MATCH_DURATION - state.onlineState.botTicks);
    const remainingTarget = Math.max(0, state.onlineState.botTargetCorrect - state.onlineState.botCorrectCount);
    const pCorrect = Math.min(0.95, remainingTarget / remainingTicks);
    const correct = Math.random() < pCorrect;
    if (correct) {
      state.onlineState.botCorrectCount++;
      state.onlineState.botStreak++;
      const mult = state.onlineState.botStreak >= 10 ? 3 : state.onlineState.botStreak >= 5 ? 2 : 1;
      state.onlineState.oppMatchScore = state.onlineState.oppMatchScore + mult;
    } else {
      state.onlineState.botStreak = 0;
    }
    document.getElementById('matchOppScore').textContent = Math.round(state.onlineState.oppMatchScore);
    runBotSimulation();
  }, 1000 + randInt(-150, 150));
}

function startMatchLoop() {
  showOnlinePanel('match');
  document.getElementById('matchMyScore').textContent = '0';
  document.getElementById('matchOppScore').textContent = '0';
  document.getElementById('matchClock').textContent = MATCH_DURATION;
  updateSkipButtonLabel('matchSkipBtn', MAX_SKIPS);
  document.getElementById('emoteTray').classList.add('hidden');
  document.getElementById('myEmoteBubble').classList.remove('show');
  document.getElementById('oppEmoteBubble').classList.remove('show');
  document.getElementById('emoteBtn').disabled = false;
  state.lastEmoteSentAt = 0;
  nextMatchProblem();
  document.getElementById('matchAnswerInput').focus();

  state.onlineState.timer = setInterval(() => {
    if (!state.onlineState) return;
    const elapsed = Math.floor((Date.now() - state.onlineState.startedAt) / 1000);
    const left = Math.max(0, MATCH_DURATION - elapsed);
    document.getElementById('matchClock').textContent = left;
    if (left <= 0) endMatch();
  }, 250);
}

function nextMatchProblem() {
  const onlineState = state.onlineState;
  onlineState.questionIndex = (onlineState.questionIndex || 0) + 1;
  const { stage, progress, syntheticDifficulty } = computeTargetStage();
  onlineState.difficultyHistory = onlineState.difficultyHistory || [];
  onlineState.difficultyHistory.push(syntheticDifficulty);
  const allowBothMulti = leagueAllowsBothMultiDigit(state.profile.trophies);
  onlineState.current = genProblemStaged(ONLINE_OPS, stage, progress, allowBothMulti);
  document.getElementById('matchProblemText').textContent = onlineState.current.text;
  const input = document.getElementById('matchAnswerInput');
  input.value = '';
  input.classList.remove('wrong');
  onlineState.questionStart = performance.now();
  input.focus();
}

function submitMatchAnswer() {
  const onlineState = state.onlineState;
  if (!onlineState || onlineState.current == null) return;
  const input = document.getElementById('matchAnswerInput');
  if (input.value.trim() === '') return;
  const val = parseInt(input.value.trim(), 10);
  const responseTime = (performance.now() - onlineState.questionStart) / 1000;
  onlineState.answerHistory = onlineState.answerHistory || [];
  onlineState.answerHistory.push({ correct: val === onlineState.current.answer, time: responseTime });
  if (onlineState.answerHistory.length > 20) onlineState.answerHistory.shift();

  if (val === onlineState.current.answer) {
    onlineState.myScore++;
    onlineState.myStreak++;
    onlineState.myBestStreak = Math.max(onlineState.myBestStreak, onlineState.myStreak);
    const mult = onlineState.myStreak >= 10 ? 3 : onlineState.myStreak >= 5 ? 2 : 1;
    onlineState.myMatchScore = onlineState.myMatchScore + mult;
  } else {
    onlineState.myWrong++;
    onlineState.myStreak = 0;
    input.classList.add('wrong');
  }
  document.getElementById('matchMyScore').textContent = Math.round(onlineState.myMatchScore);

  if (!onlineState.isBot) {
    updateDoc(doc(db, 'matches', onlineState.matchId, 'players', state.currentUser.uid), {
      score: onlineState.myScore, wrong: onlineState.myWrong, streak: onlineState.myStreak,
      bestStreak: onlineState.myBestStreak, matchScore: onlineState.myMatchScore, lastUpdate: Date.now()
    }).catch(err => console.error('Match score sync failed', err));
  }

  const elapsed = (Date.now() - onlineState.startedAt) / 1000;
  if (elapsed < MATCH_DURATION) onlineState.advanceTimer = setTimeout(nextMatchProblem, 180);
}

function skipMatchProblem() {
  const onlineState = state.onlineState;
  if (!onlineState || onlineState.current == null) return;
  if ((onlineState.skipCount || 0) >= MAX_SKIPS) return;
  if (onlineState.advanceTimer) clearTimeout(onlineState.advanceTimer);
  onlineState.skipCount = (onlineState.skipCount || 0) + 1;
  updateSkipButtonLabel('matchSkipBtn', MAX_SKIPS - onlineState.skipCount);
  const elapsed = (Date.now() - onlineState.startedAt) / 1000;
  if (elapsed < MATCH_DURATION) nextMatchProblem();
}

document.getElementById('matchAnswerInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') submitMatchAnswer();
});
document.getElementById('matchSubmitBtn').addEventListener('click', submitMatchAnswer);
document.getElementById('matchSubmitBtn').addEventListener('pointerdown', e => e.preventDefault());
document.getElementById('matchSkipBtn').addEventListener('click', skipMatchProblem);
document.getElementById('matchSkipBtn').addEventListener('pointerdown', e => e.preventDefault());

export function forfeitMatch() {
  const onlineState = state.onlineState;
  if (!onlineState) return;
  clearInterval(onlineState.timer);
  if (onlineState.botTimeout) clearTimeout(onlineState.botTimeout);
  if (onlineState.oppUnsub) onlineState.oppUnsub();

  const isBot = onlineState.isBot;
  const isFriendly = onlineState.mode === 'friendly';
  const matchId = onlineState.matchId;
  let actualDelta = 0;

  if (!isFriendly) {
    const profile = state.profile;
    const trophiesBefore = profile.trophies || 0;
    profile.trophies = Math.max(0, trophiesBefore - 30);
    actualDelta = trophiesBefore - profile.trophies;
    profile.onlineLosses = (profile.onlineLosses || 0) + 1;
    profile.onlineLossStreak = (profile.onlineLossStreak || 0) + 1;
    profile.onlineWinStreak = 0;

    applyProfileToTicker();
    saveProfile();
  }

  logMatchToHistory({
    result: 'loss', forfeited: true,
    displayScore: Math.round(onlineState.myMatchScore), oppDisplayScore: Math.round(onlineState.oppMatchScore),
    trophyDelta: isFriendly ? 0 : -actualDelta
  });

  if (!isBot && matchId) {
    updateDoc(doc(db, 'matches', matchId), { status: 'forfeited' }).catch(() => {});
  }

  state.onlineState = null;
  showOnlinePanel('lobby');
}

export function endMatch() {
  const onlineState = state.onlineState;
  if (!onlineState) return;
  clearInterval(onlineState.timer);
  if (onlineState.botTimeout) clearTimeout(onlineState.botTimeout);
  if (onlineState.oppUnsub) onlineState.oppUnsub();

  const profile = state.profile;
  const myMatchScore = onlineState.myMatchScore;
  const oppMatchScore = onlineState.oppMatchScore;
  const myRaw = onlineState.myScore;
  const isBot = onlineState.isBot;
  const isFriendly = onlineState.mode === 'friendly';
  const matchId = onlineState.matchId;
  const oppTrophies = onlineState.oppTrophiesAtStart ?? (profile.trophies || 0);

  // Scores are always whole numbers now (see the streak-multiplier fix), so this comparison
  // reflects a genuine tie, not two different scores that happened to round the same way.
  const isDraw = myMatchScore === oppMatchScore;
  const iWon = !isDraw && myMatchScore > oppMatchScore;

  let actualDelta = 0, beforeLeague = null, afterLeague = null;

  if (!isFriendly && !isDraw) {
    const delta = trophyDelta(profile.trophies || 0, oppTrophies, iWon);
    beforeLeague = leagueForTrophies(profile.trophies || 0);
    const wasOnLossStreak = (profile.onlineLossStreak || 0) >= 3;
    const trophiesBefore = profile.trophies || 0;

    if (iWon) {
      profile.trophies = Math.min(TROPHY_CAP, (profile.trophies || 0) + delta);
      profile.onlineWins = (profile.onlineWins || 0) + 1;
      profile.onlineWinStreak = (profile.onlineWinStreak || 0) + 1;
      profile.onlineLossStreak = 0;
    } else {
      profile.trophies = Math.max(0, (profile.trophies || 0) - delta);
      profile.onlineLosses = (profile.onlineLosses || 0) + 1;
      profile.onlineLossStreak = (profile.onlineLossStreak || 0) + 1;
      profile.onlineWinStreak = 0;
    }
    actualDelta = Math.abs(profile.trophies - trophiesBefore);
    profile.peakTrophies = Math.max(profile.peakTrophies || 0, profile.trophies);
    afterLeague = leagueForTrophies(profile.trophies);

    profile._justComeback = (iWon && wasOnLossStreak);
    ACHIEVEMENTS.forEach(a => {
      if (a.check(profile) && !profile.banners.includes(a.id)) profile.banners.push(a.id);
    });
    delete profile._justComeback;

    applyProfileToTicker();
    saveProfile();
  } else if (!isFriendly && isDraw) {
    profile.onlineDraws = (profile.onlineDraws || 0) + 1;
    applyProfileToTicker();
    saveProfile();
  }

  if (!isBot && matchId) {
    updateDoc(doc(db, 'matches', matchId), { status: 'finished' }).catch(() => {});
  }

  showOnlinePanel('result');
  const outcomeEl = document.getElementById('resultOutcome');
  outcomeEl.textContent = isDraw ? 'Draw' : (iWon ? 'You win' : 'You lose');
  outcomeEl.className = 'outcome ' + (isDraw ? 'draw' : (iWon ? 'win' : 'loss'));
  document.getElementById('resultScoreLine').textContent =
    `${Math.round(myMatchScore)} – ${Math.round(oppMatchScore)} (${myRaw} correct)`;
  const deltaEl = document.getElementById('resultTrophyDelta');
  const transEl = document.getElementById('resultLeagueTransition');
  if (isFriendly) {
    deltaEl.textContent = 'Friendly match — no trophies at stake';
    deltaEl.className = 'trophy-delta';
    transEl.textContent = '';
  } else if (isDraw) {
    deltaEl.textContent = 'Draw — no trophies won or lost';
    deltaEl.className = 'trophy-delta';
    transEl.textContent = '';
  } else {
    deltaEl.textContent = iWon ? `+${actualDelta} trophies` : `-${actualDelta} trophies`;
    deltaEl.className = 'trophy-delta ' + (iWon ? 'up' : 'down');
    if (beforeLeague.id !== afterLeague.id) {
      transEl.textContent = (LEAGUES.indexOf(afterLeague) > LEAGUES.indexOf(beforeLeague))
        ? `Promoted to ${afterLeague.name}!` : `Demoted to ${afterLeague.name}.`;
    } else {
      transEl.textContent = '';
    }
  }

  logMatchToHistory({
    result: isDraw ? 'draw' : (iWon ? 'win' : 'loss'),
    displayScore: Math.round(myMatchScore), oppDisplayScore: Math.round(oppMatchScore),
    trophyDelta: (isFriendly || isDraw) ? 0 : (iWon ? actualDelta : -actualDelta)
  });

  state.onlineState = null;
}
