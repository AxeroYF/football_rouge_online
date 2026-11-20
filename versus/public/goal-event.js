export function isGoalEvent(event) {
  return event?.type === 'goal' || event?.type === 'ownGoal' ||
    (event?.type === 'penaltyShootoutKick' && (event.shootoutGoal === true || event.scored === true)) ||
    (event?.type === 'shootoutResult' && event.goal === true);
}
