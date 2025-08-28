import { PrismaClient } from "@prisma/client";
import { logger } from "./logger";

const prisma = new PrismaClient();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function calculateBaseOddsFromHistory(
  opponentName: string
): Promise<{ kcOdds: number; opponentOdds: number }> {
  try {
    const now = Date.now();
    const since = new Date();
    since.setMonth(since.getMonth() - 18);

    const pastMatches = await prisma.match.findMany({
      where: {
        opponent: opponentName,
        status: "announced",
        score: { not: null },
        beginAt: { gte: since },
      },
      orderBy: { beginAt: "desc" },
      take: 50,
    });

    if (pastMatches.length === 0) {
      return { kcOdds: 2.0, opponentOdds: 2.0 };
    }

    let strengthSum = 0;
    let weightSum = 0;

    for (const match of pastMatches) {
      if (!match.score) continue;
      const [kcScore, opponentScore] = match.score.split("-").map(Number);
      if (isNaN(kcScore) || isNaN(opponentScore)) continue;
      const maxWins = Math.ceil((match.numberOfGames || 1) / 2);
      const margin = Math.abs(kcScore - opponentScore);
      const marginFactor = clamp(margin / maxWins, 0, 1);
      const seriesWeight = clamp((match.numberOfGames || 1) / 5, 0.2, 1);
      const ageDays = (now - new Date(match.beginAt).getTime()) / 86_400_000;
      const recencyWeight = Math.exp(-ageDays / 180);
      const w = recencyWeight * seriesWeight * marginFactor;
      const signed =
        kcScore > opponentScore ? 1 : kcScore < opponentScore ? -1 : 0;
      strengthSum += signed * w;
      weightSum += recencyWeight * seriesWeight;
    }

    if (weightSum === 0) {
      return { kcOdds: 2.0, opponentOdds: 2.0 };
    }

    const normalizedStrength = strengthSum / weightSum; // roughly in [-1, 1]
    const pKC = clamp(logistic(2.0 * normalizedStrength), 0.05, 0.95);
    const kcOdds = round2(clamp(1 / pKC, 1.1, 5.0));
    const opponentOdds = round2(clamp(1 / (1 - pKC), 1.1, 5.0));

    return { kcOdds, opponentOdds };
  } catch (error) {
    logger.error("Error calculating base odds from history:", error);
    return { kcOdds: 2.0, opponentOdds: 2.0 };
  }
}

export function getPossibleScores(numberOfGames: number): string[] {
  const maxWins = Math.ceil(numberOfGames / 2);
  const possibleScores: string[] = [];
  for (let kcWins = 0; kcWins <= maxWins; kcWins++) {
    for (let opponentWins = 0; opponentWins <= maxWins; opponentWins++) {
      if (
        kcWins + opponentWins <= numberOfGames &&
        (kcWins === maxWins || opponentWins === maxWins)
      ) {
        possibleScores.push(`${kcWins}-${opponentWins}`);
      }
    }
  }
  return possibleScores;
}

export async function calculateScoreOdds(
  opponentName: string,
  numberOfGames: number
): Promise<{ [key: string]: number }> {
  try {
    const now = Date.now();
    const since = new Date();
    since.setMonth(since.getMonth() - 24);

    const pastMatches = await prisma.match.findMany({
      where: {
        opponent: opponentName,
        status: "announced",
        score: { not: null },
        numberOfGames: numberOfGames,
        beginAt: { gte: since },
      },
      orderBy: { beginAt: "desc" },
      take: 100,
    });

    const possibleScores = getPossibleScores(numberOfGames);
    const counts: { [key: string]: number } = {};
    let kcWinWeight = 0;
    let oppWinWeight = 0;

    for (const match of pastMatches) {
      if (!match.score) continue;
      const [kcScore, opponentScore] = match.score.split("-").map(Number);
      if (isNaN(kcScore) || isNaN(opponentScore)) continue;
      const ageDays = (now - new Date(match.beginAt).getTime()) / 86_400_000;
      const recencyWeight = Math.exp(-ageDays / 240);
      const key = `${kcScore}-${opponentScore}`;
      counts[key] = (counts[key] || 0) + recencyWeight;
      if (kcScore > opponentScore) kcWinWeight += recencyWeight;
      if (opponentScore > kcScore) oppWinWeight += recencyWeight;
    }

    const prior: { [key: string]: number } = {};
    for (const s of possibleScores) {
      const [a, b] = s.split("-").map(Number);
      const margin = Math.abs(a - b);
      prior[s] = Math.exp(-0.7 * margin);
    }

    const biasRaw =
      kcWinWeight + oppWinWeight > 0
        ? (kcWinWeight - oppWinWeight) / (kcWinWeight + oppWinWeight)
        : 0;
    const bias = clamp(biasRaw * 0.3, -0.3, 0.3);

    const alpha =
      2 + Math.log(1 + Object.values(counts).reduce((a, b) => a + b, 0));
    const probs: { [key: string]: number } = {};
    let z = 0;
    for (const s of possibleScores) {
      const base = (counts[s] || 0) + alpha * prior[s];
      const [a, b] = s.split("-").map(Number);
      const dir = a > b ? 1 : a < b ? -1 : 0;
      const biased = base * (1 + bias * dir);
      probs[s] = Math.max(biased, 1e-6);
      z += probs[s];
    }
    for (const s of possibleScores) probs[s] /= z;

    const odds: { [key: string]: number } = {};
    for (const s of possibleScores) {
      const p = clamp(probs[s], 0.01, 0.9);
      odds[s] = round2(clamp(1 / p, 1.1, 15));
    }
    return odds;
  } catch (error) {
    logger.error("Error calculating score odds:", error);
    const possibleScores = getPossibleScores(numberOfGames);
    const fallback: { [key: string]: number } = {};
    let z = 0;
    const prior: { [key: string]: number } = {};
    for (const s of possibleScores) {
      const [a, b] = s.split("-").map(Number);
      const margin = Math.abs(a - b);
      prior[s] = Math.exp(-0.7 * margin);
      z += prior[s];
    }
    for (const s of possibleScores) {
      const p = prior[s] / z;
      fallback[s] = round2(clamp(1 / clamp(p, 0.01, 0.9), 1.1, 15));
    }
    return fallback;
  }
}

export function calculateDynamicOdds(
  baseKcOdds: number,
  baseOpponentOdds: number,
  kcTotalAmount: number,
  opponentTotalAmount: number
): { kcOdds: number; opponentOdds: number } {
  const eps = 1e-6;
  const total = kcTotalAmount + opponentTotalAmount;
  const p0k = 1 / baseKcOdds;
  const p0o = 1 / baseOpponentOdds;
  const norm = p0k + p0o;
  let pk = norm > 0 ? p0k / norm : 0.5;
  const q = total > 0 ? kcTotalAmount / total : 0.5;
  const kappa = 3000; // half-weight point
  const w = total > 0 ? clamp(total / (total + kappa), 0, 0.9) : 0;
  const p = clamp((1 - w) * pk + w * q, 0.05, 0.95);
  const kcOdds = round2(clamp(1 / p, 1.1, 5.0));
  const opponentOdds = round2(clamp(1 / (1 - p), 1.1, 5.0));
  return { kcOdds, opponentOdds };
}
