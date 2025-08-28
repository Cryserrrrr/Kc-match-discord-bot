import { prisma } from "../index";
import { logger } from "./logger";
import {
  calculateBaseOddsFromHistory,
  calculateDynamicOdds,
  calculateScoreOdds,
} from "./oddsCalculator";

export async function ensureUser(userId: string, username: string) {
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (existing) return existing;
  return prisma.user.create({
    data: { id: userId, username, points: 1000 },
  });
}

export async function getMatchOrThrow(matchId: string) {
  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match) throw new Error("Match not found");
  return match;
}

export function isMatchBettable(match: any) {
  return match.status === "not_started" && match.beginAt > new Date();
}

export async function getTeamOddsForMatch(matchId: string) {
  const match = await getMatchOrThrow(matchId);
  const allBets = (await prisma.bet.findMany({ where: { matchId } })) as any[];
  const kcBets = allBets.filter(
    (b: any) => b.type === "TEAM" && b.selection === match.kcTeam
  );
  const oppBets = allBets.filter(
    (b: any) => b.type === "TEAM" && b.selection === match.opponent
  );
  const kcTotal = kcBets.reduce((s, b) => s + b.amount, 0);
  const oppTotal = oppBets.reduce((s, b) => s + b.amount, 0);
  const base = await calculateBaseOddsFromHistory(match.opponent);
  const dyn = calculateDynamicOdds(
    base.kcOdds,
    base.opponentOdds,
    kcTotal,
    oppTotal
  );
  return { match, base, dyn };
}

export async function getScoreOddsForMatch(matchId: string) {
  const match = await getMatchOrThrow(matchId);
  const scoreOdds = await calculateScoreOdds(
    match.opponent,
    match.numberOfGames
  );
  return { match, scoreOdds };
}

export function multiplyOdds(odds: number[]): number {
  return odds.reduce((acc, o) => acc * o, 1);
}
