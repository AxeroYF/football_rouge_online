import {fogGeometryKey} from '../../shared/map/fog-spatial.mjs';
// Updated once per snapshot; terrain can ask thousands of area questions.
export function createFogAreaVisibility(index) {
 let key=null,models=null,enabled=false;
 return {
  update(fog){
   const next=JSON.stringify([Boolean(fog.enabled),fogGeometryKey(fog)]);
   if(next===key)return false;
   enabled=Boolean(fog.enabled);models=enabled?index.models(fog):null;key=next;return true;
  },
  isVisible(bounds){return !enabled||index.touchesLand(models.current,bounds)||index.touchesLand(models.explored,bounds);},
 };
}
