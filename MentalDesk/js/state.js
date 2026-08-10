export const state = {
  currentUser: null,
  profile: null,

  session: null,
  ops: ['+', '-', '×'],
  difficulty: 'easy',
  lengthMode: { type: 'time', value: 60 },
  sessionsRun: 0,
  bestStreakEver: 0,

  onlineState: null,
  mmState: null,
  lobbyState: null,

  battleLogEntries: [],
  battleLogExpanded: false,

  inboxUnsub: null,
  friendsRefreshInterval: null,
  presenceInterval: null,
  pendingJoinCode: null,

  tutorialStepIndex: 0,
  tutorialDemoStreak: 0,

  lastEmoteSentAt: 0,

  pendingSignupAge: null
};
