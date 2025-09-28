import { SlashCommandBuilder } from "@discordjs/builders";
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from "discord.js";
import { prisma } from "../index";
import { logger } from "../utils/logger";
import {
  getTeamOddsForMatch,
  getScoreOddsForMatch,
  multiplyOdds,
} from "../utils/bettingUtils";
import { TitleManager } from "../utils/titleManager";
import { formatDateTime } from "../utils/dateUtils";
import { sendParlayAnnouncement } from "../utils/betAnnouncement";

type ParlayLeg = {
  matchId: string;
  type: "TEAM" | "SCORE";
  selection: string;
  odds: number;
};

const activeParlaySessions = new Map<
  string,
  { amount: number; legs: ParlayLeg[] }
>();

export const data = new SlashCommandBuilder()
  .setName("parlay")
  .setDescription("Créer un pari combiné (accumulateur) avec navigation")
  .addIntegerOption((o: any) =>
    o.setName("montant").setDescription("Montant total").setRequired(true)
  );

export async function execute(interaction: any) {
  try {
    const userId = interaction.user.id;
    const amount = interaction.options.getInteger("montant");

    if (amount < 25) {
      await interaction.editReply({
        content: "La mise minimum est de 25 Perticoin.",
        ephemeral: true,
      });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.points < amount) {
      await interaction.editReply({
        content: `Fonds insuffisants. Solde: ${user?.points || 0}`,
        ephemeral: true,
      });
      return;
    }

    activeParlaySessions.set(userId, { amount, legs: [] });

    const embed = buildParlayEmbed({ amount, legs: [] });
    const rows = buildMainRows(userId);
    await interaction.editReply({
      embeds: [embed],
      components: rows,
      ephemeral: true,
    });
  } catch (error) {
    logger.error("Error in parlay command:", error);
    await interaction.editReply({
      content: "Erreur lors de l'initialisation du parlay.",
      ephemeral: true,
    });
  }
}

function buildParlayEmbed(session: { amount: number; legs: ParlayLeg[] }) {
  const totalOdds = multiplyOdds(session.legs.map((l) => l.odds)) || 1;
  const potential = Math.floor(session.amount * totalOdds);
  const embed = new EmbedBuilder()
    .setColor(0x4caf50)
    .setTitle("Parlay en construction")
    .addFields(
      { name: "Montant", value: `${session.amount}`, inline: true },
      {
        name: "Multiplicateur",
        value: `${totalOdds.toFixed(2)}x`,
        inline: true,
      },
      { name: "Gain potentiel", value: `${potential}`, inline: true }
    )
    .setTimestamp();
  if (session.legs.length === 0) {
    embed.setDescription("Aucune sélection. Ajoutez une équipe ou un score.");
  } else {
    embed.addFields(
      session.legs.map((l, idx) => ({
        name: `${idx + 1}. ${l.type} - ${l.selection}`,
        value: `Match: ${l.matchId} | Cote: ${l.odds}x`,
        inline: false,
      }))
    );
  }
  return embed;
}

function buildMainRows(userId: string) {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`parlay_add_team`)
      .setLabel("Ajouter équipe")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`parlay_add_score`)
      .setLabel("Ajouter score")
      .setStyle(ButtonStyle.Secondary)
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`parlay_confirm`)
      .setLabel("Confirmer")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`parlay_cancel`)
      .setLabel("Annuler")
      .setStyle(ButtonStyle.Danger)
  );
  return [row1, row2];
}

async function updateParlayEmbed(interaction: any, userId: string) {
  const session = activeParlaySessions.get(userId);
  if (!session) return;
  const embed = buildParlayEmbed(session);
  const rows = buildMainRows(userId);

  if (interaction.isStringSelectMenu()) {
    await interaction.update({
      embeds: [embed],
      components: rows,
    });
  } else {
    await interaction.editReply({
      embeds: [embed],
      components: rows,
      ephemeral: true,
    });
  }
}

export async function handleParlayAddTeam(interaction: any) {
  const userId = interaction.user.id;
  const session = activeParlaySessions.get(userId);
  if (!session)
    return interaction.update({
      content: "Session expirée.",
      components: [],
      embeds: [],
    });

  const upcoming = await prisma.match.findMany({
    where: { status: "not_started", beginAt: { gt: new Date() } },
    orderBy: { beginAt: "asc" },
    take: 10,
  });
  const options = upcoming.map((m) => ({
    label: `${m.kcTeam} vs ${m.opponent}`,
    value: m.id,
    description: formatDateTime(m.beginAt, { withTz: false }),
  }));
  const select = new StringSelectMenuBuilder()
    .setCustomId("parlay_team_match")
    .setPlaceholder("Choisissez un match (équipe)")
    .addOptions(options);
  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    select
  );
  const embed = new EmbedBuilder()
    .setColor(0x2196f3)
    .setTitle("Ajouter une sélection d'équipe")
    .setDescription("Sélectionnez un match pour choisir l'équipe.");
  await interaction.update({ embeds: [embed], components: [row] });
}

export async function handleParlayTeamMatchSelect(interaction: any) {
  const matchId = interaction.values[0];
  const { match, dyn } = await getTeamOddsForMatch(matchId);
  const options = [
    {
      label: `${match.kcTeam} (${dyn.kcOdds}x)`,
      value: `${match.id}::${match.kcTeam}::${dyn.kcOdds}`,
      description: "Parier sur l'équipe KC",
    },
    {
      label: `${match.opponent} (${dyn.opponentOdds}x)`,
      value: `${match.id}::${match.opponent}::${dyn.opponentOdds}`,
      description: "Parier sur l'adversaire",
    },
  ];
  const select = new StringSelectMenuBuilder()
    .setCustomId("parlay_team_pick")
    .setPlaceholder("Choisissez l'équipe")
    .addOptions(options);
  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    select
  );
  const embed = new EmbedBuilder()
    .setColor(0x2196f3)
    .setTitle("Choisir l'équipe")
    .setDescription(`${match.kcTeam} vs ${match.opponent}`);
  await interaction.update({ embeds: [embed], components: [row] });
}

export async function handleParlayTeamPick(interaction: any) {
  const userId = interaction.user.id;
  const session = activeParlaySessions.get(userId);
  if (!session)
    return interaction.update({
      content: "Session expirée.",
      components: [],
      embeds: [],
    });
  const [matchId, team, oddsStr] = interaction.values[0].split("::");
  const odds = parseFloat(oddsStr);
  session.legs.push({ matchId, type: "TEAM", selection: team, odds });
  await updateParlayEmbed(interaction, userId);
}

export async function handleParlayAddScore(interaction: any) {
  const upcoming = await prisma.match.findMany({
    where: { status: "not_started", beginAt: { gt: new Date() } },
    orderBy: { beginAt: "asc" },
    take: 10,
  });
  const options = upcoming.map((m) => ({
    label: `${m.kcTeam} vs ${m.opponent}`,
    value: m.id,
    description: formatDateTime(m.beginAt, { withTz: false }),
  }));
  const select = new StringSelectMenuBuilder()
    .setCustomId("parlay_score_match")
    .setPlaceholder("Choisissez un match (score)")
    .addOptions(options);
  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    select
  );
  const embed = new EmbedBuilder()
    .setColor(0x2196f3)
    .setTitle("Ajouter une sélection de score")
    .setDescription("Sélectionnez un match pour choisir le score.");
  await interaction.update({ embeds: [embed], components: [row] });
}

export async function handleParlayScoreMatchSelect(interaction: any) {
  const matchId = interaction.values[0];
  const { match, scoreOdds } = await getScoreOddsForMatch(matchId);
  const entries = Object.entries(scoreOdds).sort((a, b) =>
    a[0].localeCompare(b[0])
  );
  const options = entries.map(([score, odds]) => ({
    label: `${score} (${odds}x)`,
    value: `${matchId}::${score}::${odds}`,
    description: `${match.kcTeam} vs ${match.opponent}`,
  }));
  const select = new StringSelectMenuBuilder()
    .setCustomId("parlay_score_pick")
    .setPlaceholder("Choisissez le score")
    .addOptions(options.slice(0, 25));
  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    select
  );
  const embed = new EmbedBuilder()
    .setColor(0x2196f3)
    .setTitle("Choisir le score")
    .setDescription(`${match.kcTeam} vs ${match.opponent}`);
  await interaction.update({ embeds: [embed], components: [row] });
}

export async function handleParlayScorePick(interaction: any) {
  const userId = interaction.user.id;
  const session = activeParlaySessions.get(userId);
  if (!session)
    return interaction.update({
      content: "Session expirée.",
      components: [],
      embeds: [],
    });
  const [matchId, score, oddsStr] = interaction.values[0].split("::");
  const odds = parseFloat(oddsStr);
  session.legs.push({ matchId, type: "SCORE", selection: score, odds });
  await updateParlayEmbed(interaction, userId);
}

export async function handleParlayConfirm(interaction: any) {
  try {
    const userId = interaction.user.id;
    const session = activeParlaySessions.get(userId);
    if (!session || session.legs.length < 2) {
      await interaction.update({
        content: "Ajoutez au moins 2 sélections.",
        components: [],
        embeds: [],
      });
      return;
    }
    if (session.amount < 25) {
      await interaction.update({
        content: "La mise minimum est de 25 Perticoin.",
        components: [],
        embeds: [],
      });
      return;
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.points < session.amount) {
      await interaction.update({
        content: `Fonds insuffisants. Solde: ${user?.points || 0}`,
        components: [],
        embeds: [],
      });
      return;
    }
    const totalOdds = multiplyOdds(session.legs.map((l) => l.odds));
    const parlay = await prisma.parlay.create({
      data: {
        guildId: interaction.guildId,
        userId,
        amount: session.amount,
        totalOdds,
        legs: {
          create: session.legs.map((l) => ({
            matchId: l.matchId,
            type: l.type,
            selection: l.selection,
            odds: l.odds,
          })),
        },
      } as any,
      include: { legs: true },
    });
    await prisma.user.update({
      where: { id: userId },
      data: { points: user.points - session.amount },
    });

    const titleUnlocked = await TitleManager.unlockFirstParlayTitle(
      userId,
      interaction.client
    );
    activeParlaySessions.delete(userId);
    try {
      if (interaction.guildId) {
        const { TournamentUtils } = await import("../utils/tournamentUtils");
        const tutils = new TournamentUtils(prisma);
        await tutils.linkParlayIfEligible(
          interaction.guildId,
          userId,
          parlay.id,
          parlay.createdAt as any
        );
      }
    } catch {}

    const embed = new EmbedBuilder()
      .setColor(0x4caf50)
      .setTitle("Parlay créé")
      .setDescription(
        `Cotes totales: ${totalOdds.toFixed(2)}x | Gain potentiel: ${Math.floor(
          session.amount * totalOdds
        )}`
      )
      .addFields(
        (
          (parlay as any).legs as Array<{
            type: string;
            selection: string;
            matchId: string;
            odds: number;
          }>
        ).map((l, idx) => ({
          name: `${idx + 1}. ${l.type} - ${l.selection}`,
          value: `Match: ${l.matchId} | Cote: ${l.odds}x`,
          inline: false,
        }))
      )
      .setTimestamp();

    if (titleUnlocked) {
      embed.addFields({
        name: "🎖️ Nouveau Titre Débloqué !",
        value: "Vous avez débloqué le titre **Stratège** !",
        inline: false,
      });
    }
    await interaction.update({ embeds: [embed], components: [] });

    await sendParlayAnnouncement(interaction, {
      amount: session.amount,
      totalOdds: totalOdds,
      legs: session.legs,
    });
  } catch (error) {
    logger.error("Error confirming parlay:", error);
    await interaction.update({
      content: "Erreur lors de la création du parlay.",
      components: [],
      embeds: [],
    });
  }
}

export async function handleParlayCancel(interaction: any) {
  const userId = interaction.user.id;
  activeParlaySessions.delete(userId);
  await interaction.update({
    content: "Parlay annulé.",
    embeds: [],
    components: [],
  });
}
