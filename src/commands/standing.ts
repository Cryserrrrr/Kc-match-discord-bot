import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";
import { prisma } from "../index";
import { logger } from "../utils/logger";
import { CONFIG, ERROR_MESSAGES } from "../utils/config";
import { withTimeout } from "../utils/timeoutUtils";
import { getTeamDisplayName } from "../utils/teamMapper";
import { PandaScoreService } from "../services/pandascore";

interface Tournament {
  id: string;
  name: string;
  hasBracket: boolean;
}

interface StandingTeam {
  rank: number;
  team: {
    name: string;
    image_url?: string;
  };
  points?: number;
  wins?: number;
  losses?: number;
  draws?: number;
}

interface BracketMatch {
  id: number;
  name: string;
  winner: {
    name: string;
  } | null;
  loser: {
    name: string;
  } | null;
  status: string;
  scheduled_at?: string;
}

const CACHE_DURATION = 5 * 60 * 1000;

export const data = new SlashCommandBuilder()
  .setName("standing")
  .setDescription("Affiche le classement d'un tournoi")
  .addStringOption((option: any) =>
    option
      .setName("team")
      .setDescription("Choisir une équipe spécifique de Karmine Corp")
      .setRequired(false)
      .addChoices(
        { name: "KC (LEC)", value: "134078" },
        { name: "KCB (LFL)", value: "128268" },
        { name: "KCBS (LFL2)", value: "136080" },
        { name: "KC Valorant", value: "130922" },
        { name: "KCGC Valorant", value: "132777" },
        { name: "KCBS Valorant", value: "136165" },
        { name: "KC Rocket League", value: "129570" }
      )
  );

export async function execute(interaction: any) {
  const selectedTeam = interaction.options.getString("team");

  cleanupObsoleteCache().catch((error) => {
    logger.error("Error cleaning up obsolete cache:", error);
  });

  try {
    const whereClause: any = {
      status: "scheduled",
      kcId: selectedTeam,
    };

    const whereClauseLast: any = {
      status: "announced",
      kcId: selectedTeam,
    };

    const nextMatch = await withTimeout(
      prisma.match.findFirst({
        where: whereClause,
        orderBy: { beginAt: "asc" },
      }),
      CONFIG.TIMEOUTS.DATABASE_QUERY,
      ERROR_MESSAGES.TIMEOUT.DATABASE_QUERY
    );

    const lastMatch = await withTimeout(
      prisma.match.findFirst({
        where: whereClauseLast,
        orderBy: { beginAt: "desc" },
      }),
      CONFIG.TIMEOUTS.DATABASE_QUERY,
      ERROR_MESSAGES.TIMEOUT.DATABASE_QUERY
    );

    if (!nextMatch && !lastMatch) {
      const teamText = selectedTeam
        ? getTeamDisplayName(selectedTeam)
        : "Karmine Corp";
      await interaction.editReply({
        content: `Aucun match trouvé pour ${teamText}!`,
      });
      return;
    }

    const tournaments: Tournament[] = [];

    if (nextMatch?.tournamentId) {
      const tournament: Tournament = {
        id: nextMatch.tournamentId,
        name: nextMatch.tournamentName,
        hasBracket: nextMatch.hasBracket,
      };
      tournaments.push(tournament);
    }

    if (
      lastMatch?.tournamentId &&
      lastMatch.tournamentId !== nextMatch?.tournamentId
    ) {
      const tournament: Tournament = {
        id: lastMatch.tournamentId,
        name: lastMatch.tournamentName,
        hasBracket: lastMatch.hasBracket,
      };
      tournaments.push(tournament);
    }

    if (tournaments.length === 0) {
      await interaction.editReply({
        content: "Aucun tournoi trouvé pour afficher le classement! 🏆",
      });
      return;
    }

    if (tournaments.length === 1) {
      await displayStanding(interaction, tournaments[0]);
    } else {
      await showTournamentSelector(interaction, tournaments);
    }
  } catch (error) {
    logger.error("Error in standing command:", error);
    await interaction.editReply({
      content: ERROR_MESSAGES.GENERAL.COMMAND_EXECUTION_ERROR,
    });
  }
}

async function showTournamentSelector(
  interaction: any,
  tournaments: Tournament[]
) {
  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("tournament_select")
      .setPlaceholder("Sélectionnez un tournoi")
      .addOptions(
        tournaments.map((tournament) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(tournament.name)
            .setValue(tournament.id)
            .setDescription(
              tournament.hasBracket ? "Format bracket" : "Format classement"
            )
        )
      )
  );

  await interaction.editReply({
    content:
      "Plusieurs tournois trouvés. Veuillez sélectionner celui dont vous voulez voir le classement :",
    components: [row],
  });
}

async function displayStanding(interaction: any, tournament: Tournament) {
  try {
    const cachedData = await prisma.standingCache.findFirst({
      where: {
        tournamentId: tournament.id,
        expiresAt: { gt: new Date() },
      },
    });

    if (cachedData) {
      const data = JSON.parse(cachedData.data);
      await sendStandingEmbed(interaction, tournament, data);
      return;
    }

    const pandaScoreService = new PandaScoreService();
    let data;

    if (tournament.hasBracket) {
      data = await pandaScoreService.getTournamentBrackets(tournament.id);
    } else {
      data = await pandaScoreService.getTournamentStandings(tournament.id);
    }

    await prisma.standingCache.create({
      data: {
        tournamentId: tournament.id,
        data: JSON.stringify(data),
        expiresAt: new Date(Date.now() + CACHE_DURATION),
      },
    });

    await sendStandingEmbed(interaction, tournament, data);
  } catch (error) {
    logger.error(
      `Error fetching standing for tournament ${tournament.id}:`,
      error
    );
    await interaction.editReply({
      content:
        "Erreur lors de la récupération du classement. Veuillez réessayer plus tard.",
    });
  }
}

async function sendStandingEmbed(
  interaction: any,
  tournament: Tournament,
  data: any
) {
  const embed = new EmbedBuilder()
    .setTitle(`🏆 ${tournament.name}`)
    .setColor(0x0099ff)
    .setTimestamp();

  if (tournament.hasBracket) {
    if (Array.isArray(data) && data.length > 0) {
      const upperBracketMatches = data
        .filter((match: any) =>
          match.name.toLowerCase().includes("upper bracket")
        )
        .sort((a: any, b: any) => {
          const dateA = new Date(a.scheduled_at || 0);
          const dateB = new Date(b.scheduled_at || 0);
          return dateA.getTime() - dateB.getTime();
        });

      const lowerBracketMatches = data
        .filter((match: any) =>
          match.name.toLowerCase().includes("lower bracket")
        )
        .sort((a: any, b: any) => {
          const dateA = new Date(a.scheduled_at || 0);
          const dateB = new Date(b.scheduled_at || 0);
          return dateA.getTime() - dateB.getTime();
        });

      const grandFinalMatches = data
        .filter((match: any) =>
          match.name.toLowerCase().includes("grand final")
        )
        .sort((a: any, b: any) => {
          const dateA = new Date(a.scheduled_at || 0);
          const dateB = new Date(b.scheduled_at || 0);
          return dateA.getTime() - dateB.getTime();
        });

      const embeds = [];

      if (upperBracketMatches.length > 0) {
        const upperEmbed = createBracketEmbed(
          tournament.name,
          "Upper Bracket",
          0x0099ff,
          upperBracketMatches
        );
        embeds.push(upperEmbed);
      }

      if (lowerBracketMatches.length > 0) {
        const lowerEmbed = createBracketEmbed(
          tournament.name,
          "Lower Bracket",
          0xff6b35,
          lowerBracketMatches
        );
        embeds.push(lowerEmbed);
      }

      if (grandFinalMatches.length > 0) {
        const finalEmbed = createGrandFinalEmbed(
          tournament.name,
          grandFinalMatches
        );
        embeds.push(finalEmbed);
      }

      await interaction.editReply({ embeds });
      return;
    }
  } else {
    embed.setDescription("📈 **Classement du tournoi**");

    if (Array.isArray(data) && data.length > 0) {
      let standingText = "";
      data.forEach((team: StandingTeam, index: number) => {
        const position = team.rank;
        const name = team.team.name;
        const wins = team.wins || 0;
        const losses = team.losses || 0;
        const draws = team.draws || 0;

        const totalMatches = wins + losses + draws;
        const winRate =
          totalMatches > 0 ? ((wins / totalMatches) * 100).toFixed(1) : "0.0";

        standingText += `${position}. **${name}** - ${wins}W-${losses}L${
          draws > 0 ? `-${draws}D` : ""
        } (${winRate}%)\n`;
      });

      embed.addFields({
        name: "Classement",
        value: standingText || "Aucun classement trouvé",
        inline: false,
      });
    }
  }

  await interaction.editReply({ embeds: [embed] });
}

function formatMatchCompact(match: any) {
  const status =
    match.status === "finished"
      ? "✅ Terminé"
      : match.status === "live"
      ? "🔴 En cours"
      : "⏳ A venir";

  let matchText = `**${status}**\n`;

  if (match.opponents && match.opponents.length >= 2) {
    const team1 = match.opponents[0]?.opponent?.name || "TBD";
    const team2 = match.opponents[1]?.opponent?.name || "TBD";
    matchText += `⚔️ ${team1} vs ${team2}`;
  } else {
    matchText += `⚔️ TBD vs TBD`;
  }

  if (match.scheduled_at) {
    const matchDate = new Date(match.scheduled_at);
    matchText += `\n📅 ${matchDate.toLocaleDateString(
      "fr-FR"
    )} ${matchDate.toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }

  if (
    match.status === "finished" &&
    match.results &&
    match.results.length >= 2
  ) {
    const score1 = match.results[0]?.score || 0;
    const score2 = match.results[1]?.score || 0;
    matchText += `\n📊 ${score1}-${score2}`;
  }

  return matchText;
}

function organizeMatchesByStage(matches: any[]) {
  return {
    quarterfinals: matches.filter((match) =>
      match.name.toLowerCase().includes("quarterfinal")
    ),
    semifinals: matches.filter((match) =>
      match.name.toLowerCase().includes("semifinal")
    ),
    finals: matches.filter(
      (match) =>
        match.name.toLowerCase().includes("final") &&
        !match.name.toLowerCase().includes("semifinal") &&
        !match.name.toLowerCase().includes("quarterfinal")
    ),
  };
}

function createBracketEmbed(
  tournamentName: string,
  bracketType: string,
  color: number,
  matches: any[]
) {
  const embed = new EmbedBuilder()
    .setTitle(`🏆 ${tournamentName} - ${bracketType}`)
    .setColor(color)
    .setTimestamp();

  const stages = organizeMatchesByStage(matches);

  const stageConfigs = [
    { key: "quarterfinals", name: "🏟️ Quarter-finals" },
    { key: "semifinals", name: "🏆 Semi-finals" },
    { key: "finals", name: "🏅 Final" },
  ];

  stageConfigs.forEach(({ key, name }) => {
    const stageMatches = stages[key as keyof typeof stages];
    if (stageMatches.length > 0) {
      let stageText = "";
      stageMatches.forEach((match: any, index: number) => {
        stageText += formatMatchCompact(match);
        if (index < stageMatches.length - 1) {
          stageText += "\n\n";
        } else {
          stageText += "\n";
        }
      });
      embed.addFields({
        name,
        value: stageText || "Aucun match",
        inline: true,
      });
    }
  });

  return embed;
}

function createGrandFinalEmbed(tournamentName: string, matches: any[]) {
  const embed = new EmbedBuilder()
    .setTitle(`🏅 ${tournamentName} - Grand Final`)
    .setColor(0xffd700)
    .setDescription("🏆 **Grande Finale**")
    .setTimestamp();

  let finalText = "";
  matches.forEach((match: any, index: number) => {
    finalText += formatMatchCompact(match);
    if (index < matches.length - 1) {
      finalText += "\n\n";
    } else {
      finalText += "\n";
    }
  });

  embed.addFields({
    name: "Matchs",
    value: finalText || "Aucun match trouvé",
    inline: false,
  });

  return embed;
}

async function cleanupObsoleteCache() {
  try {
    const deletedCount = await prisma.standingCache.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });

    if (deletedCount.count > 0) {
      logger.info(`Cleaned up ${deletedCount.count} obsolete cache entries`);
    }
  } catch (error) {
    logger.error("Error cleaning up obsolete cache:", error);
    throw error;
  }
}
