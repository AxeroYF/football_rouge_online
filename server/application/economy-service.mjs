import crypto from "node:crypto";
import { GOLD_LEDGER_LIMIT, STARTING_GOLD } from "../../shared/config/economy.mjs";

function normalizeReason(value, { fallback = null } = {}) {
  const reason = String(value ?? fallback ?? "").trim();
  if (!reason) throw new Error("金币变动原因至少需要1个字符");
  if (reason.length > 64) throw new Error("金币变动原因不能超过64个字符");
  return reason;
}

export class EconomyService {
  constructor({
    now = Date.now,
    startingGold = STARTING_GOLD,
    ledgerLimit = GOLD_LEDGER_LIMIT,
    createEntryId = () => `gold:${crypto.randomBytes(8).toString("hex")}`,
  } = {}) {
    this.now = now;
    this.startingGold = startingGold;
    this.ledgerLimit = ledgerLimit;
    this.createEntryId = createEntryId;
  }

  migrateAccount(account) {
    if (!Number.isSafeInteger(account.gold) || account.gold < 0) {
      account.gold = this.startingGold;
      account.goldLedger = [...(Array.isArray(account.goldLedger) ? account.goldLedger : []), {
        id: this.createEntryId(),
        delta: this.startingGold,
        balance: this.startingGold,
        reason: "test-starting-balance",
        createdAt: this.now(),
      }].slice(-this.ledgerLimit);
      return true;
    }
    if (!Array.isArray(account.goldLedger)) {
      account.goldLedger = [];
      return true;
    }
    return false;
  }

  adjust(account, deltaValue, reasonValue = "system") {
    const delta = Number(deltaValue);
    if (!Number.isSafeInteger(delta) || delta === 0) throw new Error("金币变动必须是非零整数");
    const balance = Number(account.gold ?? 0) + delta;
    if (!Number.isSafeInteger(balance) || balance < 0) throw new Error("金币不足");
    const reason = normalizeReason(reasonValue, { fallback: "system" });
    account.gold = balance;
    account.goldLedger ??= [];
    account.goldLedger.push({
      id: this.createEntryId(),
      delta,
      balance,
      reason,
      createdAt: this.now(),
    });
    account.goldLedger = account.goldLedger.slice(-this.ledgerLimit);
    return { gold: balance };
  }

  spend(account, amountValue, reasonValue) {
    const amount = Number(amountValue);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("金币支出必须是正整数");
    return this.adjust(account, -amount, reasonValue);
  }
}
