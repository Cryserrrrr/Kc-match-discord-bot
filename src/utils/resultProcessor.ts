import { PrismaClient } from "@prisma/client";
import { Client } from "discord.js";
import { logger } from "./logger";
import { TournamentUtils } from "./tournamentUtils";
import { TitleManager } from "./titleManager";

type ClientSource = Client | null | (() => Promise<Client | null>);

const FINISHED_STATUSES = ["finished", "announced"];

type LegOutcome = "won" | "lost" | "pending";

export class ResultProcessor {
  private prisma: PrismaClient;
  private clientSource: ClientSource;
  private resolvedClient: Client | null | undefined;

  /**
   * `client` may be a lazy provider so that callers only log in to Discord
   * when a result actually needs a DM (title unlocks).
   */
  constructor(prisma: PrismaClient, client: ClientSource) {
    this.prisma = prisma;
    this.clientSource = client;
  }

  private async getClient(): Promise<Client | undefined> {
    if (this.resolvedClient === undefined) {
      if (typeof this.clientSource === "function") {
        try {
          this.resolvedClient = await this.clientSource();
        } catch (error) {
          logger.warn("Discord client unavailable for result DMs:", error);
          this.resolvedClient = null;
        }
      } else {
        this.resolvedClient = this.clientSource;
      }
    }
    return this.resolvedClient ?? undefined;
  }

  /**
   * Resolves every bet, duel and parlay linked to a finished match.
   * Safe to call several times: each item is claimed with a conditional
   * status update, so it is paid at most once.
   */
  async processMatchResults(match: any, score: string) {
    try {
      logger.info(
        `🎲 Processing all results for match: ${match.kcTeam} vs ${match.opponent} (${score})`
      );

      const winner = this.determineWinner(match, score);

      // Sequential on purpose: avoids concurrent writes on the same users
      await this.processBetResults(match, score, winner);
      await this.processDuelResults(match, score, winner);
      await this.processParlayResults(match);

      logger.info(`✅ All results processing completed for match ${match.id}`);
    } catch (error) {
      logger.error(`Error processing results for match ${match.id}:`, error);
      throw error;
    }
  }

  /**
   * Catch-up pass: resolves matches that finished with a score but still have
   * unresolved bets/duels/parlays (e.g. a match that went straight from
   * not_started to finished between two runs, or a previous run that failed).
   */
  async processPendingResults() {
    const matches = await this.prisma.match.findMany({
      where: {
        status: { in: FINISHED_STATUSES },
        score: { not: null },
        OR: [
          { bets: { some: { status: "ACTIVE" } } },
          { duels: { some: { status: { in: ["ACCEPTED", "PENDING"] } } } },
          { parlayLegs: { some: { parlay: { status: "ACTIVE" } } } },
        ],
      },
      orderBy: { beginAt: "asc" },
    });

    for (const match of matches) {
      try {
        await this.processMatchResults(match, match.score!);
      } catch (error) {
        logger.error(
          `Error in catch-up result processing for match ${match.id}:`,
          error
        );
      }
    }
  }

  private determineWinner(match: any, score: string): string | null {
    if (!score) return null;

    const [kcScore, opponentScore] = score.split("-").map(Number);
    if (isNaN(kcScore) || isNaN(opponentScore)) return null;

    if (kcScore > opponentScore) {
      return match.kcTeam;
    } else if (opponentScore > kcScore) {
      return match.opponent;
    }

    return null;
  }

  private async safeRun(label: string, fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (error) {
      logger.warn(`${label} failed:`, error);
    }
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

      const tutils = new TournamentUtils(this.prisma);
      for (const bet of activeBets) {
        // Score bets are judged on the exact score (a draw like 1-1 can win);
        // team bets are refunded when there is no winner.
        const refund = bet.type === "TEAM" && !winner;
        const won =
          bet.type === "SCORE"
            ? bet.selection === score
            : winner !== null && bet.selection === winner;
        const status = refund ? "CANCELLED" : won ? "WON" : "LOST";
        const payout = refund
          ? bet.amount
          : won
          ? Math.floor(bet.amount * bet.odds)
          : 0;

        const claimed = await this.prisma.$transaction(async (tx) => {
          const res = await tx.bet.updateMany({
            where: { id: bet.id, status: "ACTIVE" },
            data: { status },
          });
          if (res.count === 0) return false;
          if (payout > 0) {
            await tx.user.update({
              where: { id: bet.userId },
              data: { points: { increment: payout } },
            });
          }
          return true;
        });

        if (!claimed) continue;

        if (status === "CANCELLED") {
          logger.info(
            `💰 Refunded ${bet.amount} Perticoin to ${bet.user.username} (draw)`
          );
          continue;
        }

        if (status === "WON") {
          logger.info(
            `🎉 ${bet.user.username} won ${payout} Perticoin on ${bet.type} bet (selection: ${bet.selection}, score: ${score}, bet: ${bet.amount}, odds: ${bet.odds}x)`
          );
        } else {
          logger.info(
            `💸 ${bet.user.username} lost ${bet.amount} Perticoin on ${bet.type} bet (selection: ${bet.selection}, score: ${score})`
          );
        }

        await this.safeRun("recordBetResolution", () =>
          tutils.recordBetResolution({ ...(bet as any), status } as any)
        );
        if (status === "WON") {
          const client = await this.getClient();
          await this.safeRun("unlockBetWinStreak", () =>
            TitleManager.unlockBetWinStreak(bet.userId, client)
          );
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
      // Duels never accepted before the match ended simply expire
      const expired = await this.prisma.duel.updateMany({
        where: { matchId: match.id, status: "PENDING" },
        data: { status: "CANCELLED" },
      });
      if (expired.count > 0) {
        logger.info(
          `Cancelled ${expired.count} pending duels for finished match ${match.id}`
        );
      }

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

      const tutils = new TournamentUtils(this.prisma);
      for (const duel of activeDuels) {
        if (!winner) {
          // Stakes are only exchanged at resolution, so a draw moves no money
          await this.prisma.duel.updateMany({
            where: { id: duel.id, status: "ACCEPTED" },
            data: { status: "CANCELLED" },
          });
          logger.info(`🤝 Duel ${duel.id} cancelled (draw)`);
          continue;
        }

        const challengerWon = duel.challengerTeam === winner;
        const winnerUser = challengerWon ? duel.challenger : duel.opponent;
        const loserUser = challengerWon ? duel.opponent : duel.challenger;

        // The loser pays the stake to the winner (capped at the loser's balance)
        const transferred = await this.prisma.$transaction(async (tx) => {
          const res = await tx.duel.updateMany({
            where: { id: duel.id, status: "ACCEPTED" },
            data: { status: "RESOLVED", winnerUserId: winnerUser.id },
          });
          if (res.count === 0) return null;

          const loser = await tx.user.findUnique({
            where: { id: loserUser.id },
          });
          const amount = Math.min(duel.amount, Math.max(loser?.points ?? 0, 0));
          if (amount > 0) {
            await tx.user.update({
              where: { id: loserUser.id },
              data: { points: { decrement: amount } },
            });
            await tx.user.update({
              where: { id: winnerUser.id },
              data: { points: { increment: amount } },
            });
          }
          return amount;
        });

        if (transferred === null) continue;

        logger.info(
          `⚔️ ${winnerUser.username} won duel ${duel.id} against ${loserUser.username} and received ${transferred} Perticoin (${duel.challengerTeam} vs ${duel.opponentTeam})`
        );
        await this.safeRun("recordDuelResolution", () =>
          tutils.recordDuelResolution({
            ...(duel as any),
            winnerUserId: winnerUser.id,
          } as any)
        );

        const client = await this.getClient();
        await this.safeRun("unlockDuelWinMilestone", () =>
          TitleManager.unlockDuelWinMilestone(winnerUser.id, client)
        );
        await this.safeRun("unlockDuelWinStreak", () =>
          TitleManager.unlockDuelWinStreak(winnerUser.id, client)
        );
      }
    } catch (error) {
      logger.error(
        `Error processing duel results for match ${match.id}:`,
        error
      );
      throw error;
    }
  }

  private evaluateLeg(leg: any): LegOutcome {
    const legMatch = leg.match;
    if (
      !legMatch ||
      !FINISHED_STATUSES.includes(legMatch.status) ||
      !legMatch.score
    ) {
      return "pending";
    }

    if (leg.type === "SCORE") {
      return leg.selection === legMatch.score ? "won" : "lost";
    }

    const winner = this.determineWinner(legMatch, legMatch.score);
    return winner !== null && leg.selection === winner ? "won" : "lost";
  }

  private async processParlayResults(match: any) {
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
        const outcomes = parlay.legs.map((leg) => this.evaluateLeg(leg));

        let status: "WON" | "LOST";
        if (outcomes.includes("lost")) {
          status = "LOST";
        } else if (outcomes.every((o) => o === "won")) {
          status = "WON";
        } else {
          logger.info(
            `✅ ${parlay.user.username} parlay ${parlay.id} still waiting for other matches`
          );
          continue;
        }

        const winnings =
          status === "WON" ? Math.floor(parlay.amount * parlay.totalOdds) : 0;

        const claimed = await this.prisma.$transaction(async (tx) => {
          const res = await tx.parlay.updateMany({
            where: { id: parlay.id, status: "ACTIVE" },
            data: { status },
          });
          if (res.count === 0) return false;
          if (winnings > 0) {
            await tx.user.update({
              where: { id: parlay.userId },
              data: { points: { increment: winnings } },
            });
          }
          return true;
        });

        if (!claimed) continue;

        if (status === "LOST") {
          logger.info(`💸 ${parlay.user.username} lost parlay ${parlay.id}`);
        } else {
          logger.info(
            `🎯 ${parlay.user.username} won parlay ${
              parlay.id
            } and earned ${winnings} Perticoin (${parlay.totalOdds.toFixed(
              2
            )}x)`
          );
        }

        await this.safeRun("recordParlayResolution", () =>
          tutils.recordParlayResolution({ ...(parlay as any), status } as any)
        );

        if (status === "WON") {
          const client = await this.getClient();
          await this.safeRun("unlockParlayLegsTitle", () =>
            TitleManager.unlockParlayLegsTitle(
              parlay.userId,
              parlay.legs.length,
              client
            )
          );
          await this.safeRun("unlockParlayHighOddsTitle", () =>
            TitleManager.unlockParlayHighOddsTitle(
              parlay.userId,
              parlay.totalOdds,
              client
            )
          );
          await this.safeRun("unlockParlayWinStreak", () =>
            TitleManager.unlockParlayWinStreak(parlay.userId, client)
          );
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
}
