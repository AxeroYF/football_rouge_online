export function convertS4Accounts(source) {
  if (!source?.accounts || typeof source.accounts !== 'object' || Array.isArray(source.accounts)) throw new Error('S4 文件缺少 accounts 对象');
  const accounts = Object.create(null), names = new Set();
  for (const sourceAccount of Object.values(source.accounts)) {
    const { id, nickname, passwordHash, createdAt } = sourceAccount;
    if (typeof id !== 'string' || !/^[a-z0-9_-]{1,64}$/i.test(id) || Object.hasOwn(accounts, id)) throw new Error('S4 账号 ID 无效或重复');
    if (typeof nickname !== 'string' || !nickname.length || nickname.length > 128 || names.has(nickname)) throw new Error('S4 昵称无效或重复');
    if (typeof passwordHash !== 'string' || !/^scrypt\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/.test(passwordHash)) throw new Error('S4 账号缺少兼容的密码哈希，请先核对源文件');
    names.add(nickname);
    accounts[id] = {
      id, nickname, passwordHash, passwordSalt: null, token: null,
      createdAt: Number.isFinite(createdAt) ? createdAt : 0, lastSeenAt: 0,
      setupComplete: false, homeTerritoryId: null, draft: null, expeditionPiece: null,
      importedFrom: 'S4-final',
    };
  }
  if (!Object.keys(accounts).length) throw new Error('S4 账号库为空');
  return { version: 4, accounts, world: null };
}
