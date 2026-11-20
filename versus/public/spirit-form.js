export function possessionAnnouncement(player) {
  return player.name + ' 发动「请神上身」，本场化身为 S 级 ' + player.spiritForm.name + ' +4！';
}

export function spectatorCardPlayer(player) {
  if (!player.spiritForm) return player;
  const form = player.spiritForm;
  return {...player, id:form.id, name:form.name, role:form.role, grade:'S', legendary:true, xPlayer:false,
    upgradeLevel:4, cardProfile:form.cardProfile ?? null};
}
