// Deferred immutable reports keep the persisted body out of the state tree.
// A write through a returned view makes a private copy and pins it on the record,
// so edits remain durable without mutating another reader's cached report.
const DEFERRED = new WeakMap();

export function reportMetadata(report) {
  return {hasDetails:Boolean(report),hasTacticalReview:Boolean(report?.tacticalReview),engineVersion:report?.engineVersion??null,engineProfile:report?.engineProfile??null,hasDotReplay:Boolean(report?.dotReplay?.frames?.length)};
}
export function deferredReport(record) { return DEFERRED.get(record) ?? null; }

function mutableView(record,info,original) {
  let copied=null;
  const copies=new WeakMap(),sources=new WeakMap(),proxies=new WeakMap();
  const object=value=>value!==null&&typeof value==='object';
  function copy(value) {
    if(!object(value))return value;
    if(copies.has(value))return copies.get(value);
    const next=Array.isArray(value)?[]:{};copies.set(value,next);sources.set(next,value);
    for(const key of Object.keys(value))next[key]=copy(value[key]);
    return next;
  }
  function edit() {
    if(copied)return;
    copied=copy(original);
    if(DEFERRED.get(record)===info){
      DEFERRED.delete(record);
      Object.defineProperty(record,'report',{value:copied,writable:true,enumerable:true,configurable:true});
    }
  }
  function wrap(value) {
    if(!object(value))return value;
    const source=sources.get(value)??value;
    if(proxies.has(source))return proxies.get(source);
    const current=()=>copies.get(source)??source;
    const proxy=new Proxy(source,{
      get(_target,key){return wrap(Reflect.get(current(),key));},
      has(_target,key){return Reflect.has(current(),key);},
      ownKeys(){return Reflect.ownKeys(current());},
      getOwnPropertyDescriptor(_target,key){return Reflect.getOwnPropertyDescriptor(current(),key);},
      set(_target,key,next){edit();return Reflect.set(current(),key,next);},
      deleteProperty(_target,key){edit();return Reflect.deleteProperty(current(),key);},
      defineProperty(_target,key,descriptor){
        if(descriptor.configurable===false)throw new TypeError('Deferred report properties must remain configurable');
        edit();return Reflect.defineProperty(current(),key,descriptor);
      },
    });
    proxies.set(source,proxy);return proxy;
  }
  return wrap(original);
}

export function attachDeferredReport(record,{reference,metadata=null,read}) {
  const info={reference,metadata,read,view:null};
  DEFERRED.set(record,info);
  Object.defineProperty(record,'report',{
    configurable:true,enumerable:true,
    get(){
      const held=info.view?.deref();if(held)return held;
      const report=mutableView(record,info,read(reference));
      if(report&&typeof report==='object')info.view=new WeakRef(report);return report;
    },
    set(value){DEFERRED.delete(record);Object.defineProperty(record,'report',{value,writable:true,enumerable:true,configurable:true});},
  });
  return record;
}
export function copyDeferredReport(source,destination) {
  const info=DEFERRED.get(source);
  if(info)attachDeferredReport(destination,info);
  return Boolean(info);
}
export function storedReportMetadata(record) {
  const info=DEFERRED.get(record);
  if(info){info.metadata??=reportMetadata(info.read(info.reference));return info.metadata;}
  return reportMetadata(record?.report);
}
