import { prisma } from "../index";
import { logger } from "./logger";
import { Client } from "discord.js";

export class TitleManager {
  private static async getOrCreateTitle(name: string) {
    let title = await prisma.title.findUnique({ where: { name } });
    if (!title) {
      try {
        title = await prisma.title.create({ data: { name } });
        logger.info(`Title created: ${name}`);
      } catch (e) {
        logger.error("Error creating title:", e);
      }
    }
    return title;
  }

  static async unlockTitle(
    userId: string,
    titleName: string,
    client?: Client
  ): Promise<boolean> {
    try {
      const title = await this.getOrCreateTitle(titleName);
      if (!title) {
        logger.warn(`Title "${titleName}" not found and could not be created`);
        return false;
      }

      const profile = await prisma.userProfile.upsert({
        where: { userId },
        update: {},
        create: { userId },
      });

      try {
        await prisma.userUnlockedTitle.upsert({
          where: { userId_titleId: { userId, titleId: title.id } },
          update: {},
          create: { userId, titleId: title.id },
        } as any);
      } catch (e) {
        logger.error("Error upserting user unlocked title:", e);
      }

      if (profile.titleId !== title.id) {
        await prisma.userProfile.update({
          where: { userId },
          data: { titleId: title.id },
        });
      }

      logger.info(`Title "${titleName}" unlocked for user ${userId}`);

      if (client) {
        try {
          const user = await client.users.fetch(userId);
          await user.send({
            content: `🎉 **Nouveau titre débloqué !**\n\nVous avez débloqué le titre **${titleName}** !\n\nUtilisez \`/settitle\` pour l'équiper sur votre profil.`,
          });
        } catch (dmError) {
          logger.warn(
            `Could not send DM to user ${userId} for title unlock:`,
            dmError
          );
        }
      }

      return true;
    } catch (error) {
      logger.error(
        `Error unlocking title "${titleName}" for user ${userId}:`,
        error
      );
      return false;
    }
  }

  static async unlockHighOddsTeamWin(
    userId: string,
    odds: number,
    client?: Client
  ) {
    if (odds > 3) return this.unlockTitle(userId, "Prise de Risque", client);
    return false;
  }

  static async unlockBetCountMilestone(userId: string, client?: Client) {
    const count = await prisma.bet.count({ where: { userId } });
    const map: Record<number, string> = {
      25: "Parieur Bronze",
      50: "Parieur Argent",
      100: "Parieur Or",
      500: "Parieur Légende",
    };
    const name = map[count as keyof typeof map];
    if (name) return this.unlockTitle(userId, name, client);
    return false;
  }

  static async unlockDuelWinMilestone(userId: string, client?: Client) {
    const wins = await prisma.duel.count({
      where: { status: "RESOLVED" as any, winnerUserId: userId },
    } as any);
    const map: Record<number, string> = {
      10: "Duelliste Bronze",
      25: "Duelliste Argent",
      50: "Duelliste Or",
      100: "Maître Duelliste",
    };
    const name = map[wins as keyof typeof map];
    if (name) return this.unlockTitle(userId, name, client);
    return false;
  }

  static async unlockParlayLegsTitle(
    userId: string,
    legs: number,
    client?: Client
  ) {
    if (legs > 10)
      return this.unlockTitle(userId, "Maestro du Combiné", client);
    return false;
  }

  static async unlockParlayHighOddsTitle(
    userId: string,
    totalOdds: number,
    client?: Client
  ) {
    if (totalOdds > 20) return this.unlockTitle(userId, "Jackpot", client);
    return false;
  }

  static async unlockTransferAmountTitle(
    userId: string,
    amount: number,
    client?: Client
  ) {
    if (amount >= 100000)
      return this.unlockTitle(userId, "Mécène 100K", client);
    if (amount >= 50000) return this.unlockTitle(userId, "Mécène 50K", client);
    if (amount >= 10000) return this.unlockTitle(userId, "Mécène 10K", client);
    return false;
  }

  static async unlockDailyMaxStreak(userId: string, client?: Client) {
    return this.unlockTitle(userId, "Organisé", client);
  }

  static async unlockTournamentPlacementTitle(
    userId: string,
    place: number,
    client?: Client
  ) {
    if (place === 1) return this.unlockTitle(userId, "Champion", client);
    if (place === 2) return this.unlockTitle(userId, "Vice-Champion", client);
    if (place === 3) return this.unlockTitle(userId, "Troisième", client);
    return false;
  }

  static async unlockWealthTitle(userId: string, client?: Client) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user && user.points >= 1_000_000) {
      return this.unlockTitle(userId, "Rothschild", client);
    }
    return false;
  }

  private static getStreakTitle(
    thresholds: number[],
    current: number,
    labels: Record<number, string>
  ) {
    const sorted = thresholds.sort((a, b) => a - b);
    let title: string | null = null;
    for (const t of sorted) {
      if (current === t) title = labels[t];
    }
    return title;
  }

  static async unlockBetWinStreak(userId: string, client?: Client) {
    const bets = await prisma.bet.findMany({
      where: { userId, status: { in: ["WON", "LOST"] as any } },
      orderBy: { updatedAt: "desc" },
    } as any);
    let streak = 0;
    for (const b of bets) {
      if ((b as any).status === "WON") streak++;
      else break;
    }
    const labels: Record<number, string> = {
      5: "Bet Warrior",
      10: "Bet Prince",
      25: "Bet King",
      50: "Bet God",
    };
    const name = this.getStreakTitle([5, 10, 25, 50], streak, labels);
    if (name) return this.unlockTitle(userId, name, client);
    return false;
  }

  static async unlockDuelWinStreak(userId: string, client?: Client) {
    const duels = await prisma.duel.findMany({
      where: {
        status: "RESOLVED" as any,
        OR: [{ challengerId: userId }, { opponentId: userId }],
      },
      orderBy: { updatedAt: "desc" },
      select: { winnerUserId: true },
    } as any);
    let streak = 0;
    for (const d of duels) {
      if (d.winnerUserId === userId) streak++;
      else break;
    }
    const labels: Record<number, string> = {
      5: "Duellist Warrior",
      10: "Duellist Prince",
      25: "Duellist King",
      50: "Duellist God",
    };
    const name = this.getStreakTitle([5, 10, 25, 50], streak, labels);
    if (name) return this.unlockTitle(userId, name, client);
    return false;
  }

  static async unlockParlayWinStreak(userId: string, client?: Client) {
    const parlays = await prisma.parlay.findMany({
      where: { userId, status: { in: ["WON", "LOST"] as any } },
      orderBy: { updatedAt: "desc" },
      select: { status: true },
    } as any);
    let streak = 0;
    for (const p of parlays) {
      if ((p as any).status === "WON") streak++;
      else break;
    }
    const labels: Record<number, string> = {
      5: "Combiner Warrior",
      10: "Combiner Prince",
      25: "Combiner King",
      50: "Combiner God",
    };
    const name = this.getStreakTitle([5, 10, 25, 50], streak, labels);
    if (name) return this.unlockTitle(userId, name, client);
    return false;
  }

  static async unlockFirstDailyTitle(
    userId: string,
    client?: Client
  ): Promise<boolean> {
    const existingRewards = await prisma.dailyReward.count({
      where: { userId },
    });

    if (existingRewards === 1) {
      return await this.unlockTitle(userId, "Débutant", client);
    }

    return false;
  }

  static async unlockFirstBetTitle(
    userId: string,
    client?: Client
  ): Promise<boolean> {
    const existingBets = await prisma.bet.count({
      where: { userId },
    });

    if (existingBets === 1) {
      return await this.unlockTitle(userId, "Parieur", client);
    }

    return false;
  }

  static async unlockFirstParlayTitle(
    userId: string,
    client?: Client
  ): Promise<boolean> {
    const existingParlays = await prisma.parlay.count({
      where: { userId },
    });

    if (existingParlays === 1) {
      return await this.unlockTitle(userId, "Stratège", client);
    }

    return false;
  }

  static async unlockFirstDuelTitle(
    userId: string,
    client?: Client
  ): Promise<boolean> {
    const existingDuels = await prisma.duel.count({
      where: {
        OR: [{ challengerId: userId }, { opponentId: userId }],
        status: "ACCEPTED",
      },
    });

    if (existingDuels === 1) {
      return await this.unlockTitle(userId, "Gladiateur", client);
    }

    return false;
  }

  static async getUnlockedTitles(userId: string): Promise<string[]> {
    const unlocks = await prisma.userUnlockedTitle.findMany({
      where: { userId },
      include: { title: { select: { name: true } } },
    } as any);
    return unlocks
      .map((u: any) => u.title?.name)
      .filter((n: string | undefined): n is string => Boolean(n));
  }

  static async unlockBetterMetaTitle(userId: string, client?: Client) {
    const required = ["Combiner God", "Duellist God", "Bet God"];
    const titles = await prisma.title.findMany({
      where: { name: { in: required } },
      select: { id: true, name: true },
    });
    if (titles.length !== required.length) return false;
    const owned = await this.getUnlockedTitles(userId);
    if (required.every((n) => owned.includes(n))) {
      return this.unlockTitle(userId, "Better", client);
    }
    return false;
  }
}
