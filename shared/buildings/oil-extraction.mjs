// One deposit supports one extractor, even when a well and a wonder coexist.
export function activeOilExtractor(buildings = []) {
 const active=buildings.filter(b=>b.status==='active');
 return active.find(b=>b.type==='oil-well')
  ?? active.find(b=>typeof b.wonderId==='string'&&b.wonderId&&b.type==='wonder:'+b.wonderId)
  ?? null;
}
export const oilExtractorLabel = building => building?.type==='oil-well' ? '油井' : '奇观油田';
