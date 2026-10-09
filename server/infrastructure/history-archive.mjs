import {gzipSync,gunzipSync} from 'node:zlib';
const MAX_BYTES=32*1024*1024;
export function archiveFields(record,fields) {
 if(!record||record.archivedFields)return record;
 const payload={};for(const key of fields)if(record[key]!==undefined)payload[key]=record[key];
 const json=JSON.stringify(payload);if(json.length<2048||Buffer.byteLength(json)>MAX_BYTES)return record;
 const data=gzipSync(json,{level:1}).toString('base64');if(data.length>=json.length*.9)return record;
 const next={...record,archivedFields:{encoding:'gzip-base64-v1',data,keys:Object.keys(payload)}};
 for(const key of Object.keys(payload))delete next[key];return next;
}
export function restoreArchivedFields(record) {
 if(!record?.archivedFields)return record;
 const {archivedFields,...plain}=record;
 if(archivedFields.encoding!=='gzip-base64-v1')throw Error('Unsupported history archive');
 return {...plain,...JSON.parse(gunzipSync(Buffer.from(archivedFields.data,'base64'),{maxOutputLength:MAX_BYTES}).toString('utf8'))};
}
export function battleSummary(record) {
 const {broadcasts,broadcast,archivedFields,...summary}=record;
 return {...summary,hasDetailedReport:Boolean(broadcasts?.length||broadcast||archivedFields?.keys?.some(k=>k==='broadcasts'||k==='broadcast'))};
}
