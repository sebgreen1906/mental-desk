/* ================= ONLINE: STAGED DIFFICULTY (deterministic, per-player) =================
   Difficulty is driven by exactly two things, both purely time/index-based so it can never
   swing up and down mid-match the way a live rolling performance score would:
   - stage (easy -> medium -> hard) from elapsed match time + question index only
   - progress-within-stage from elapsed time, plus a small *fixed-per-match* engagement
     nudge computed once at match start from lifetime online win/loss streaks
   Question size/awkwardness is also gated by the player's own trophy count (league).
   None of: in-match accuracy, response time, or answer streak feed into difficulty —
   that rolling-performance approach was removed because it caused visible jumpiness.
   Only affects the human player's own question generation — the bot's simulated scoring
   is untouched.
*/
import { randInt } from './utils.js';
import { state } from './state.js';

export const MATCH_DURATION = 60;

export function probRound(f) {
  const lower = Math.floor(f), upper = Math.ceil(f);
  if (lower === upper) return lower;
  return Math.random() < (f - lower) ? upper : lower;
}
export function digitRange(digits) {
  return digits <= 1 ? [1, 9] : [Math.pow(10, digits - 1), Math.pow(10, digits) - 1];
}
export function additionHasCarry(a, b) {
  let carry = 0, had = false, x = a, y = b;
  while (x > 0 || y > 0) {
    const sum = (x % 10) + (y % 10) + carry;
    carry = sum >= 10 ? 1 : 0;
    if (carry) had = true;
    x = Math.floor(x / 10); y = Math.floor(y / 10);
  }
  return had;
}
export function subtractionHasBorrow(a, b) { // assumes a>=b
  let borrow = 0, had = false, x = a, y = b;
  while (x > 0 || y > 0) {
    const dx = x % 10, dy = (y % 10) + borrow;
    if (dx < dy) { had = true; borrow = 1; } else borrow = 0;
    x = Math.floor(x / 10); y = Math.floor(y / 10);
  }
  return had;
}

// League gate: Iron through (most of) Diamond never see a multiplication/division where
// BOTH numbers have 2+ digits. Only the top of Diamond (2250+ trophies) and Hyperleague do.
export function leagueAllowsBothMultiDigit(trophies) {
  return (trophies || 0) >= 2250;
}

// A small curated pool of single-digit factors/divisors that skip the "too obvious" ones
// (1,2,5,10-ish) — this is the actual lever for hard-stage difficulty in low/mid leagues,
// instead of adding more digits.
export const AWKWARD_SINGLE = [6, 7, 8, 9];
export function pickAwkwardSingle() { return AWKWARD_SINGLE[randInt(0, AWKWARD_SINGLE.length - 1)]; }
export function randIntAvoidRound(min, max) {
  if (max - min < 15) return randInt(min, max); // range too small to bother filtering
  let v, tries = 0;
  do { v = randInt(min, max); tries++; } while (v % 10 === 0 && tries < 10);
  return v;
}

// Stage is purely a function of question index + elapsed match time, so it can only ever
// move forward (easy -> medium -> hard) — never regresses mid-match, and both players see
// the "hard" stage kick in at the same wall-clock moment (25s remaining), as intended.
export const HARD_STAGE_REMAINING = 25;
export function getStage(elapsedSec, questionIndex) {
  if (questionIndex <= 3) return 'easy';
  if (MATCH_DURATION - elapsedSec <= HARD_STAGE_REMAINING) return 'hard';
  return 'medium';
}
// Progress within medium/hard is also purely time-based (plus a small *fixed-per-match*
// engagement nudge that can only push forward, never back) — nothing here can swing up and
// down question-to-question the way a live rolling performance score would.
export function mediumProgress(elapsedSec, nudge) {
  const span = MATCH_DURATION - HARD_STAGE_REMAINING;
  return Math.max(0, Math.min(1, elapsedSec / span + Math.max(0, nudge || 0)));
}
export function hardProgress(elapsedSec, nudge) {
  const into = elapsedSec - (MATCH_DURATION - HARD_STAGE_REMAINING);
  return Math.max(0, Math.min(1, into / HARD_STAGE_REMAINING + Math.max(0, nudge || 0)));
}

/* ---- EASY (questions 1-3): Key-Stage-4 basics ---- */
export function genEasy(op) {
  if (op === '+' || op === '-') {
    let a = randInt(10, 99), b = randInt(10, 99);
    if (op === '-' && b > a) { const t = a; a = b; b = t; }
    return { a, b };
  }
  if (op === '×') return [randInt(1, 9), randInt(1, 9)];
  const d = randInt(1, 9), q = randInt(1, 9);
  return { divisor: d, quotient: q, dividend: d * q };
}

/* ---- MEDIUM: one clear step up. Mult/div size is fixed here (2-digit×1-digit) — the
   step up for those comes from leaving 1×1 behind, not from continuing to grow. Add/sub
   are the exception and keep scaling ("two+ digit"), per spec. ---- */
export function genMedium(op, progress) {
  if (op === '+' || op === '-') {
    const digits = probRound(2 + progress * 1.0); // 2 -> 3 digits across medium
    const [lo, hi] = digitRange(digits);
    const wantCarry = Math.random() < (0.3 + progress * 0.4);
    let a = randInt(lo, hi), b = randInt(lo, hi);
    if (op === '-' && b > a) { const t = a; a = b; b = t; }
    const hasFeature = () => op === '+' ? additionHasCarry(a, b) : subtractionHasBorrow(a, b);
    let tries = 0;
    while (tries < 12 && hasFeature() !== wantCarry) {
      a = randInt(lo, hi); b = randInt(lo, hi);
      if (op === '-' && b > a) { const t = a; a = b; b = t; }
      tries++;
    }
    return { a, b };
  }
  if (op === '×') {
    const [lo, hi] = digitRange(2);
    const big = randInt(lo, hi), small = randInt(1, 9);
    return Math.random() < 0.5 ? [big, small] : [small, big];
  }
  const divisor = randInt(2, 9);
  const qlo = Math.max(1, Math.ceil(10 / divisor)), qhi = Math.floor(99 / divisor);
  const quotient = randInt(qlo, qhi); // dividend always lands 2-digit
  return { divisor, quotient, dividend: divisor * quotient };
}

/* ---- HARD (last 25s): for low/mid leagues, the size of mult/div stays capped — awkward
   factor choice is the only thing that escalates. Add/sub keep growing (3->4 digit), which
   is the explicit exception. Both-multi-digit mult/div only unlocks at 2250+ trophies. ---- */
export function genHard(op, progress, allowBothMulti) {
  if (op === '+' || op === '-') {
    const digits = probRound(3 + progress * 1.0); // 3 -> 4 digits across hard stage
    const [lo, hi] = digitRange(digits);
    const wantCarry = Math.random() < (0.6 + progress * 0.35);
    let a = randInt(lo, hi), b = randInt(lo, hi);
    if (op === '-' && b > a) { const t = a; a = b; b = t; }
    const hasFeature = () => op === '+' ? additionHasCarry(a, b) : subtractionHasBorrow(a, b);
    let tries = 0;
    while (tries < 12 && hasFeature() !== wantCarry) {
      a = randInt(lo, hi); b = randInt(lo, hi);
      if (op === '-' && b > a) { const t = a; a = b; b = t; }
      tries++;
    }
    return { a, b };
  }
  if (op === '×') {
    if (allowBothMulti) {
      const bigDigits = probRound(2 + progress * 0.7); // occasionally 3-digit near time-up
      const [lo, hi] = digitRange(bigDigits);
      const a = randIntAvoidRound(lo, hi), b = randIntAvoidRound(10, 99);
      return Math.random() < 0.5 ? [a, b] : [b, a];
    }
    const [lo, hi] = digitRange(2); // stays 2-digit × 1-digit — awkwardness, not size, escalates
    const big = randIntAvoidRound(lo, hi);
    const useAwkward = Math.random() < (0.4 + progress * 0.6);
    const small = useAwkward ? pickAwkwardSingle() : randInt(2, 9);
    return Math.random() < 0.5 ? [big, small] : [small, big];
  }
  // division
  if (allowBothMulti) {
    const divisor = randIntAvoidRound(10, 99);
    const qDigits = probRound(2 + progress * 0.7);
    const [qLo, qHi] = digitRange(qDigits);
    const quotient = randIntAvoidRound(qLo, qHi);
    return { divisor, quotient, dividend: divisor * quotient };
  }
  const useAwkward = Math.random() < (0.4 + progress * 0.6);
  const divisor = useAwkward ? pickAwkwardSingle() : randInt(2, 9);
  const qlo = Math.max(1, Math.ceil(10 / divisor)), qhi = Math.floor(99 / divisor);
  const quotient = randInt(qlo, qhi); // dividend stays 2-digit — no size growth here either
  return { divisor, quotient, dividend: divisor * quotient };
}

export function genProblemStaged(opsList, stage, progress, allowBothMulti) {
  const op = opsList[randInt(0, opsList.length - 1)];
  const result = stage === 'easy' ? genEasy(op)
    : stage === 'medium' ? genMedium(op, progress)
    : genHard(op, progress, allowBothMulti);

  if (op === '+') return { text: `${result.a} + ${result.b}`, answer: result.a + result.b };
  if (op === '-') return { text: `${result.a} − ${result.b}`, answer: result.a - result.b };
  if (op === '×') return { text: `${result[0]} × ${result[1]}`, answer: result[0] * result[1] };
  return { text: `${result.dividend} ÷ ${result.divisor}`, answer: result.quotient };
}

export function computeTargetStage() {
  const onlineState = state.onlineState;
  const elapsed = (Date.now() - onlineState.startedAt) / 1000;
  const qIndex = onlineState.questionIndex || 1;
  const stage = getStage(elapsed, qIndex);
  const nudge = onlineState.engagementNudge || 0;

  if (stage === 'easy') return { stage, progress: 0, syntheticDifficulty: 0.05 };
  if (stage === 'medium') {
    const progress = mediumProgress(elapsed, nudge);
    return { stage, progress, syntheticDifficulty: 0.3 + progress * 0.3 };
  }
  const progress = hardProgress(elapsed, nudge);
  return { stage, progress, syntheticDifficulty: 0.65 + progress * 0.35 };
}
