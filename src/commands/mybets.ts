import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import { PrismaClient } from "@prisma/client";
import { logger } from "../utils/logger";
import {
  formatBetStatus,
  formatDuelStatus,
  formatParlayStatus,
} from "../utils/statusDisplay";
import { formatDate, formatTime } from "../utils/dateUtils";

const prisma = new PrismaClient();

export const data = new SlashCommandBuilder()
  .setName("mybets")
  .setDescription("Voir vos paris actifs");

export async function execute(interaction: any) {
  try {
    const userId = interaction.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      const embed = new EmbedBuilder()
        .setColor(0xff6b6b)
        .setTitle("Aucun Compte Trouvé")
        .setDescription(
          "Vous devez utiliser `/daily` en premier pour créer votre compte."
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed], ephemeral: true });
      return;
    }

    const activeBets = await prisma.bet.findMany({
      where: {
        userId: userId,
        status: "ACTIVE",
      },
      include: {
        match: true,
      },
      orderBy: {
        match: {
          beginAt: "asc",
        },
      },
    });

    const { embed } = await buildActiveBetsEmbed(user, activeBets);

    const select = new StringSelectMenuBuilder()
      .setCustomId("mybets_select")
      .setPlaceholder("Choisissez une catégorie")
      .addOptions(
        {
          label: "Paris actifs",
          value: "active",
          description: "Voir vos paris actifs",
        },
        {
          label: "5 derniers paris",
          value: "recent",
          description: "Voir vos 5 derniers paris",
        },
        { label: "Duels", value: "duels", description: "Voir vos duels" },
        {
          label: "Combinés",
          value: "parlays",
          description: "Voir vos combinés",
        }
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      select
    );

    await interaction.editReply({
      embeds: [embed],
      components: [row],
      ephemeral: true,
    });
  } catch (error) {
    logger.error("Error in mybets command:", error);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xff6b6b)
      .setTitle("Erreur")
      .setDescription(
        "Une erreur s'est produite lors du chargement de vos paris. Veuillez réessayer plus tard."
      )
      .setTimestamp();

    try {
      await interaction.editReply({ embeds: [errorEmbed], ephemeral: true });
    } catch (replyError) {
      logger.error("Error sending error message:", replyError);
    }
  }
}

async function buildActiveBetsEmbed(user: any, activeBets: any[]) {
  const embed = new EmbedBuilder()
    .setColor(0x2196f3)
    .setTitle(activeBets.length > 0 ? "Vos Paris Actifs" : "Aucun Paris Actif")
    .setDescription(
      `${
        activeBets.length > 0
          ? `Vous avez **${activeBets.length}** pari(s) actif(s)`
          : "Vous n'avez aucun pari actif."
      }\n**Solde Actuel:** ${user.points} Perticoin`
    )
    .setTimestamp();

  if (activeBets.length > 0) {
    (activeBets as any[]).forEach((bet: any, index: number) => {
      const match = bet.match;
      const matchDate = formatDate(match.beginAt);
      const matchTime = formatTime(match.beginAt);
      const potentialWin = Math.floor(bet.amount * bet.odds);
      const isScore = (bet as any).type === "SCORE";
      const display = isScore
        ? `Score ${(bet as any).selection}`
        : (bet as any).selection;
      embed.addFields({
        name: `${index + 1}. ${match.kcTeam} vs ${match.opponent}`,
        value: `**Pari:** ${bet.amount} Perticoin sur ${display}\n**Cote:** ${bet.odds}x\n**Gain Potentiel:** ${potentialWin} Perticoin\n**Match:** ${matchDate} à ${matchTime}`,
        inline: false,
      });
    });

    const totalBet = activeBets.reduce((sum, bet) => sum + bet.amount, 0);
    const totalPotentialWin = activeBets.reduce(
      (sum, bet) => sum + Math.floor(bet.amount * bet.odds),
      0
    );

    embed.addFields({
      name: "Résumé",
      value: `**Total Parié:** ${totalBet} Perticoin\n**Total Gain Potentiel:** ${totalPotentialWin} Perticoin\n**Profit Potentiel:** ${
        totalPotentialWin - totalBet
      } Perticoin`,
      inline: false,
    });
  }

  return { embed };
}

async function buildRecentBetsEmbed(userId: string) {
  const recentBets = await prisma.bet.findMany({
    where: { userId, status: { in: ["WON", "LOST", "CANCELLED"] } },
    include: { match: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const embed = new EmbedBuilder()
    .setColor(0x9c27b0)
    .setTitle("Vos 5 Derniers Paris terminés")
    .setTimestamp();

  if (recentBets.length === 0) {
    embed.setDescription("Aucun pari trouvé.");
  } else {
    (recentBets as any[]).forEach((bet: any, index: number) => {
      const match = bet.match;
      const matchDate = match ? formatDate(match.beginAt) : "—";
      const matchTime = match ? formatTime(match.beginAt) : "—";
      const isScore = bet.type === "SCORE";
      const displayTeam = isScore ? `Score ${bet.selection}` : bet.selection;
      const potentialWin = Math.floor(bet.amount * bet.odds);
      embed.addFields({
        name: `${index + 1}. ${
          match ? `${match.kcTeam} vs ${match.opponent}` : "Match"
        }`,
        value: `**Pari:** ${
          bet.amount
        } Perticoin sur ${displayTeam}\n**Cote:** ${
          bet.odds
        }x\n**Gain Potentiel:** ${potentialWin} Perticoin\n**Statut:** ${formatBetStatus(
          bet.status
        )}\n**Match:** ${matchDate} à ${matchTime}`,
        inline: false,
      });
    });
  }

  return { embed };
}

async function buildDuelsEmbed(userId: string) {
  const duels = await prisma.duel.findMany({
    where: {
      OR: [{ challengerId: userId }, { opponentId: userId }],
      status: { in: ["PENDING", "ACCEPTED"] },
    },
    include: { match: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const embed = new EmbedBuilder()
    .setColor(0xf44336)
    .setTitle(duels.length > 0 ? "Vos Duels Actifs" : "Aucun Duel Actif")
    .setTimestamp();

  if (duels.length === 0) {
    embed.setDescription("Aucun duel actif.");
  } else {
    (duels as any[]).forEach((duel: any, index: number) => {
      const match = duel.match;
      const matchDate = match ? formatDate(match.beginAt) : "—";
      const matchTime = match ? formatTime(match.beginAt) : "—";
      const otherUserId =
        duel.challengerId === userId ? duel.opponentId : duel.challengerId;
      const yourTeam =
        duel.challengerId === userId ? duel.challengerTeam : duel.opponentTeam;
      embed.addFields({
        name: `${index + 1}. ${
          match ? `${match.kcTeam} vs ${match.opponent}` : "Match"
        }`,
        value: `**Adversaire:** <@${otherUserId}>\n**Votre équipe:** ${yourTeam}\n**Montant:** ${
          duel.amount
        } Perticoin\n**Statut:** ${formatDuelStatus(
          duel.status
        )}\n**Match:** ${matchDate} à ${matchTime}`,
        inline: false,
      });
    });
  }

  return { embed };
}

async function buildParlaysEmbed(userId: string) {
  const parlays = await prisma.parlay.findMany({
    where: { userId, status: "ACTIVE" },
    include: { legs: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const embed = new EmbedBuilder()
    .setColor(0x4caf50)
    .setTitle(parlays.length > 0 ? "Vos Parlays Actifs" : "Aucun Parlay Actif")
    .setTimestamp();

  if (parlays.length === 0) {
    embed.setDescription("Aucun parlay actif.");
  } else {
    (parlays as any[]).forEach((parlay: any, index: number) => {
      const potential = Math.floor(parlay.amount * parlay.totalOdds);
      const legsCount = parlay.legs?.length || 0;
      const legsSummary = (parlay.legs || [])
        .map(
          (l: any, i: number) =>
            `${i + 1}) ${l.type} - ${l.selection} (${l.odds}x)`
        )
        .join(" | ");
      embed.addFields({
        name: `${index + 1}. Parlay (${legsCount} sélections)`,
        value: `**Montant:** ${
          parlay.amount
        } Perticoin\n**Cotes totales:** ${parlay.totalOdds.toFixed(
          2
        )}x\n**Gain potentiel:** ${potential} Perticoin\n**Statut:** ${formatParlayStatus(
          parlay.status
        )}\n**Sélections:** ${legsSummary}`,
        inline: false,
      });
    });
  }

  return { embed };
}

export async function handleMyBetsSelect(interaction: any) {
  try {
    const userId = interaction.user.id;
    const selected = interaction.values[0];

    let built;
    if (selected === "active") {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      const activeBets = await prisma.bet.findMany({
        where: { userId, status: "ACTIVE" },
        include: { match: true },
        orderBy: { match: { beginAt: "asc" } },
      });
      built = await buildActiveBetsEmbed(user, activeBets);
    } else if (selected === "recent") {
      built = await buildRecentBetsEmbed(userId);
    } else if (selected === "duels") {
      built = await buildDuelsEmbed(userId);
    } else if (selected === "parlays") {
      built = await buildParlaysEmbed(userId);
    } else {
      built = await buildRecentBetsEmbed(userId);
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId("mybets_select")
      .setPlaceholder("Choisissez une catégorie")
      .addOptions(
        {
          label: "Paris actifs",
          value: "active",
          description: "Voir vos paris actifs",
        },
        {
          label: "5 derniers paris",
          value: "recent",
          description: "Voir vos 5 derniers paris",
        },
        { label: "Duels", value: "duels", description: "Voir vos duels" },
        {
          label: "Combinés",
          value: "parlays",
          description: "Voir vos combinés",
        }
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      select
    );

    await interaction.update({ embeds: [built.embed], components: [row] });
  } catch (error) {
    logger.error("Error in handleMyBetsSelect:", error);
    try {
      await interaction.update({
        content: "Erreur lors de la sélection.",
        embeds: [],
        components: [],
      });
    } catch {}
  }
}
