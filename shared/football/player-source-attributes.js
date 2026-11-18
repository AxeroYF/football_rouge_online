// EA goalkeeper face-card PAC/DRI mean diving/reflexes. Only detailed outfield
// columns can supply running speed and dribbling in our 26-attribute schema.
export function goalkeeperOutfieldFromReference(source) {
  const pace=source?.sprintSpeed,dribbling=source?.ballDribbling;
  if(!Number.isFinite(pace)||!Number.isFinite(dribbling)||pace<1||pace>99||dribbling<1||dribbling>99)
    throw new Error('门将映射需要有效的 Sprint Speed 和 Dribbling 明细，不能使用 PAC/DRI 卡面值');
  return {pace,dribbling};
}

export const FINAL_GAME_ATTRIBUTE_BASIS='game-final';
export const REFERENCE_ATTRIBUTE_BASIS='reference';
// Already adjusted for the target ability, but not necessarily an exact OVR.
// Runtime may reconcile the core total; it must not offset all attributes again.
export const TARGET_SCALED_ATTRIBUTE_BASIS='target-scaled';
