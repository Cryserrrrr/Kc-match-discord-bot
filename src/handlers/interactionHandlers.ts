import { PrismaClient } from "@prisma/client";
import { logger } from "../utils/logger";
import { createMatchEmbed } from "../utils/embedBuilder";
import { getTeamDisplayName } from "../utils/teamMapper";
import { CONFIG, ERROR_MESSAGES } from "../utils/config";
import { EmbedBuilder } from "discord.js";
import {
  safeInteractionDefer,
  safeInteractionReply,
  withTimeout,
} from "../utils/timeoutUtils";
import { handleTicketModalSubmit } from "../commands/ticket";
import { displayStanding } from "../commands/standing";
import {
  handleMatchSelection,
  handleTeamSelection,
  handleScoreSelection,
  handleScoreSelect,
  handleScoreBetAmount,
  handleBetAmount,
  handleBackToMatches,
  handleBackToMatch,
} from "../commands/bet";
import {
  handleParlayAddTeam,
  handleParlayTeamMatchSelect,
  handleParlayTeamPick,
  handleParlayAddScore,
  handleParlayScoreMatchSelect,
  handleParlayScorePick,
  handleParlayConfirm,
  handleParlayCancel,
} from "../commands/parlay";
import { TitleManager } from "../utils/titleManager";

export class InteractionHandlers {
  constructor(private prisma: PrismaClient) {}

  private async handleError(interaction: any, error: any, context: string) {
    logger.error(`Error in ${context}:`, error);
    await this.sendErrorMessage(
      interaction,
      ERROR_MESSAGES.GENERAL.INTERACTION_ERROR
    );
  }

  private async sendErrorMessage(interaction: any, message: string) {
    try {
      await safeInteractionReply(interaction, {
        content: message,
        ephemeral: true,
      });
    } catch (error) {
      logger.error("Error sending error message:", error);
    }
  }

  async handleCommand(interaction: any, command: any) {
    try {
      const isTicket = interaction.commandName === "ticket";
      const isProfil = interaction.commandName === "profil";
      const isTournamentCreate =
        interaction.commandName === "tournament" &&
        typeof interaction.options?.getSubcommand === "function" &&
        interaction.options.getSubcommand() === "create";

      if (!isTicket && !isProfil && !isTournamentCreate) {
        await safeInteractionDefer(interaction);
      }
      await command.execute(interaction);
    } catch (error) {
      logger.error(
        `Error executing command ${interaction.commandName}:`,
        error
      );
      await this.sendErrorMessage(
        interaction,
        ERROR_MESSAGES.GENERAL.COMMAND_EXECUTION_ERROR
      );
    }
  }

  async handleTeamSelect(interaction: any) {
    try {
      await safeInteractionDefer(interaction);
      const selectedTeam = interaction.values[0];
      const guildId = interaction.guildId!;

      const guildSettings = await withTimeout(
        this.prisma.guildSettings.findUnique({ where: { guildId } }),
        CONFIG.TIMEOUTS.DATABASE_QUERY,
        ERROR_MESSAGES.TIMEOUT.DATABASE_QUERY
      );

      const filteredTeams = (guildSettings as any)?.filteredTeams || [];
      const whereClause: any = { beginAt: { gte: new Date() } };

      if (selectedTeam !== "all") {
        whereClause.kcId = selectedTeam;
      } else if (filteredTeams.length > 0) {
        whereClause.kcId = { in: filteredTeams };
      }

      const nextMatch = await withTimeout(
        this.prisma.match.findFirst({
          where: whereClause,
          orderBy: { beginAt: "asc" },
        }),
        CONFIG.TIMEOUTS.DATABASE_QUERY,
        ERROR_MESSAGES.TIMEOUT.DATABASE_QUERY
      );

      if (!nextMatch) {
        const teamText =
          selectedTeam === "all"
            ? "Karmine Corp"
            : getTeamDisplayName(selectedTeam);
        await safeInteractionReply(interaction, {
          content: `No upcoming match found for ${teamText}! 🏆`,
        });
        return;
      }

      const embed = await createMatchEmbed({
        kcTeam: nextMatch.kcTeam,
        kcId: nextMatch.kcId,
        opponent: nextMatch.opponent,
        opponentImage: nextMatch.opponentImage || undefined,
        tournamentName: nextMatch.tournamentName,
        leagueName: nextMatch.leagueName,
        leagueImage: nextMatch.leagueImage || undefined,
        serieName: nextMatch.serieName,
        numberOfGames: nextMatch.numberOfGames,
        beginAt: nextMatch.beginAt,
      });

      await safeInteractionReply(interaction, { embeds: [embed] });
    } catch (error) {
      await this.handleError(interaction, error, "handleTeamSelect");
    }
  }

  async handleTournamentSelect(interaction: any) {
    try {
      await safeInteractionDefer(interaction);
      const selectedTournamentId = interaction.values[0];

      const match = await this.prisma.match.findFirst({
        where: { tournamentId: selectedTournamentId },
        select: {
          tournamentId: true,
          tournamentName: true,
          hasBracket: true,
        },
      });

      if (!match) {
        await safeInteractionReply(interaction, {
          content: "Tournament not found! 🏆",
        });
        return;
      }

      const tournament = {
        id: match.tournamentId!,
        name: match.tournamentName,
        hasBracket: match.hasBracket,
      };

      await displayStanding(interaction, tournament);
    } catch (error) {
      await this.handleError(interaction, error, "handleTournamentSelect");
    }
  }

  async handleTicketModal(interaction: any) {
    try {
      await handleTicketModalSubmit(interaction);
    } catch (error) {
      await this.handleError(interaction, error, "handleTicketModal");
    }
  }

  async handleTitleSelection(interaction: any) {
    try {
      await safeInteractionDefer(interaction);
      const selectedTitleId = interaction.values[0];
      const userId = interaction.user.id;

      const title = await withTimeout(
        this.prisma.title.findUnique({ where: { id: selectedTitleId } }),
        CONFIG.TIMEOUTS.DATABASE_QUERY,
        ERROR_MESSAGES.TIMEOUT.DATABASE_QUERY
      );

      if (!title) {
        await safeInteractionReply(interaction, {
          content: "Titre introuvable.",
          ephemeral: true,
        });
        return;
      }

      const unlockedTitles = await TitleManager.getUnlockedTitles(userId);
      if (!unlockedTitles.includes(title.name)) {
        await safeInteractionReply(interaction, {
          content: "Vous n'avez pas débloqué ce titre.",
          ephemeral: true,
        });
        return;
      }

      await withTimeout(
        this.prisma.userProfile.upsert({
          where: { userId },
          update: { titleId: selectedTitleId },
          create: { userId, titleId: selectedTitleId },
        }),
        CONFIG.TIMEOUTS.DATABASE_QUERY,
        ERROR_MESSAGES.TIMEOUT.DATABASE_QUERY
      );

      const embed = new EmbedBuilder()
        .setColor(0x00bcd4)
        .setTitle("✅ Titre mis à jour")
        .setDescription(`Votre titre a été défini sur : **${title.name}**`)
        .setFooter({ text: "Utilisez /profil pour voir votre nouveau titre" });

      await safeInteractionReply(interaction, {
        embeds: [embed],
        ephemeral: true,
      });
    } catch (error) {
      await this.handleError(interaction, error, "handleTitleSelection");
    }
  }

  async handleBettingInteraction(
    interaction: any,
    handler: (interaction: any) => Promise<void>,
    context: string
  ) {
    try {
      await handler(interaction);
    } catch (error) {
      await this.handleError(interaction, error, context);
    }
  }

  getBettingHandlers() {
    return {
      select_match: (interaction: any) =>
        this.handleBettingInteraction(
          interaction,
          handleMatchSelection,
          "match selection"
        ),
      bet_team: (interaction: any) =>
        this.handleBettingInteraction(
          interaction,
          handleTeamSelection,
          "team selection"
        ),
      bet_score: (interaction: any) =>
        this.handleBettingInteraction(
          interaction,
          handleScoreSelection,
          "score selection"
        ),
      bet_score_select: (interaction: any) =>
        this.handleBettingInteraction(
          interaction,
          handleScoreSelect,
          "score select"
        ),
      bet_amount: (interaction: any) =>
        this.handleBettingInteraction(
          interaction,
          handleBetAmount,
          "bet amount"
        ),
      bet_score_amount: (interaction: any) =>
        this.handleBettingInteraction(
          interaction,
          handleScoreBetAmount,
          "score bet amount"
        ),
      back_to_matches: (interaction: any) =>
        this.handleBettingInteraction(
          interaction,
          handleBackToMatches,
          "back to matches"
        ),
      back_to_match: (interaction: any) =>
        this.handleBettingInteraction(
          interaction,
          handleBackToMatch,
          "back to match"
        ),
    };
  }

  async handleParlayInteraction(
    interaction: any,
    handler: (interaction: any) => Promise<void>,
    context: string
  ) {
    try {
      await handler(interaction);
    } catch (error) {
      await this.handleError(interaction, error, context);
    }
  }

  getParlayHandlers() {
    return {
      add_team: (interaction: any) =>
        this.handleParlayInteraction(
          interaction,
          handleParlayAddTeam,
          "parlay add team"
        ),
      add_score: (interaction: any) =>
        this.handleParlayInteraction(
          interaction,
          handleParlayAddScore,
          "parlay add score"
        ),
      confirm: (interaction: any) =>
        this.handleParlayInteraction(
          interaction,
          handleParlayConfirm,
          "parlay confirm"
        ),
      cancel: (interaction: any) =>
        this.handleParlayInteraction(
          interaction,
          handleParlayCancel,
          "parlay cancel"
        ),
      team_match_select: (interaction: any) =>
        this.handleParlayInteraction(
          interaction,
          handleParlayTeamMatchSelect,
          "parlay team match select"
        ),
      team_pick: (interaction: any) =>
        this.handleParlayInteraction(
          interaction,
          handleParlayTeamPick,
          "parlay team pick"
        ),
      score_match_select: (interaction: any) =>
        this.handleParlayInteraction(
          interaction,
          handleParlayScoreMatchSelect,
          "parlay score match select"
        ),
      score_pick: (interaction: any) =>
        this.handleParlayInteraction(
          interaction,
          handleParlayScorePick,
          "parlay score pick"
        ),
    };
  }

  async handleTournamentJoin(interaction: any) {
    try {
      const { handleTournamentJoin } = await import("../commands/tournament");
      await handleTournamentJoin(interaction);
    } catch (error) {
      await this.handleError(interaction, error, "handleTournamentJoin");
    }
  }
}
