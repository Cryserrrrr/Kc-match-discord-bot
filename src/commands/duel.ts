import { SlashCommandBuilder } from "@discordjs/builders";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  User,
} from "discord.js";
import { prisma } from "../db";
import { logger } from "../utils/logger";
import { TitleManager } from "../utils/titleManager";
import { formatDateTime } from "../utils/dateUtils";
import { isMatchOpenForBetting, MIN_STAKE, parseStake } from "../utils/wallet";

const duelSessions = new Map<string, { amount: number }>();

export const data = new SlashCommandBuilder()
  .setName("duel")
  .setDescription("Défier un utilisateur 1v1 sur un match")
  .addSubcommand((s: any) =>
    s
      .setName("create")
      .setDescription("Créer un duel (assistant interactif)")
      .addUserOption((o: any) =>
        o
          .setName("adversaire")
          .setDescription("Utilisateur à défier")
          .setRequired(true)
      )
      .addIntegerOption((o: any) =>
        o
          .setName("montant")
          .setDescription("Montant (Perticoin)")
          .setRequired(false)
      )
  )
  .addSubcommand((s: any) =>
    s
      .setName("accept")
      .setDescription("Accepter un duel (fallback)")
      .addStringOption((o: any) =>
        o.setName("id").setDescription("ID du duel").setRequired(true)
      )
  )
  .addSubcommand((s: any) =>
    s
      .setName("cancel")
      .setDescription("Annuler un duel")
      .addStringOption((o: any) =>
        o.setName("id").setDescription("ID du duel").setRequired(true)
      )
  );

export async function execute(interaction: any) {
  try {
    const sub = interaction.options.getSubcommand();

    if (sub === "accept") {
      const id = interaction.options.getString("id");
      const duel = await prisma.duel.findUnique({ where: { id } });
      if (!duel) {
        await interaction.editReply({
          content: "Duel introuvable.",
          ephemeral: true,
        });
        return;
      }
      if (duel.opponentId !== interaction.user.id) {
        await interaction.editReply({
          content: "Vous n'êtes pas l'opposant.",
          ephemeral: true,
        });
        return;
      }
      const acceptError = await acceptDuel(duel);
      await interaction.editReply({
        content: acceptError ?? `Duel ${id} accepté.`,
        ephemeral: true,
      });
      return;
    }
    if (sub === "cancel") {
      const id = interaction.options.getString("id");
      const duel = await prisma.duel.findUnique({ where: { id } });
      if (!duel) {
        await interaction.editReply({
          content: "Duel introuvable.",
          ephemeral: true,
        });
        return;
      }
      if (duel.challengerId !== interaction.user.id) {
        await interaction.editReply({
          content: "Vous n'êtes pas l'initiateur.",
          ephemeral: true,
        });
        return;
      }
      // Only a duel that has not been accepted yet can be cancelled
      const cancelled = await prisma.duel.updateMany({
        where: { id, status: "PENDING" },
        data: { status: "CANCELLED" },
      });
      if (cancelled.count === 0) {
        await interaction.editReply({
          content: "Ce duel ne peut plus être annulé (déjà accepté ou terminé).",
          ephemeral: true,
        });
        return;
      }
      await interaction.editReply({
        content: `Duel ${id} annulé.`,
        ephemeral: true,
      });
      return;
    }
    // create (interactive)
    const opponent: User = interaction.options.getUser("adversaire");
    const presetAmount = interaction.options.getInteger("montant");

    if (opponent.id === interaction.user.id) {
      await interaction.editReply({
        content: "Vous ne pouvez pas vous défier vous-même.",
        ephemeral: true,
      });
      return;
    }

    if (opponent.bot) {
      await interaction.editReply({
        content: "Vous ne pouvez pas défier un bot.",
        ephemeral: true,
      });
      return;
    }

    await ensureUsersExist([interaction.user, opponent]);

    // Stash preset amount in a lightweight session
    if (presetAmount !== null && parseStake(presetAmount) === null) {
      await interaction.editReply({
        content: `La mise minimum est de ${MIN_STAKE} Perticoin.`,
        ephemeral: true,
      });
      return;
    }
    if (presetAmount && presetAmount > 0) {
      duelSessions.set(interaction.user.id, { amount: presetAmount });
    } else {
      duelSessions.delete(interaction.user.id);
    }

    const upcomingMatches = await prisma.match.findMany({
      where: { status: "not_started", beginAt: { gt: new Date() } },
      orderBy: { beginAt: "asc" },
      take: 10,
    });

    if (upcomingMatches.length === 0) {
      await interaction.editReply({
        content: "Aucun match à venir disponible pour un duel.",
        ephemeral: true,
      });
      return;
    }

    const options = upcomingMatches.map((m: any) => ({
      label: `${m.kcTeam} vs ${m.opponent}`,
      description: `${m.tournamentName} - ${formatDateTime(m.beginAt, {
        withTz: false,
      })}`,
      value: `${m.id}_${opponent.id}`,
    }));

    const select = new StringSelectMenuBuilder()
      .setCustomId("duel_select_match")
      .setPlaceholder("Choisissez un match pour votre duel")
      .addOptions(options);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      select
    );

    const embed = new EmbedBuilder()
      .setColor(0xf44336)
      .setTitle("Assistant de Création de Duel ⚔️")
      .setDescription(
        `Vous défiez <@${opponent.id}>. Sélectionnez un match pour continuer.`
      )
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed],
      components: [row],
      ephemeral: true,
    });
  } catch (error) {
    logger.error("Error in duel command:", error);
    await interaction.editReply({
      content: "Erreur de duel.",
      ephemeral: true,
    });
  }
}

async function respond(interaction: any, payload: any) {
  const { ephemeral, ...rest } = payload;
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(rest);
  } else {
    await interaction.reply({ ...rest, ephemeral: true });
  }
}

async function ensureUsersExist(users: User[]) {
  for (const u of users) {
    const existing = await prisma.user.findUnique({ where: { id: u.id } });
    if (!existing) {
      await prisma.user.create({
        data: { id: u.id, username: u.username, points: 1000 } as any,
      });
    }
  }
}

export async function handleDuelMatchSelect(interaction: any) {
  try {
    const [matchId, opponentId] = interaction.values[0].split("_");
    const match = await prisma.match.findUnique({ where: { id: matchId } });
    if (!match) {
      await interaction.update({
        content: "Match introuvable.",
        embeds: [],
        components: [],
      });
      return;
    }

    const kcBtn = new ButtonBuilder()
      .setCustomId(`duel_team_${matchId}_${match.kcTeam}_${opponentId}`)
      .setLabel(`${match.kcTeam}`)
      .setStyle(ButtonStyle.Primary);

    const oppBtn = new ButtonBuilder()
      .setCustomId(`duel_team_${matchId}_${match.opponent}_${opponentId}`)
      .setLabel(`${match.opponent}`)
      .setStyle(ButtonStyle.Secondary);

    const cancelBtn = new ButtonBuilder()
      .setCustomId("duel_cancel")
      .setLabel("Annuler")
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      kcBtn,
      oppBtn,
      cancelBtn
    );

    const embed = new EmbedBuilder()
      .setColor(0xf44336)
      .setTitle(`${match.kcTeam} vs ${match.opponent}`)
      .setDescription("Choisissez votre équipe pour ce duel")
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
    logger.error("Error in handleDuelMatchSelect:", error);
    try {
      await interaction.update({
        content: "Erreur lors de la sélection du match.",
        embeds: [],
        components: [],
      });
    } catch {}
  }
}

export async function handleDuelTeamPick(interaction: any) {
  try {
    const [, , matchId, team, opponentId] = interaction.customId.split("_");

    const match = await prisma.match.findUnique({ where: { id: matchId } });
    if (!match || (team !== match.kcTeam && team !== match.opponent)) {
      await interaction.update({
        content: "Équipe invalide.",
        embeds: [],
        components: [],
      });
      return;
    }

    const session = duelSessions.get(interaction.user.id);
    if (session?.amount && session.amount > 0) {
      await createDuelWithAmount(
        interaction,
        matchId,
        team,
        opponentId,
        session.amount
      );
      duelSessions.delete(interaction.user.id);
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`duel_amount_${matchId}_${team}_${opponentId}`)
      .setTitle("Montant du duel");

    const amountInput = new TextInputBuilder()
      .setCustomId("duel_amount")
      .setLabel("Montant (Perticoin)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("Entrez le montant")
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(10);

    const row = new ActionRowBuilder<TextInputBuilder>().addComponents(
      amountInput
    );
    modal.addComponents(row);

    await interaction.showModal(modal);
  } catch (error) {
    logger.error("Error in handleDuelTeamPick:", error);
    try {
      await interaction.update({
        content: "Erreur lors du choix de l'équipe.",
        embeds: [],
        components: [],
      });
    } catch {}
  }
}

export async function handleDuelAmountSubmit(interaction: any) {
  try {
    const [, , matchId, team, opponentId] = interaction.customId.split("_");
    const amount = parseStake(
      interaction.fields.getTextInputValue("duel_amount")
    );

    if (amount === null) {
      await respond(interaction, {
        content: `La mise minimum est de ${MIN_STAKE} Perticoin.`,
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const match = await prisma.match.findUnique({ where: { id: matchId } });
    if (!isMatchOpenForBetting(match)) {
      await respond(interaction, {
        content: "Match non disponible pour duel.",
        ephemeral: true,
      });
      return;
    }

    const challengerId = interaction.user.id;

    const challenger = await prisma.user.findUnique({
      where: { id: challengerId },
    });
    if (!challenger || challenger.points < amount) {
      await respond(interaction, {
        content: `Fonds insuffisants. Vous avez ${
          challenger?.points || 0
        } Perticoin.`,
        ephemeral: true,
      });
      return;
    }

    const opponentUser = await prisma.user.findUnique({
      where: { id: opponentId },
    });
    if (!opponentUser) {
      await prisma.user.create({
        data: { id: opponentId, username: "Unknown", points: 1000 } as any,
      });
    }

    const duel = await createDuel(
      matchId,
      team,
      opponentId,
      challengerId,
      match!,
      amount,
      interaction.guildId
    );

    await sendDuelNotifications(
      interaction,
      duel,
      match,
      challengerId,
      opponentId,
      team
    );
  } catch (error) {
    logger.error("Error in handleDuelAmountSubmit:", error);
    try {
      await respond(interaction, {
        content: "Erreur lors de la création du duel.",
        ephemeral: true,
      });
    } catch {}
  }
}

async function createDuelWithAmount(
  interaction: any,
  matchId: string,
  team: string,
  opponentId: string,
  amount: number
) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const match = await prisma.match.findUnique({ where: { id: matchId } });
    if (!isMatchOpenForBetting(match)) {
      await respond(interaction, {
        content: "Match non disponible pour duel.",
        ephemeral: true,
      });
      return;
    }

    const challengerId = interaction.user.id;

    const challenger = await prisma.user.findUnique({
      where: { id: challengerId },
    });
    if (!challenger || challenger.points < amount) {
      await respond(interaction, {
        content: `Fonds insuffisants. Vous avez ${
          challenger?.points || 0
        } Perticoin.`,
        ephemeral: true,
      });
      return;
    }

    const duel = await createDuel(
      matchId,
      team,
      opponentId,
      challengerId,
      match!,
      amount,
      interaction.guildId
    );

    await sendDuelNotifications(
      interaction,
      duel,
      match,
      challengerId,
      opponentId,
      team
    );
  } catch (error) {
    logger.error("Error in createDuelWithAmount:", error);
    try {
      await respond(interaction, {
        content: "Erreur lors de la création du duel.",
        ephemeral: true,
      });
    } catch {}
  }
}

async function createDuel(
  matchId: string,
  team: string,
  opponentId: string,
  challengerId: string,
  match: any,
  amount: number,
  guildId?: string
) {
  const opponentTeam = team === match.kcTeam ? match.opponent : match.kcTeam;
  const duel = await prisma.duel.create({
    data: {
      guildId: guildId || (match as any).guildId || "",
      matchId,
      challengerId,
      opponentId,
      challengerTeam: team,
      opponentTeam,
      amount,
    } as any,
  });
  try {
    const { TournamentUtils } = await import("../utils/tournamentUtils");
    const tutils = new TournamentUtils(prisma);
    await tutils.linkDuelIfEligible(
      guildId || "",
      challengerId,
      opponentId,
      duel.id,
      duel.createdAt as any
    );
  } catch {}
  return duel;
}

async function sendDuelNotifications(
  interaction: any,
  duel: any,
  match: any,
  challengerId: string,
  opponentId: string,
  team: string
) {
  const dmEmbed = new EmbedBuilder()
    .setColor(0xf44336)
    .setTitle("⚔️ Défi de Duel Reçu")
    .setDescription(
      `<@${challengerId}> vous défie sur ${match.kcTeam} vs ${match.opponent}`
    )
    .addFields(
      { name: "Montant", value: `${duel.amount} Perticoin`, inline: true },
      {
        name: "Votre équipe",
        value: team === match.kcTeam ? match.opponent : match.kcTeam,
        inline: true,
      },
      { name: "Son équipe", value: team, inline: true },
      {
        name: "Match",
        value: formatDateTime(match.beginAt, { withTz: false }),
        inline: false,
      }
    )
    .setFooter({
      text: `Duel ID: ${duel.id} • Le perdant verse la mise au gagnant`,
    })
    .setTimestamp();

  const acceptBtn = new ButtonBuilder()
    .setCustomId(`duel_accept_${duel.id}`)
    .setLabel("Accepter")
    .setStyle(ButtonStyle.Success);

  const rejectBtn = new ButtonBuilder()
    .setCustomId(`duel_reject_${duel.id}`)
    .setLabel("Refuser")
    .setStyle(ButtonStyle.Danger);

  const dmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    acceptBtn,
    rejectBtn
  );

  let dmOk = true;
  try {
    const user = await interaction.client.users.fetch(opponentId);
    await user.send({ embeds: [dmEmbed], components: [dmRow] });
  } catch (e) {
    dmOk = false;
    logger.warn("Unable to DM opponent for duel:", e);
  }

  const confirmEmbed = new EmbedBuilder()
    .setColor(0x4caf50)
    .setTitle("Duel créé")
    .setDescription(
      dmOk
        ? `Duel créé et envoyé à <@${opponentId}> en message privé.`
        : `Duel créé. Impossible d'envoyer un DM à <@${opponentId}>.`
    )
    .addFields(
      { name: "Équipe choisie", value: team, inline: true },
      { name: "Montant", value: `${duel.amount} Perticoin`, inline: true },
      { name: "ID", value: duel.id, inline: true }
    )
    .setTimestamp();

  await respond(interaction, { embeds: [confirmEmbed], ephemeral: true });
}

/**
 * Moves a duel from PENDING to ACCEPTED. Returns an error message for the user,
 * or null on success. Stakes are settled at resolution (loser pays winner).
 */
async function acceptDuel(duel: any): Promise<string | null> {
  if (duel.status !== "PENDING") {
    return "Ce duel n'est plus disponible.";
  }
  const match = await prisma.match.findUnique({ where: { id: duel.matchId } });
  if (!isMatchOpenForBetting(match)) {
    return "Le match a déjà commencé, le duel ne peut plus être accepté.";
  }
  const [challenger, opponent] = await Promise.all([
    prisma.user.findUnique({ where: { id: duel.challengerId } }),
    prisma.user.findUnique({ where: { id: duel.opponentId } }),
  ]);
  if (!opponent || opponent.points < duel.amount) {
    return `Fonds insuffisants pour accepter (${
      opponent?.points || 0
    } Perticoin).`;
  }
  if (!challenger || challenger.points < duel.amount) {
    return "Le challenger n'a plus assez de Perticoin pour ce duel.";
  }
  const accepted = await prisma.duel.updateMany({
    where: { id: duel.id, status: "PENDING" },
    data: { status: "ACCEPTED" },
  });
  if (accepted.count === 0) {
    return "Ce duel n'est plus disponible.";
  }
  return null;
}

export async function handleDuelAccept(interaction: any) {
  try {
    const [, , duelId] = interaction.customId.split("_");
    const duel = await prisma.duel.findUnique({ where: { id: duelId } });
    if (!duel) {
      await interaction.reply({
        content: "Duel introuvable.",
      });
      return;
    }
    if (interaction.user.id !== duel.opponentId) {
      await interaction.reply({
        content: "Vous n'êtes pas l'opposant.",
      });
      return;
    }
    const acceptError = await acceptDuel(duel);
    if (acceptError) {
      await interaction.reply({
        content: acceptError,
      });
      return;
    }

    await interaction.update({
      content: "Duel accepté ✅",
      embeds: [],
      components: [],
    });

    let opponentTitleUnlocked = false;
    let challengerTitleUnlocked = false;
    try {
      opponentTitleUnlocked = await TitleManager.unlockFirstDuelTitle(
        duel.opponentId,
        interaction.client
      );
      challengerTitleUnlocked = await TitleManager.unlockFirstDuelTitle(
        duel.challengerId,
        interaction.client
      );
    } catch (e) {
      logger.warn("Unable to unlock duel titles:", e);
    }

    if (opponentTitleUnlocked) {
      try {
        const user = await interaction.client.users.fetch(duel.opponentId);
        await user.send(
          "🎖️ **Nouveau Titre Débloqué !** Vous avez débloqué le titre **Gladiateur** !"
        );
      } catch (e) {
        logger.warn("Unable to DM opponent about title unlock:", e);
      }
    }

    if (challengerTitleUnlocked) {
      try {
        const user = await interaction.client.users.fetch(duel.challengerId);
        await user.send(
          "🎖️ **Nouveau Titre Débloqué !** Vous avez débloqué le titre **Gladiateur** !"
        );
      } catch (e) {
        logger.warn("Unable to DM challenger about title unlock:", e);
      }
    }

    try {
      const challenger = await interaction.client.users.fetch(
        duel.challengerId
      );
      await challenger.send(
        `Votre duel ${duelId} a été accepté par <@${duel.opponentId}>.`
      );
    } catch {}
  } catch (error) {
    logger.error("Error in handleDuelAccept:", error);
    try {
      await interaction.reply({
        content: "Erreur lors de l'acceptation du duel.",
      });
    } catch {}
  }
}

export async function handleDuelReject(interaction: any) {
  try {
    const [, , duelId] = interaction.customId.split("_");
    const duel = await prisma.duel.findUnique({ where: { id: duelId } });
    if (!duel) {
      await interaction.reply({
        content: "Duel introuvable.",
      });
      return;
    }
    if (interaction.user.id !== duel.opponentId) {
      await interaction.reply({
        content: "Vous n'êtes pas l'opposant.",
      });
      return;
    }
    const rejected = await prisma.duel.updateMany({
      where: { id: duelId, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
    if (rejected.count === 0) {
      await interaction.reply({
        content: "Ce duel n'est plus disponible.",
      });
      return;
    }
    await interaction.update({
      content: "Duel refusé ❌",
      embeds: [],
      components: [],
    });
    try {
      const challenger = await interaction.client.users.fetch(
        duel.challengerId
      );
      await challenger.send(
        `Votre duel ${duelId} a été refusé par <@${duel.opponentId}>.`
      );
    } catch {}
  } catch (error) {
    logger.error("Error in handleDuelReject:", error);
    try {
      await interaction.reply({
        content: "Erreur lors du refus du duel.",
      });
    } catch {}
  }
}

export async function handleDuelCancel(interaction: any) {
  try {
    await interaction.update({
      content: "Duel annulé.",
      embeds: [],
      components: [],
    });
  } catch (error) {
    logger.error("Error in handleDuelCancel:", error);
  }
}
