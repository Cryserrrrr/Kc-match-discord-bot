import { PrismaClient } from "@prisma/client";
import { Client } from "discord.js";
import { logger } from "./logger";
import { TournamentUtils } from "./tournamentUtils";
import { TitleManager } from "./titleManager";

export class ResultProcessor {
  private prisma: PrismaClient;
  private client: Client;

  constructor(prisma: PrismaClient, client: Client) {
    this.prisma = prisma;
    this.client = client;
  }

  async processMatchResults(match: any, score: string) {
    try {
      logger.info(
        `🎲 Processing all results for match: ${match.kcTeam} vs ${match.opponent} (${score})`
      );

      const winner = this.determineWinner(match, score);

      await Promise.all([
        this.processBetResults(match, score, winner),
        this.processDuelResults(match, score, winner),
        this.processParlayResults(match, score, winner),
      ]);

      logger.info(`✅ All results processing completed for match ${match.id}`);
    } catch (error) {
      logger.error(`Error processing results for match ${match.id}:`, error);
      throw error;
    }
  }

  private determineWinner(match: any, score: string): string | null {
    if (!score) return null;

    const [kcScore, opponentScore] = score.split("-").map(Number);

    if (kcScore > opponentScore) {
      return match.kcTeam;
    } else if (opponentScore > kcScore) {
      return match.opponent;
    }

    return null;
  }

  private async processBetResults(
    match: any,
    score: string,
    winner: string | null
  ) {
    try {
      const activeBets = await this.prisma.bet.findMany({
        where: {
          matchId: match.id,
          status: "ACTIVE",
        },
        include: {
          user: true,
        },
      });

      if (activeBets.length === 0) {
        logger.info(`No active bets found for match ${match.id}`);
        return;
      }

      logger.info(`Found ${activeBets.length} active bets to process`);

      if (!winner) {
        logger.info(`Match ended in draw, refunding all bets`);

        for (const bet of activeBets) {
          await this.prisma.bet.update({
            where: { id: bet.id },
            data: { status: "CANCELLED" },
          });

          await this.prisma.user.update({
            where: { id: bet.userId },
            data: { points: bet.user.points + bet.amount },
          });

          logger.info(
            `💰 Refunded ${bet.amount} Perticoin to ${bet.user.username}`
          );
        }
        return;
      }

      const tutils = new TournamentUtils(this.prisma);
      for (const bet of activeBets) {
        if (bet.type === "SCORE") {
          const predictedScore = bet.selection;

          if (predictedScore === score) {
            const winnings = Math.floor(bet.amount * bet.odds);

            await this.prisma.bet.update({
              where: { id: bet.id },
              data: { status: "WON" },
            });

            await this.prisma.user.update({
              where: { id: bet.userId },
              data: { points: bet.user.points + winnings },
            });

            logger.info(
              `🎯 ${bet.user.username} won ${winnings} Perticoin on score bet (predicted: ${predictedScore}, actual: ${score}, bet: ${bet.amount}, odds: ${bet.odds}x)`
            );
            await tutils.recordBetResolution({
              ...(bet as any),
              status: "WON",
            } as any);
            try {
              await TitleManager.unlockBetWinStreak(bet.userId, this.client);
            } catch {}
          } else {
            await this.prisma.bet.update({
              where: { id: bet.id },
              data: { status: "LOST" },
            });

            logger.info(
              `💸 ${bet.user.username} lost ${bet.amount} Perticoin on score bet (predicted: ${predictedScore}, actual: ${score})`
            );
            await tutils.recordBetResolution({
              ...(bet as any),
              status: "LOST",
            } as any);
          }
        } else {
          if (bet.selection === winner) {
            const winnings = Math.floor(bet.amount * bet.odds);

            await this.prisma.bet.update({
              where: { id: bet.id },
              data: { status: "WON" },
            });

            await this.prisma.user.update({
              where: { id: bet.userId },
              data: { points: bet.user.points + winnings },
            });

            logger.info(
              `🎉 ${bet.user.username} won ${winnings} Perticoin (bet: ${bet.amount}, odds: ${bet.odds}x)`
            );
            await tutils.recordBetResolution({
              ...(bet as any),
              status: "WON",
            } as any);
            try {
              await TitleManager.unlockBetWinStreak(bet.userId, this.client);
            } catch {}
          } else {
            await this.prisma.bet.update({
              where: { id: bet.id },
              data: { status: "LOST" },
            });

            logger.info(`💸 ${bet.user.username} lost ${bet.amount} Perticoin`);
            await tutils.recordBetResolution({
              ...(bet as any),
              status: "LOST",
            } as any);
          }
        }
      }
    } catch (error) {
      logger.error(
        `Error processing bet results for match ${match.id}:`,
        error
      );
      throw error;
    }
  }

  private async processDuelResults(
    match: any,
    score: string,
    winner: string | null
  ) {
    try {
      const activeDuels = await this.prisma.duel.findMany({
        where: {
          matchId: match.id,
          status: "ACCEPTED",
        },
        include: {
          challenger: true,
          opponent: true,
        },
      });

      if (activeDuels.length === 0) {
        logger.info(`No active duels found for match ${match.id}`);
        return;
      }

      logger.info(`Found ${activeDuels.length} active duels to process`);

      if (!winner) {
        logger.info(`Match ended in draw, refunding all duels`);

        for (const duel of activeDuels) {
          await this.prisma.duel.update({
            where: { id: duel.id },
            data: { status: "CANCELLED" },
          });

          await this.prisma.user.update({
            where: { id: duel.challengerId },
            data: { points: duel.challenger.points + duel.amount },
          });

          await this.prisma.user.update({
            where: { id: duel.opponentId },
            data: { points: duel.opponent.points + duel.amount },
          });

          logger.info(
            `💰 Refunded ${duel.amount} Perticoin to both duel participants`
          );
        }
        return;
      }

      const tutils = new TournamentUtils(this.prisma);
      for (const duel of activeDuels) {
        const challengerWon = duel.challengerTeam === winner;
        const winnerUser = challengerWon ? duel.challenger : duel.opponent;
        const loserUser = challengerWon ? duel.opponent : duel.challenger;

        const winnings = duel.amount * 2;

        await this.prisma.duel.update({
          where: { id: duel.id },
          data: {
            status: "RESOLVED",
            winnerUserId: winnerUser.id,
          },
        });

        await this.prisma.user.update({
          where: { id: winnerUser.id },
          data: { points: winnerUser.points + winnings },
        });

        logger.info(
          `⚔️ ${winnerUser.username} won duel ${duel.id} and earned ${winnings} Perticoin (${duel.challengerTeam} vs ${duel.opponentTeam})`
        );
        await tutils.recordDuelResolution({
          ...(duel as any),
          winnerUserId: winnerUser.id,
        } as any);

        try {
          await TitleManager.unlockDuelWinMilestone(winnerUser.id, this.client);
          await TitleManager.unlockDuelWinStreak(winnerUser.id, this.client);
        } catch {}
      }
    } catch (error) {
      logger.error(
        `Error processing duel results for match ${match.id}:`,
        error
      );
      throw error;
    }
  }

  private async processParlayResults(
    match: any,
    score: string,
    winner: string | null
  ) {
    try {
      const activeParlays = await this.prisma.parlay.findMany({
        where: {
          status: "ACTIVE",
          legs: {
            some: {
              matchId: match.id,
            },
          },
        },
        include: {
          user: true,
          legs: {
            include: {
              match: true,
            },
          },
        },
      });

      if (activeParlays.length === 0) {
        logger.info(`No active parlays found for match ${match.id}`);
        return;
      }

      logger.info(`Found ${activeParlays.length} active parlays to process`);

      const tutils = new TournamentUtils(this.prisma);
      for (const parlay of activeParlays) {
        const matchLeg = parlay.legs.find((leg) => leg.matchId === match.id);
        if (!matchLeg) continue;

        let legWon = false;

        if (matchLeg.type === "SCORE") {
          legWon = matchLeg.selection === score;
        } else {
          legWon = matchLeg.selection === winner;
        }

        if (!legWon) {
          await this.prisma.parlay.update({
            where: { id: parlay.id },
            data: { status: "LOST" },
          });

          logger.info(
            `💸 ${parlay.user.username} lost parlay ${parlay.id} (leg failed: ${matchLeg.type} - ${matchLeg.selection})`
          );
          await tutils.recordParlayResolution({
            ...(parlay as any),
            status: "LOST",
          } as any);
          continue;
        }

        const allMatchesFinished = parlay.legs.every((leg) => {
          return leg.match.status === "FINISHED";
        });

        if (!allMatchesFinished) {
          logger.info(
            `✅ ${parlay.user.username} won leg in parlay ${parlay.id} (${matchLeg.type} - ${matchLeg.selection}), waiting for other matches`
          );
          continue;
        }

        const allLegsWon = await this.checkAllParlayLegsWon(parlay.legs);

        if (allLegsWon) {
          const winnings = Math.floor(parlay.amount * parlay.totalOdds);

          await this.prisma.parlay.update({
            where: { id: parlay.id },
            data: { status: "WON" },
          });

          await this.prisma.user.update({
            where: { id: parlay.userId },
            data: { points: parlay.user.points + winnings },
          });

          logger.info(
            `🎯 ${parlay.user.username} won parlay ${
              parlay.id
            } and earned ${winnings} Perticoin (${parlay.totalOdds.toFixed(
              2
            )}x)`
          );
          await tutils.recordParlayResolution({
            ...(parlay as any),
            status: "WON",
          } as any);

          try {
            await TitleManager.unlockParlayLegsTitle(
              parlay.userId,
              parlay.legs.length,
              this.client
            );
            await TitleManager.unlockParlayHighOddsTitle(
              parlay.userId,
              parlay.totalOdds,
              this.client
            );
            await TitleManager.unlockParlayWinStreak(
              parlay.userId,
              this.client
            );
          } catch {}
        } else {
          await this.prisma.parlay.update({
            where: { id: parlay.id },
            data: { status: "LOST" },
          });

          logger.info(
            `💸 ${parlay.user.username} lost parlay ${parlay.id} (not all legs won)`
          );
          await tutils.recordParlayResolution({
            ...(parlay as any),
            status: "LOST",
          } as any);
        }
      }
    } catch (error) {
      logger.error(
        `Error processing parlay results for match ${match.id}:`,
        error
      );
      throw error;
    }
  }

  private async checkAllParlayLegsWon(legs: any[]): Promise<boolean> {
    for (const leg of legs) {
      const match = leg.match;

      if (match.status !== "FINISHED") {
        return false;
      }

      let legWon = false;

      if (leg.type === "SCORE") {
        legWon = leg.selection === match.score;
      } else {
        if (!match.score) return false;

        const [kcScore, opponentScore] = match.score.split("-").map(Number);
        const winner = kcScore > opponentScore ? match.kcTeam : match.opponent;

        legWon = leg.selection === winner;
      }

      if (!legWon) {
        return false;
      }
    }

    return true;
  }
}
