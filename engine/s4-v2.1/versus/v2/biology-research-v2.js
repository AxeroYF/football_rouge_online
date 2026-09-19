// Accumulate saved tenths so small reductions survive the engine's 0.1 fitness precision.
export function biologyFatigueLoss(player,normalLoss,reduction){
 const percent=Math.max(0,Math.min(15,Number(reduction)||0));if(!percent)return normalLoss;
 const saved=(player.biologyFitnessSaved??0)+normalLoss*percent/100;
 const refund=Math.min(normalLoss,Math.floor((saved+1e-9)*10)/10);
 player.biologyFitnessSaved=saved-refund;return normalLoss-refund;
}
