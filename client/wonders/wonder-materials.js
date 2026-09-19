// Shared by every LOD and exported into GLB as standard metallic/roughness materials.
// Original geometry color keys remain stable; art direction is edited here.
export const WONDER_MATERIAL_VERSION = '20260907-color-v2';
const SURFACES = {
  stone: {roughness:.82,metalness:0}, marble:{roughness:.50,metalness:0},
  plaster:{roughness:.72,metalness:0}, clay:{roughness:.86,metalness:0},
  slate:{roughness:.58,metalness:.10}, iron:{roughness:.44,metalness:.72},
  steel:{roughness:.30,metalness:.82}, chrome:{roughness:.20,metalness:.94},
  bronze:{roughness:.48,metalness:.65}, gold:{roughness:.31,metalness:.78},
  glass:{roughness:.15,metalness:.22}, water:{roughness:.18,metalness:.06},
  grass:{roughness:1,metalness:0}, foliage:{roughness:.94,metalness:0},
  wood:{roughness:.88,metalness:0}, paving:{roughness:.90,metalness:0},
  paint:{roughness:.48,metalness:.02}, membrane:{roughness:.68,metalness:0},
  ceramic:{roughness:.34,metalness:0}
};
// Opaque tinted glass/water keeps silhouettes stable at tiny map scales and in all GLB viewers.
const COMMON = {
  '#B8B49D':['#B9AD94','paving'], '#77674C':['#704129','wood'],
  '#657F58':['#27713B','foliage'], '#6B6A5B':['#294C5B','glass']
};
const PROFILES = {
  'eiffel-tower':{
    '#BCBBA3':['#669746','grass'],'#B9AB8D':['#C8AB82','stone'],
    '#776049':['#75482A','iron'],'#A38A67':['#AC7542','iron']
  },
  'colosseum':{
    '#B6AE97':['#AD9776','paving'],'#DACAAB':['#E5BC79','stone'],
    '#BBA982':['#AD7845','stone'],'#C9B993':['#CCA064','stone'],
    '#A6916C':['#997146','stone'],'#AD9F80':['#B18D59','stone'],'#B59A71':['#CDA153','stone']
  },
  'sagrada-familia':{
    '#BDB39A':['#AF987A','paving'],'#CEB182':['#D3A361','stone'],
    '#AB9069':['#945D38','stone'],'#B99B72':['#BA8047','stone'],
    '#E8D2A6':['#EDCB87','stone'],'#C9B078':['#CA9552','stone'],
    '#C6AC6C':['#D4AC46','gold'],'#B49959':['#B86E24','ceramic'],
    '#AC936A':['#8D613E','stone']
  },
  'elizabeth-tower':{
    '#C8B48A':['#CDA263','stone'],'#E3D2AC':['#EED59E','stone'],
    '#43514C':['#153D59','paint'],'#F1E6CC':['#FFF2D5','paint'],
    '#434A42':['#173953','paint'],'#726747':['#BB8A32','gold'],
    '#536057':['#264D65','glass'],'#4D5D56':['#253F55','slate'],
    '#AF9660':['#E0AD3C','gold']
  },
  'brandenburg-gate':{
    '#BAB7A3':['#ABAC99','paving'],'#D0C19E':['#DCC18D','stone'],
    '#BBAC8A':['#BA9760','stone'],'#ACA282':['#BFA26F','stone'],
    '#5E7363':['#31836F','bronze'],'#526757':['#205B4D','bronze']
  },
  'versailles-palace':{
    '#D3C09D':['#D3B077','stone'],'#DDCBA8':['#E5C695','stone'],
    '#D6C19A':['#CC995D','stone'],'#53615C':['#2A435C','slate'],
    '#52605E':['#304F69','slate'],'#C3A567':['#DFB239','gold'],
    '#716852':['#34576A','glass'],'#6D8358':['#3B853A','grass'],
    '#8C9E6A':['#73AA48','grass'],'#536E4B':['#24663C','foliage'],
    '#D3C5A6':['#DFCD9E','paving']
  },
  'louvre':{
    '#D8CBB3':['#D7BC8C','stone'],'#D0C1A5':['#C5A36C','stone'],
    '#56646A':['#304860','slate'],'#8FB1B7':['#378EA8','glass'],
    '#CCDBD3':['#B1D3D6','steel']
  },
  'british-museum':{
    '#BCB49B':['#BFAF93','paving'],'#D8D2BE':['#D9C69D','stone'],
    '#DCD5C1':['#EDDBB3','stone'],'#CEC5AD':['#C2AA7C','stone'],
    '#9BA9A6':['#58766F','slate'],'#C1B79E':['#C7B082','stone'],
    '#A9C1BE':['#66A9BD','glass'],'#D1DBCD':['#D7E4DD','steel'],
    '#C1B496':['#D8BC88','stone'],'#A8B9AF':['#5298A7','glass']
  },
  'alhambra':{
    '#8B9071':['#547B3E','foliage'],'#C2A27A':['#C5A16B','paving'],
    '#B77B55':['#BB603D','clay'],'#CD9B71':['#D28D56','stone'],
    '#895E45':['#8D3F2E','clay'],'#679C98':['#199EAA','water'],
    '#D5AC80':['#E4B57A','stone'],'#DEC5A0':['#F0D59C','marble']
  },
  'acropolis':{
    '#9C9A7F':['#A18C61','stone'],'#C2B493':['#BC9F6D','stone'],
    '#D8C9AA':['#DEBF86','stone'],'#BEAD8F':['#B49663','stone'],
    '#DED1AF':['#EFDAAC','marble'],'#CDBD99':['#D7B77D','stone'],
    '#B5A486':['#AC8857','stone'],'#D6C8A6':['#E6CDA0','marble'],
    '#CAB996':['#C8A36A','stone'],'#C4B08C':['#B8935C','stone'],
    '#CDBF9C':['#D6B77E','stone']
  },
  'belem-tower':{
    '#C8B99A':['#BFA87C','paving'],'#D5C5A5':['#E6CFA0','stone'],
    '#B9AA8C':['#BDA16D','stone'],'#E6D7B9':['#F1DEB5','stone'],
    '#C1B092':['#D5B785','stone'],'#C9BB9C':['#DBC194','stone'],
    '#6E7262':['#3D5E60','glass'],'#6A9695':['#238DAB','water']
  },
  'neuschwanstein':{
    '#8B937B':['#60834A','foliage'],'#E2D9C3':['#EFE1C5','plaster'],
    '#D1C4A8':['#D5B889','stone'],'#BEAD8C':['#B77F51','stone'],
    '#526B75':['#315678','slate'],'#607470':['#254753','glass']
  },
  'atomium':{
    '#9EAA8C':['#4C883A','grass'],'#B9C7C9':['#CCD9E5','chrome'],
    '#849CA0':['#8FA8C2','steel'],'#70868B':['#627F97','steel']
  },
  'pont-du-gard':{
    '#809887':['#658749','grass'],'#598D97':['#268CA3','water'],
    '#CBB182':['#CBA161','stone'],'#DBC396':['#E5C58A','stone'],
    '#B5A078':['#AD8046','stone']
  },
  'leaning-tower-pisa':{
    '#A6B48F':['#62A046','grass'],'#DDD3B7':['#EEE0BD','marble'],
    '#B3A688':['#BCA57C','stone'],'#E7DEC6':['#F8EDD1','marble'],
    '#BCAD8A':['#CFB78C','marble'],'#A19272':['#91764E','stone']
  },
  'santiago-bernabeu':{
    '#A6ABA0':['#83938E','paving'],'#A5B1B5':['#7F96AE','steel'],
    '#B6C0C2':['#AFBECD','steel'],'#657C86':['#344E6B','steel'],
    '#849BB4':['#287CC2','paint'],'#596B83':['#174987','paint'],
    '#CED5D3':['#CBD6E2','steel'],'#C2CECD':['#B2C3D5','steel'],
    '#548543':['#267D35','grass'],'#659854':['#53A342','grass'],
    '#E7E6CB':['#F4F6E5','paint'],'#DEE0CB':['#F2F5EC','paint'],
    '#D2D8D5':['#DBE4EC','steel']
  },
  'christ-the-redeemer':{
    '#7D8D70':['#36723B','foliage'],'#ABA991':['#A39374','stone'],
    '#C5C5B5':['#C9BEA5','stone'],'#C8CCC1':['#D4DAD3','stone'],
    '#CED2C5':['#DDE3D7','stone'],'#D4D6CB':['#E7E9DB','stone'],
    '#B5BCAE':['#A1B3A8','stone']
  },
  'machu-picchu':{
    '#667F59':['#356936','foliage'],'#758465':['#3A793F','foliage'],
    '#83916C':['#58904B','foliage'],'#A7A181':['#998663','stone'],
    '#889B67':['#81B349','grass'],'#779058':['#55983C','grass'],
    '#9A9B79':['#738A45','grass'],'#B1AB8B':['#B4A17C','stone'],
    '#85876B':['#827354','stone'],'#555F4C':['#3E4831','wood'],
    '#ABA98A':['#C4B18B','stone'],'#858F6E':['#8A815B','stone'],
    '#B1AC8C':['#C5B28B','stone']
  },
  'la-moneda':{
    '#E2DBCA':['#E8DBC0','plaster'],'#EBE4D3':['#F1E6CF','plaster'],
    '#CDC3AF':['#CABA99','stone'],'#C5BBA5':['#B49C75','stone'],
    '#EFE9D9':['#F7EDD6','plaster'],'#DFD8C7':['#DBC9A5','plaster'],
    '#A28A6E':['#94513A','clay'],'#D0C7B3':['#D9C6A0','stone'],
    '#7F996B':['#5A9A42','grass'],'#658259':['#2B713E','foliage'],
    '#8A9290':['#6E859B','steel']
  },
  'teatro-colon':{
    '#C0B294':['#B5A17B','paving'],'#D6C19A':['#CFA569','stone'],
    '#C4AF89':['#B88A52','stone'],'#E3CFAB':['#EDCF96','stone'],
    '#DEC9A2':['#DCB980','stone'],'#BDA883':['#AE7D47','stone'],
    '#748176':['#39766D','bronze'],'#72857C':['#438879','bronze'],
    '#607469':['#2A635D','bronze'],'#657570':['#234855','glass'],
    '#63716A':['#2D5160','glass']
  },
  'palacio-salvo':{
    '#C4B595':['#CEAA74','stone'],'#DED0AE':['#EAD09D','stone'],
    '#B8AA8B':['#B9915A','stone'],'#DFCFAC':['#E0BF89','stone'],
    '#7E8777':['#39766B','bronze'],'#889482':['#529885','bronze'],
    '#706E5C':['#345359','glass'],'#776F57':['#2C4952','glass'],
    '#736E58':['#284B59','glass']
  },
  'las-lajas-sanctuary':{
    '#688777':['#3A7D42','foliage'],'#7B8770':['#4F724B','foliage'],
    '#8A8D74':['#6D8055','foliage'],'#608E96':['#238B9D','water'],
    '#A6AA9A':['#879992','stone'],'#BBBCAA':['#B3C0AD','stone'],
    '#C3C7B6':['#D3D8BF','stone'],'#B6BCAD':['#A2B5B0','stone'],
    '#DADACA':['#E5DBC0','stone'],'#616F66':['#334B60','slate'],
    '#778174':['#466377','slate'],'#AEB8A7':['#B9C7C0','steel'],
    '#C6C8B7':['#CAD2BA','stone'],'#8A9285':['#557473','stone'],
    '#728F90':['#3C6FB0','glass']
  },
  'museum-of-tomorrow':{
    '#A9BFB3':['#4EAEAA','paving'],'#6EAAAD':['#1B9CB7','water'],
    '#D5DCCF':['#C5D6CE','paving'],'#759EA0':['#226A87','glass'],
    '#E5E8DC':['#E5EAE3','paint'],'#E7EBDD':['#F2F1E4','paint'],
    '#CEDACE':['#BBCFCD','paint'],'#E3E9DD':['#E6EDE7','paint'],
    '#DDE5D8':['#CFDED6','paint']
  },
  'maracana':{
    '#A2B19A':['#738B6A','paving'],'#BEC7B9':['#B3C7C5','plaster'],
    '#D7DDCE':['#D0DAD2','plaster'],'#799D9C':['#2793C5','paint'],
    '#A1B8B1':['#E6BD36','paint'],'#DDE2D6':['#F1EEDD','membrane'],
    '#B4C2B7':['#ACBEBF','steel'],'#507F40':['#267A35','grass'],
    '#60924D':['#4E9E3B','grass'],'#DFE4C7':['#F8F7E3','paint'],
    '#778B81':['#597D8D','paint']
  }
};
export function wonderMaterial(assetId,originalColor) {
  const colorKey=originalColor.toUpperCase();
  const entry=PROFILES[assetId]?.[colorKey]??COMMON[colorKey];
  if(!entry) throw new Error('Unassigned wonder material: '+assetId+' '+colorKey);
  const [color,surface]=entry;
  return {color,...SURFACES[surface],name:surface+'_'+color.slice(1).toLowerCase(),
    userData:{surface,artVersion:WONDER_MATERIAL_VERSION,sourceColor:colorKey}};
}
export function wonderPalette(assetId) {
  const entries=Object.values(PROFILES[assetId]??{}),seen=new Set(),main=[];
  for(const [color,surface] of entries)if(!seen.has(surface)){seen.add(surface);main.push(color);}
  return [...new Set([...main,...entries.map(v=>v[0])])].slice(0,8);
}

