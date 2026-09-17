import { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export const MIN_STAKE = 25;
const MAX_STAKE = 1_000_000_000;

export class InsufficientFundsError extends Error {
  constructor() {
    super("Insufficient funds");
    this.name = "InsufficientFundsError";
  }
}

export class BettingClosedError extends Error {
  constructor() {
    super("Betting is closed for this match");
    this.name = "BettingClosedError";
  }
}

/** Parses a user-typed stake. Returns null when invalid or below the minimum. */
export function parseStake(raw: string | number | null | undefined): number | null {
  const value = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isInteger(value) || value < MIN_STAKE || value > MAX_STAKE) {
    return null;
  }
  return value;
}

export function isMatchOpenForBetting(
  match: { status: string; beginAt: Date } | null | undefined
): boolean {
  return (
    !!match &&
    match.status === "not_started" &&
    new Date(match.beginAt).getTime() > Date.now()
  );
}

/**
 * Atomically removes `amount` points from a user. The balance check and the
 * decrement happen in a single UPDATE, so concurrent requests cannot overspend.
 */
export async function debitPoints(tx: Tx, userId: string, amount: number) {
  const result = await tx.user.updateMany({
    where: { id: userId, points: { gte: amount } },
    data: { points: { decrement: amount } },
  });
  if (result.count === 0) {
    throw new InsufficientFundsError();
  }
}

export async function creditPoints(tx: Tx, userId: string, amount: number) {
  if (amount <= 0) return;
  await tx.user.update({
    where: { id: userId },
    data: { points: { increment: amount } },
  });
}

/** Re-reads the match inside the transaction and refuses closed matches. */
export async function assertMatchOpenForBetting(tx: Tx, matchId: string) {
  const match = await tx.match.findUnique({ where: { id: matchId } });
  if (!isMatchOpenForBetting(match)) {
    throw new BettingClosedError();
  }
  return match!;
}
