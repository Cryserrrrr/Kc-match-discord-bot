import {
  PrismaClient,
  Bet,
  Parlay,
  Duel,
  TournamentStatus,
} from "@prisma/client";
import { logger } from "./logger";

export class TournamentUtils {
  constructor(private prisma: PrismaClient) {}

  async getCurrentOrMostRecentTournament(guildId: string) {
    const now = new Date();
    const active = await this.prisma.tournament.findFirst({
      where: { guildId, status: { in: ["REGISTRATION", "ACTIVE"] } as any },
      orderBy: { createdAt: "desc" },
    });
    if (active) {
      if (
        active.status === "REGISTRATION" &&
        active.registrationEndsAt <= now
      ) {
        const updated = await this.prisma.tournament.update({
          where: { id: active.id },
          data: { status: "ACTIVE" as any, startsAt: active.startsAt ?? now },
        });
        return updated;
      }
      return active;
    }
    const recent = await this.prisma.tournament.findFirst({
      where: { guildId },
      orderBy: [{ createdAt: "desc" }],
    });
    return recent;
  }

  async getActiveTournament(guildId: string) {
    const now = new Date();
    const t = await this.prisma.tournament.findFirst({
      where: {
        guildId,
        status: "ACTIVE" as any,
        AND: [{ OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
      },
      orderBy: { createdAt: "desc" },
    });
    return t || null;
  }

  async isUserParticipant(tournamentId: string, userId: string) {
    const p = await this.prisma.tournamentParticipant.findUnique({
      where: { tournamentId_userId: { tournamentId, userId } as any },
    } as any);
    return !!p;
  }

  async joinTournament(tournamentId: string, userId: string) {
    const t = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
    });
    if (!t || (t.status as any) !== "REGISTRATION")
      throw new Error("Tournoi non disponible pour inscription");
    await this.prisma.tournamentParticipant.upsert({
      where: { tournamentId_userId: { tournamentId, userId } as any },
      update: {},
      create: { tournamentId, userId },
    } as any);
  }

  async linkBetIfEligible(
    guildId: string,
    userId: string,
    betId: string,
    createdAt: Date
  ) {
    try {
      const t = await this.getActiveTournament(guildId);
      if (!t) return;
      if (t.startsAt && createdAt < t.startsAt) return;
      if (t.endsAt && createdAt > t.endsAt) return;
      const participant = await this.prisma.tournamentParticipant.findUnique({
        where: { tournamentId_userId: { tournamentId: t.id, userId } as any },
      } as any);
      if (!participant) return;
      await this.prisma.tournamentBet.upsert({
        where: { betId },
        update: {},
        create: { tournamentId: t.id, betId },
      });
    } catch (e) {
      logger.error("Error linking bet to tournament:", e);
    }
  }

  async linkParlayIfEligible(
    guildId: string,
    userId: string,
    parlayId: string,
    createdAt: Date
  ) {
    try {
      const t = await this.getActiveTournament(guildId);
      if (!t) return;
      if (t.startsAt && createdAt < t.startsAt) return;
      if (t.endsAt && createdAt > t.endsAt) return;
      const participant = await this.prisma.tournamentParticipant.findUnique({
        where: { tournamentId_userId: { tournamentId: t.id, userId } as any },
      } as any);
      if (!participant) return;
      await this.prisma.tournamentParlay.upsert({
        where: { parlayId },
        update: {},
        create: { tournamentId: t.id, parlayId },
      });
    } catch (e) {
      logger.error("Error linking parlay to tournament:", e);
    }
  }

  async linkDuelIfEligible(
    guildId: string,
    challengerId: string,
    opponentId: string,
    duelId: string,
    createdAt: Date
  ) {
    try {
      const t = await this.getActiveTournament(guildId);
      if (!t) return;
      if (t.startsAt && createdAt < t.startsAt) return;
      if (t.endsAt && createdAt > t.endsAt) return;
      const c = await this.prisma.tournamentParticipant.findUnique({
        where: {
          tournamentId_userId: {
            tournamentId: t.id,
            userId: challengerId,
          } as any,
        },
      } as any);
      const o = await this.prisma.tournamentParticipant.findUnique({
        where: {
          tournamentId_userId: {
            tournamentId: t.id,
            userId: opponentId,
          } as any,
        },
      } as any);
      if (!c || !o) return;
      await this.prisma.tournamentDuel.upsert({
        where: { duelId },
        update: {},
        create: { tournamentId: t.id, duelId },
      });
    } catch (e) {
      logger.error("Error linking duel to tournament:", e);
    }
  }

  private async getTournamentByLinkedBet(betId: string) {
    const link = await this.prisma.tournamentBet.findUnique({
      where: { betId },
    });
    if (!link) return null;
    return this.prisma.tournament.findUnique({
      where: { id: link.tournamentId },
    });
  }

  private async getTournamentByLinkedParlay(parlayId: string) {
    const link = await this.prisma.tournamentParlay.findUnique({
      where: { parlayId },
    });
    if (!link) return null;
    return this.prisma.tournament.findUnique({
      where: { id: link.tournamentId },
    });
  }

  private async getTournamentByLinkedDuel(duelId: string) {
    const link = await this.prisma.tournamentDuel.findUnique({
      where: { duelId },
    });
    if (!link) return null;
    return this.prisma.tournament.findUnique({
      where: { id: link.tournamentId },
    });
  }

  async recordBetResolution(bet: Bet) {
    try {
      const tournament = await this.getTournamentByLinkedBet(bet.id);
      if (!tournament) return;
      const virtualStake = tournament.virtualStake;
      if (bet.status === "WON") {
        const profit = Math.floor(virtualStake * (bet.odds - 1));
        await this.prisma.tournamentParticipant.update({
          where: {
            tournamentId_userId: {
              tournamentId: tournament.id,
              userId: bet.userId,
            } as any,
          },
          data: { points: { increment: profit }, betsWon: { increment: 1 } },
        } as any);
      } else if (bet.status === "LOST") {
        await this.prisma.tournamentParticipant.update({
          where: {
            tournamentId_userId: {
              tournamentId: tournament.id,
              userId: bet.userId,
            } as any,
          },
          data: {
            points: { decrement: virtualStake },
            betsLost: { increment: 1 },
          },
        } as any);
      }
    } catch (e) {
      logger.error("Error recording bet resolution in tournament:", e);
    }
  }

  async recordParlayResolution(parlay: Parlay) {
    try {
      const tournament = await this.getTournamentByLinkedParlay(parlay.id);
      if (!tournament) return;
      const virtualStake = tournament.virtualStake;
      if (parlay.status === "WON") {
        const profit = Math.floor(virtualStake * (parlay.totalOdds - 1));
        await this.prisma.tournamentParticipant.update({
          where: {
            tournamentId_userId: {
              tournamentId: tournament.id,
              userId: parlay.userId,
            } as any,
          },
          data: { points: { increment: profit }, parlaysWon: { increment: 1 } },
        } as any);
      } else if (parlay.status === "LOST") {
        await this.prisma.tournamentParticipant.update({
          where: {
            tournamentId_userId: {
              tournamentId: tournament.id,
              userId: parlay.userId,
            } as any,
          },
          data: {
            points: { decrement: virtualStake },
            parlaysLost: { increment: 1 },
          },
        } as any);
      }
    } catch (e) {
      logger.error("Error recording parlay resolution in tournament:", e);
    }
  }

  async recordDuelResolution(duel: Duel) {
    try {
      const tournament = await this.getTournamentByLinkedDuel(duel.id);
      if (!tournament) return;
      if (!duel.winnerUserId) return;
      const virtualStake = tournament.virtualStake;
      const loserId =
        duel.winnerUserId === duel.challengerId
          ? duel.opponentId
          : duel.challengerId;
      await this.prisma.tournamentParticipant.updateMany({
        where: { tournamentId: tournament.id, userId: duel.winnerUserId },
        data: {
          points: { increment: virtualStake },
          duelsWon: { increment: 1 },
        },
      });
      await this.prisma.tournamentParticipant.updateMany({
        where: { tournamentId: tournament.id, userId: loserId },
        data: {
          points: { decrement: virtualStake },
          duelsLost: { increment: 1 },
        },
      });
    } catch (e) {
      logger.error("Error recording duel resolution in tournament:", e);
    }
  }
}
