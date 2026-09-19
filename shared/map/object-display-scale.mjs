// Keep the regional overview unchanged; merged territories have room for larger detail icons.
const DETAIL_START = 5.8;
const DETAIL_END = 3 + Math.log2(30);
export function mapObjectDetailProgress(zoom){
 const value=Number(zoom);
 const t=Math.max(0,Math.min(1,((Number.isFinite(value)?value:DETAIL_START)-DETAIL_START)/(DETAIL_END-DETAIL_START)));
 return t*t*(3-2*t);
}
export const mapObjectDetailScale=zoom=>1+.65*mapObjectDetailProgress(zoom);
