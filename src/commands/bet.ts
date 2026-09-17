import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { prisma } from "../db";
import {
  calculateBaseOddsFromHistory,
  calculateScoreOdds,
  calculateDynamicOdds,
  getPossibleScores,
} from "../utils/oddsCalculator";
import { TitleManager } from "../utils/titleManager";
import { TournamentUtils } from "../utils/tournamentUtils";
import { formatDateTime } from "../utils/dateUtils";
import { sendBetAnnouncement } from "../utils/betAnnouncement";
import {
  assertMatchOpenForBetting,
  BettingClosedError,
  debitPoints,
  InsufficientFundsError,
  isMatchOpenForBetting,
  MIN_STAKE,
  parseStake,
} from "../utils/wallet";

const activeBetSessions = new Map<string, any>();

export const data = new SlashCommandBuilder()
  .setName("bet")
  .setDescription("Placer un pari sur un match à venir");

export async function execute(interaction: any) {
  try {
    const userId = interaction.user.id;

    let user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          id: userId,
          username: interaction.user.username,
          points: 1000,
        },
      });
    }

    const upcomingMatches = await prisma.match.findMany({
      where: {
        status: "not_started",
        beginAt: {
          gt: new Date(),
        },
      },
      orderBy: {
        beginAt: "asc",
      },
      take: 10,
    });

    if (upcomingMatches.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(0xff6b6b)
        .setTitle("Aucun Match à Venir")
        .setDescription("Aucun match à venir trouvé")
        .setTimestamp();

      await interaction.editReply({ embeds: [embed], ephemeral: true });
      return;
    }

    const userBets = await prisma.bet.findMany({
      where: {
        userId: userId,
        matchId: { in: upcomingMatches.map((m) => m.id) },
      },
      select: { matchId: true },
    });
    const matchIdsWithBet = new Set(userBets.map((b) => b.matchId));

    const matchOptions = await Promise.all(
      upcomingMatches.map(async (match) => {
        const hasBet = matchIdsWithBet.has(match.id);
        const when = formatDateTime(match.beginAt, { withTz: false });
        const description = hasBet
          ? `${match.tournamentName} - ${when} - Pari déjà placé`
          : `${match.tournamentName} - ${when}`;

        return {
          label: `${match.kcTeam} vs ${match.opponent}`,
          description: description,
          value: match.id,
        };
      })
    );

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("select_match")
      .setPlaceholder("Choisissez un match pour parier")
      .addOptions(matchOptions);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      selectMenu
    );

    const embed = new EmbedBuilder()
      .setColor(0x2196f3)
      .setTitle("Placez Votre Pari")
      .setDescription(
        `Sélectionnez un match pour placer votre pari.\nVotre solde actuel : **${user.points} Perticoin**`
      )
      .addFields({
        name: "Matchs Disponibles",
        value: upcomingMatches.length.toString(),
        inline: true,
      })
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed],
      components: [row],
      ephemeral: true,
    });
  } catch (error) {
    console.error("Error in bet command:", error);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xff6b6b)
      .setTitle("Erreur")
      .setDescription(
        "Une erreur s'est produite lors du chargement des matchs. Veuillez réessayer plus tard."
      )
      .setTimestamp();

    try {
      await interaction.editReply({ embeds: [errorEmbed], ephemeral: true });
    } catch (replyError) {
      console.error("Error sending error message:", replyError);
    }
  }
}

export async function handleMatchSelection(interaction: any) {
  try {
    const matchId = interaction.values[0];
    const userId = interaction.user.id;

    const match = await prisma.match.findUnique({
      where: { id: matchId },
    });

    if (!match) {
      await interaction.update({
        content: "Match introuvable.",
        embeds: [],
        components: [],
      });
      return;
    }

    const allBets = await prisma.bet.findMany({
      where: { matchId: matchId },
    });

    const existingBets = (allBets as any[]).filter(
      (bet: any) => bet.userId === userId
    );
    const userTeamBets = (existingBets as any[]).filter(
      (bet: any) => bet.type === "TEAM"
    );
    const userScoreBets = (existingBets as any[]).filter(
      (bet: any) => bet.type === "SCORE"
    );
    const hasTeamBet = userTeamBets.length > 0;
    const hasScoreBet = userScoreBets.length > 0;

    const kcBets = (allBets as any[]).filter(
      (bet: any) => bet.type === "TEAM" && bet.selection === match.kcTeam
    );
    const opponentBets = (allBets as any[]).filter(
      (bet: any) => bet.type === "TEAM" && bet.selection === match.opponent
    );

    const kcTotalAmount = kcBets.reduce((sum, bet) => sum + bet.amount, 0);
    const opponentTotalAmount = opponentBets.reduce(
      (sum, bet) => sum + bet.amount,
      0
    );

    const baseOdds = await calculateBaseOddsFromHistory(match.opponent);
    const { kcOdds, opponentOdds } = calculateDynamicOdds(
      baseOdds.kcOdds,
      baseOdds.opponentOdds,
      kcTotalAmount,
      opponentTotalAmount
    );

    const scoreOdds = await calculateScoreOdds(
      match.opponent,
      match.numberOfGames
    );

    const sessionId = `${userId}_${matchId}`;
    const sessionData = {
      matchId,
      kcOdds,
      opponentOdds,
      scoreOdds,
      timestamp: Date.now(),
    };

    activeBetSessions.set(sessionId, sessionData);

    const kcButton = new ButtonBuilder()
      .setCustomId(`bet_team_${matchId}_${match.kcTeam}`)
      .setLabel(`Parier sur ${match.kcTeam} (${kcOdds}x)`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(match.status !== "not_started");

    const opponentButton = new ButtonBuilder()
      .setCustomId(`bet_team_${matchId}_${match.opponent}`)
      .setLabel(`Parier sur ${match.opponent} (${opponentOdds}x)`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(match.status !== "not_started");

    const scoreButton = new ButtonBuilder()
      .setCustomId(`bet_score_${matchId}`)
      .setLabel(`Parier sur le Score`)
      .setStyle(ButtonStyle.Success)
      .setDisabled(match.status !== "not_started");

    const cancelButton = new ButtonBuilder()
      .setCustomId("back_to_matches")
      .setLabel("Retour")
      .setStyle(ButtonStyle.Secondary);

    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      kcButton,
      opponentButton
    );

    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      scoreButton,
      cancelButton
    );

    const canIncreaseBet = match.status === "not_started";

    let description = `Choisissez sur quoi parier :`;
    if (hasTeamBet || hasScoreBet) {
      description += `\n\n**Vos paris existants :**`;
      if (hasTeamBet) {
        userTeamBets.forEach((bet: any) => {
          description += `\n• ${bet.amount} Perticoin sur ${bet.selection} (${bet.odds}x)`;
        });
      }
      if (hasScoreBet) {
        userScoreBets.forEach((bet: any) => {
          description += `\n• ${bet.amount} Perticoin sur le score ${bet.selection} (${bet.odds}x)`;
        });
      }

      if (!canIncreaseBet) {
        description += `\n\n⚠️ **Le match a commencé, vous ne pouvez plus parier.**`;
      }
    }

    const embed = new EmbedBuilder()
      .setColor(hasTeamBet || hasScoreBet ? 0xff9800 : 0x2196f3)
      .setTitle(`${match.kcTeam} vs ${match.opponent}`)
      .setDescription(description)
      .addFields(
        { name: "Tournoi", value: match.tournamentName, inline: true },
        {
          name: "Date",
          value: formatDateTime(match.beginAt, { withTz: false }),
          inline: true,
        },
        {
          name: "Cotes Actuelles",
          value: `${match.kcTeam}: ${kcOdds}x | ${match.opponent}: ${opponentOdds}x`,
          inline: false,
        },
        {
          name: "Total des Paris",
          value: `KC: ${kcTotalAmount} Perticoin | Adversaire: ${opponentTotalAmount} Perticoin`,
          inline: true,
        }
      )
      .setTimestamp();

    await interaction.update({ embeds: [embed], components: [row1, row2] });
  } catch (error) {
    console.error("Error in match selection:", error);
    await interaction.update({
      content: "An error occurred while selecting the match.",
      embeds: [],
      components: [],
    });
  }
}

export async function handleScoreSelection(interaction: any) {
  try {
    const customId = interaction.customId;
    const [, , matchId] = customId.split("_");
    const userId = interaction.user.id;

    const sessionId = `${userId}_${matchId}`;
    const session = activeBetSessions.get(sessionId);

    if (!session) {
      await interaction.update({
        content: "Session expirée. Veuillez recommencer.",
        embeds: [],
        components: [],
      });
      return;
    }

    const match = await prisma.match.findUnique({
      where: { id: matchId },
    });

    if (!match) {
      await interaction.update({
        content: "Match introuvable.",
        embeds: [],
        components: [],
      });
      return;
    }

    const scoreOdds = session.scoreOdds;
    const possibleScores = getPossibleScores(match.numberOfGames);

    const scoreOptions = possibleScores.map((score) => {
      const [kcScore, opponentScore] = score.split("-").map(Number);
      const description =
        kcScore > opponentScore
          ? `${match.kcTeam} gagne ${score}`
          : kcScore < opponentScore
          ? `${match.opponent} gagne ${score}`
          : `Match nul ${score}`;

      return {
        label: `${score} (${scoreOdds[score] || 3.0}x)`,
        value: `${score}_${scoreOdds[score] || 3.0}`,
        description: description,
      };
    });

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`bet_score_select_${matchId}`)
      .setPlaceholder("Choisissez le score prédit")
      .addOptions(scoreOptions);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      selectMenu
    );

    const embed = new EmbedBuilder()
      .setColor(0x2196f3)
      .setTitle("Pari sur le Score")
      .setDescription(
        `Choisissez le score final prédit pour ${match.kcTeam} vs ${match.opponent}`
      )
      .addFields(
        { name: "Tournoi", value: match.tournamentName, inline: true },
        {
          name: "Date",
          value: formatDateTime(match.beginAt, { withTz: false }),
          inline: true,
        }
      )
      .setTimestamp();

    await interaction.update({ embeds: [embed], components: [row] });
  } catch (error) {
    console.error("Error in score selection:", error);
    try {
      await interaction.update({
        content: "Une erreur s'est produite lors de la sélection du score.",
        embeds: [],
        components: [],
      });
    } catch (updateError) {
      console.error("Error updating interaction:", updateError);
    }
  }
}

export async function handleTeamSelection(interaction: any) {
  try {
    const customId = interaction.customId;
    const [, , matchId, team] = customId.split("_");
    const userId = interaction.user.id;

    const sessionId = `${userId}_${matchId}`;
    const session = activeBetSessions.get(sessionId);

    if (!session) {
      await interaction.update({
        content: "Session expirée. Veuillez recommencer.",
        embeds: [],
        components: [],
      });
      return;
    }

    const match = await prisma.match.findUnique({
      where: { id: matchId },
    });

    if (!match) {
      await interaction.update({
        content: "Match introuvable.",
        embeds: [],
        components: [],
      });
      return;
    }

    const existingBets = await prisma.bet.findMany({
      where: { matchId: matchId },
    });

    const kcBets = (existingBets as any[]).filter(
      (bet: any) => bet.type === "TEAM" && bet.selection === match.kcTeam
    );
    const opponentBets = (existingBets as any[]).filter(
      (bet: any) => bet.type === "TEAM" && bet.selection === match.opponent
    );

    const kcTotalAmount = kcBets.reduce((sum, bet) => sum + bet.amount, 0);
    const opponentTotalAmount = opponentBets.reduce(
      (sum, bet) => sum + bet.amount,
      0
    );

    const baseOdds = await calculateBaseOddsFromHistory(match.opponent);
    const { kcOdds, opponentOdds } = calculateDynamicOdds(
      baseOdds.kcOdds,
      baseOdds.opponentOdds,
      kcTotalAmount,
      opponentTotalAmount
    );

    const currentOdds = team === match.kcTeam ? kcOdds : opponentOdds;
    const sessionOdds =
      team === match.kcTeam ? session.kcOdds : session.opponentOdds;

    if (Math.abs(currentOdds - sessionOdds) > 0.01) {
      const embed = new EmbedBuilder()
        .setColor(0xff9800)
        .setTitle("Les Cotes Ont Changé")
        .setDescription(
          `Les cotes pour ${team} ont changé de ${sessionOdds}x à ${currentOdds}x.`
        )
        .addFields({
          name: "Nouvelles Cotes",
          value: `${match.kcTeam}: ${kcOdds}x | ${match.opponent}: ${opponentOdds}x`,
          inline: false,
        })
        .setTimestamp();

      await interaction.update({ embeds: [embed], components: [] });
      activeBetSessions.delete(sessionId);
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`bet_amount_${matchId}_${team}_${currentOdds}`)
      .setTitle("Entrez le Montant du Pari");

    const amountInput = new TextInputBuilder()
      .setCustomId("bet_amount")
      .setLabel("Montant (Perticoin)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("Entrez le montant que vous voulez parier")
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(10);

    const firstActionRow =
      new ActionRowBuilder<TextInputBuilder>().addComponents(amountInput);
    modal.addComponents(firstActionRow);

    await interaction.showModal(modal);
  } catch (error) {
    console.error("Error in team selection:", error);
    await interaction.update({
      content: "Une erreur s'est produite lors de la sélection de l'équipe.",
      embeds: [],
      components: [],
    });
  }
}

export async function handleScoreSelect(interaction: any) {
  try {
    const customId = interaction.customId;
    const [, , , matchId] = customId.split("_");
    const userId = interaction.user.id;
    const selectedValue = interaction.values[0];
    const [predictedScore, odds] = selectedValue.split("_");

    const sessionId = `${userId}_${matchId}`;
    const session = activeBetSessions.get(sessionId);

    if (!session) {
      await interaction.update({
        content: "Session expirée. Veuillez recommencer.",
        embeds: [],
        components: [],
      });
      return;
    }

    const match = await prisma.match.findUnique({
      where: { id: matchId },
    });

    if (!match) {
      await interaction.update({
        content: "Match introuvable.",
        embeds: [],
        components: [],
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`bet_score_amount_${matchId}_${predictedScore}_${odds}`)
      .setTitle("Montant du Pari sur le Score");

    const amountInput = new TextInputBuilder()
      .setCustomId("bet_amount")
      .setLabel("Montant (Perticoin)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("Entrez le montant que vous voulez parier")
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(10);

    const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(
      amountInput
    );
    modal.addComponents(actionRow);

    await interaction.showModal(modal);
  } catch (error) {
    console.error("Error in score select:", error);
    await interaction.update({
      content: "Une erreur s'est produite lors de la sélection du score.",
      embeds: [],
      components: [],
    });
  }
}

async function replyEphemeral(interaction: any, payload: any) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload);
    } else {
      await interaction.reply({ ...payload, ephemeral: true });
    }
  } catch (error) {
    console.error("Error sending bet response:", error);
  }
}

async function getTeamOdds(match: any) {
  const [kcAgg, opponentAgg] = await Promise.all([
    prisma.bet.aggregate({
      where: { matchId: match.id, type: "TEAM", selection: match.kcTeam },
      _sum: { amount: true },
    }),
    prisma.bet.aggregate({
      where: { matchId: match.id, type: "TEAM", selection: match.opponent },
      _sum: { amount: true },
    }),
  ]);
  const baseOdds = await calculateBaseOddsFromHistory(match.opponent);
  return calculateDynamicOdds(
    baseOdds.kcOdds,
    baseOdds.opponentOdds,
    kcAgg._sum.amount || 0,
    opponentAgg._sum.amount || 0
  );
}

async function placeBet(
  interaction: any,
  params: {
    matchId: string;
    type: "TEAM" | "SCORE";
    selection: string;
    amount: number;
    odds: number;
  }
) {
  const userId = interaction.user.id;
  return prisma.$transaction(async (tx) => {
    await assertMatchOpenForBetting(tx, params.matchId);
    await debitPoints(tx, userId, params.amount);
    const created = await tx.bet.create({
      data: {
        guildId: interaction.guildId || "",
        userId,
        matchId: params.matchId,
        type: params.type,
        selection: params.selection,
        amount: params.amount,
        odds: params.odds,
      },
    });
    const user = await tx.user.findUnique({ where: { id: userId } });
    return { created, newBalance: user?.points ?? 0 };
  });
}

async function handlePlaceBetError(interaction: any, error: any) {
  if (error instanceof InsufficientFundsError) {
    const user = await prisma.user.findUnique({
      where: { id: interaction.user.id },
    });
    await replyEphemeral(interaction, {
      content: `Fonds insuffisants. Vous avez ${user?.points || 0} Perticoin.`,
    });
    return true;
  }
  if (error instanceof BettingClosedError) {
    await replyEphemeral(interaction, {
      content: "Les paris sont fermés pour ce match.",
    });
    return true;
  }
  return false;
}

async function runPostBetSideEffects(
  interaction: any,
  created: { id: string; createdAt: Date }
): Promise<boolean> {
  const userId = interaction.user.id;
  if (interaction.guildId) {
    try {
      const tutils = new TournamentUtils(prisma);
      await tutils.linkBetIfEligible(
        interaction.guildId,
        userId,
        created.id,
        created.createdAt
      );
    } catch (error) {
      console.error("Error linking bet to tournament:", error);
    }
  }

  let titleUnlocked = false;
  try {
    titleUnlocked = await TitleManager.unlockFirstBetTitle(
      userId,
      interaction.client
    );
    await TitleManager.unlockBetCountMilestone(userId, interaction.client);
  } catch (error) {
    console.error("Error unlocking bet titles:", error);
  }
  return titleUnlocked;
}

export async function handleScoreBetAmount(interaction: any) {
  try {
    const customId = interaction.customId;
    const [, , , matchId, predictedScore] = customId.split("_");
    const userId = interaction.user.id;
    const amount = parseStake(
      interaction.fields.getTextInputValue("bet_amount")
    );

    if (amount === null) {
      await replyEphemeral(interaction, {
        content: `La mise minimum est de ${MIN_STAKE} Perticoin.`,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const match = await prisma.match.findUnique({
      where: { id: matchId },
    });

    if (!match) {
      await replyEphemeral(interaction, { content: "Match introuvable." });
      return;
    }

    if (!isMatchOpenForBetting(match)) {
      await replyEphemeral(interaction, {
        content: "Les paris sont fermés pour ce match.",
      });
      return;
    }

    if (!getPossibleScores(match.numberOfGames).includes(predictedScore)) {
      await replyEphemeral(interaction, { content: "Score invalide." });
      return;
    }

    // Odds are recomputed server-side; the value embedded in the customId is not trusted
    const scoreOdds = await calculateScoreOdds(
      match.opponent,
      match.numberOfGames
    );
    const sessionOdds = scoreOdds[predictedScore] || 3.0;

    let result;
    try {
      result = await placeBet(interaction, {
        matchId,
        type: "SCORE",
        selection: predictedScore,
        amount,
        odds: sessionOdds,
      });
    } catch (error) {
      if (await handlePlaceBetError(interaction, error)) return;
      throw error;
    }

    const titleUnlocked = await runPostBetSideEffects(
      interaction,
      result.created
    );

    const embed = new EmbedBuilder()
      .setColor(0x4caf50)
      .setTitle("Pari sur le Score Placé avec Succès ! 🎯")
      .setDescription(
        `Votre pari a été placé sur le score **${predictedScore}**`
      )
      .addFields(
        { name: "Score Prédit", value: predictedScore, inline: true },
        { name: "Montant", value: `${amount} Perticoin`, inline: true },
        { name: "Cote", value: `${sessionOdds}x`, inline: true },
        {
          name: "Gain Potentiel",
          value: `${Math.floor(amount * sessionOdds)} Perticoin`,
          inline: true,
        },
        {
          name: "Nouveau Solde",
          value: `${result.newBalance} Perticoin`,
          inline: true,
        }
      )
      .setTimestamp();

    if (titleUnlocked) {
      embed.addFields({
        name: "🎖️ Nouveau Titre Débloqué !",
        value: "Vous avez débloqué le titre **Parieur** !",
        inline: false,
      });
    }

    await replyEphemeral(interaction, { embeds: [embed] });

    try {
      await sendBetAnnouncement(interaction, {
        type: "SCORE",
        selection: predictedScore,
        amount: amount,
        odds: sessionOdds,
        matchId: matchId,
      });
    } catch (error) {
      console.error("Error sending score bet announcement:", error);
    }

    const sessionId = `${userId}_${matchId}`;
    activeBetSessions.delete(sessionId);
  } catch (error) {
    console.error("Error in score bet amount submission:", error);
    await replyEphemeral(interaction, {
      content:
        "Une erreur s'est produite lors du placement de votre pari sur le score.",
    });
  }
}

export async function handleBetAmount(interaction: any) {
  try {
    const customId = interaction.customId;
    const [, , matchId, team, odds] = customId.split("_");
    const userId = interaction.user.id;
    const amount = parseStake(
      interaction.fields.getTextInputValue("bet_amount")
    );

    if (amount === null) {
      await replyEphemeral(interaction, {
        content: `La mise minimum est de ${MIN_STAKE} Perticoin.`,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const match = await prisma.match.findUnique({
      where: { id: matchId },
    });

    if (!match) {
      await replyEphemeral(interaction, { content: "Match introuvable." });
      return;
    }

    if (!isMatchOpenForBetting(match)) {
      await replyEphemeral(interaction, {
        content: "Les paris sont fermés pour ce match.",
      });
      return;
    }

    if (team !== match.kcTeam && team !== match.opponent) {
      await replyEphemeral(interaction, { content: "Équipe invalide." });
      return;
    }

    const { kcOdds, opponentOdds } = await getTeamOdds(match);
    const currentOdds = team === match.kcTeam ? kcOdds : opponentOdds;
    const sessionOdds = parseFloat(odds);

    if (isNaN(sessionOdds) || Math.abs(currentOdds - sessionOdds) > 0.01) {
      const embed = new EmbedBuilder()
        .setColor(0xff9800)
        .setTitle("Les Cotes Ont Changé")
        .setDescription(
          `Les cotes pour ${team} ont changé de ${sessionOdds}x à ${currentOdds}x.`
        )
        .addFields({
          name: "Nouvelles Cotes",
          value: `${match.kcTeam}: ${kcOdds}x | ${match.opponent}: ${opponentOdds}x`,
          inline: false,
        })
        .setTimestamp();

      await replyEphemeral(interaction, { embeds: [embed] });
      return;
    }

    let result;
    try {
      result = await placeBet(interaction, {
        matchId,
        type: "TEAM",
        selection: team,
        amount,
        odds: currentOdds,
      });
    } catch (error) {
      if (await handlePlaceBetError(interaction, error)) return;
      throw error;
    }

    const titleUnlocked = await runPostBetSideEffects(
      interaction,
      result.created
    );

    const embed = new EmbedBuilder()
      .setColor(0x4caf50)
      .setTitle("Pari Placé avec Succès ! 🎯")
      .setDescription(`Votre pari a été placé sur **${team}**`)
      .addFields(
        { name: "Montant", value: `${amount} Perticoin`, inline: true },
        { name: "Cote", value: `${currentOdds}x`, inline: true },
        {
          name: "Gain Potentiel",
          value: `${Math.floor(amount * currentOdds)} Perticoin`,
          inline: true,
        },
        {
          name: "Nouveau Solde",
          value: `${result.newBalance} Perticoin`,
          inline: true,
        }
      )
      .setTimestamp();

    if (titleUnlocked) {
      embed.addFields({
        name: "🎖️ Nouveau Titre Débloqué !",
        value: "Vous avez débloqué le titre **Parieur** !",
        inline: false,
      });
    }

    await replyEphemeral(interaction, { embeds: [embed] });

    try {
      await sendBetAnnouncement(interaction, {
        type: "TEAM",
        selection: team,
        amount: amount,
        odds: currentOdds,
        matchId: matchId,
      });
    } catch (error) {
      console.error("Error sending bet announcement:", error);
    }

    const sessionId = `${userId}_${matchId}`;
    activeBetSessions.delete(sessionId);
  } catch (error) {
    console.error("Error in bet amount submission:", error);
    await replyEphemeral(interaction, {
      content: "Une erreur s'est produite lors du placement de votre pari.",
    });
  }
}

export async function handleBackToMatches(interaction: any) {
  try {
    const userId = interaction.user.id;

    let user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          id: userId,
          username: interaction.user.username,
          points: 1000,
        },
      });
    }

    const upcomingMatches = await prisma.match.findMany({
      where: {
        status: "not_started",
        beginAt: {
          gt: new Date(),
        },
      },
      orderBy: {
        beginAt: "asc",
      },
      take: 10,
    });

    if (upcomingMatches.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(0xff6b6b)
        .setTitle("Aucun Match à Venir")
        .setDescription("Aucun match à venir trouvé")
        .setTimestamp();

      await interaction.update({ embeds: [embed], components: [] });
      return;
    }

    const userBets = await prisma.bet.findMany({
      where: {
        userId: userId,
        matchId: { in: upcomingMatches.map((m) => m.id) },
      },
      select: { matchId: true },
    });
    const matchIdsWithBet = new Set(userBets.map((b) => b.matchId));

    const matchOptions = await Promise.all(
      upcomingMatches.map(async (match) => {
        const hasBet = matchIdsWithBet.has(match.id);
        const when = formatDateTime(match.beginAt, { withTz: false });
        const description = hasBet
          ? `${match.tournamentName} - ${when} - Pari déjà placé`
          : `${match.tournamentName} - ${when}`;

        return {
          label: `${match.kcTeam} vs ${match.opponent}`,
          description: description,
          value: match.id,
        };
      })
    );

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("select_match")
      .setPlaceholder("Choisissez un match pour parier")
      .addOptions(matchOptions);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      selectMenu
    );

    const embed = new EmbedBuilder()
      .setColor(0x2196f3)
      .setTitle("Placez Votre Pari")
      .setDescription(
        `Sélectionnez un match pour placer votre pari.\nVotre solde actuel : **${user.points} Perticoin**`
      )
      .addFields({
        name: "Matchs Disponibles",
        value: upcomingMatches.length.toString(),
        inline: true,
      })
      .setTimestamp();

    await interaction.update({
      embeds: [embed],
      components: [row],
    });
  } catch (error) {
    console.error("Error in handleBackToMatches:", error);
    await interaction.update({
      content:
        "Une erreur s'est produite lors du retour à la sélection des matchs.",
      embeds: [],
      components: [],
    });
  }
}

export async function handleBackToMatch(interaction: any) {
  try {
    const userId = interaction.user.id;

    const message = interaction.message;
    if (message && message.embeds && message.embeds.length > 0) {
      const embed = message.embeds[0];
      const title = embed.title;

      if (title && title.includes(" vs ")) {
        const matchTitle = title;
        const [kcTeam, opponent] = matchTitle.split(" vs ");

        const match = await prisma.match.findFirst({
          where: {
            kcTeam: kcTeam.trim(),
            opponent: opponent.trim(),
            status: "not_started",
          },
        });

        if (match) {
          // Keep the real interaction instance (spreading it loses its methods)
          interaction.values = [match.id];
          await handleMatchSelection(interaction);
          return;
        }
      }
    }

    await handleBackToMatches(interaction);
  } catch (error) {
    console.error("Error in handleBackToMatch:", error);
    await interaction.update({
      content: "Une erreur s'est produite lors du retour au match.",
      embeds: [],
      components: [],
    });
  }
}
