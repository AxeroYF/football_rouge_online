export const FACTORY_OIL_PER_HOUR=1;
export const FACTORY_OIL_BONUS_PERCENT=20;
export function factoryOilSupply(account){
 const oil=account?.oil,balance=oil?.balance??0,productionPerHour=oil?.hourly??0;
 const active=balance>0||productionPerHour>=FACTORY_OIL_PER_HOUR;
 return {balance,productionPerHour,requiredPerHour:FACTORY_OIL_PER_HOUR,active,bonusPercent:active?FACTORY_OIL_BONUS_PERCENT:0};
}
