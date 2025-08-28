import { SlashCommandBuilder } from "@discordjs/builders";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { prisma } from "../index";
import { logger } from "../utils/logger";
import { TournamentUtils } from "../utils/tournamentUtils";
import { TitleManager } from "../utils/titleManager";

const tutils = new TournamentUtils(prisma);

function isAdmin(interaction: any): boolean {
  try {
    return (
      interaction.member?.permissions?.has("Administrator") ||
      interaction.member?.permissions?.has("ManageGuild") ||
      false
    );
  } catch {
    return false;
  }
}

export const data = new SlashCommandBuilder()
  .setName("tournament")
  .setDescription("Gérer et consulter le tournoi du serveur")
  .addSubcommand((s: any) =>
    s
      .setName("create")
      .setDescription("Créer un tournoi et ouvrir les inscriptions (assisté)")
      .addStringOption((o: any) =>
        o.setName("nom").setDescription("Nom du tournoi").setRequired(true)
      )
  )
  .addSubcommand((s: any) =>
    s
      .setName("stats")
      .setDescription("Voir le tournoi en cours ou le plus récent")
  )
  .addSubcommand((s: any) =>
    s
      .setName("set_end")
      .setDescription(
        "Définir/modifier la date de fin (en jours dès maintenant)"
      )
      .addIntegerOption((o: any) =>
        o
          .setName("jours")
          .setDescription("Finira dans X jours")
          .setRequired(true)
      )
  )
  .addSubcommand((s: any) =>
    s.setName("stop").setDescription("Arrêter le tournoi immédiatement")
  );

export async function execute(interaction: any) {
  try {
    const sub = interaction.options.getSubcommand();
    if (sub === "create") return handleCreate(interaction);
    if (sub === "set_end") return handleSetEnd(interaction);
    if (sub === "stop") return handleStop(interaction);
    return handleStats(interaction);
  } catch (error) {
    logger.error("Error in tournament command:", error);
    await interaction.editReply({
      content: "Erreur tournoi.",
      ephemeral: true,
    });
  }
}

const pendingCreateSessions = new Map<string, { name: string }>();

async function handleCreate(interaction: any) {
  if (!isAdmin(interaction)) {
    await interaction.editReply({
      content: "Permission requise.",
      ephemeral: true,
    });
    return;
  }
  const name = interaction.options.getString("nom");

  const modal = new ModalBuilder()
    .setCustomId(`tournament_create_modal`)
    .setTitle(`Créer ${name}`);

  const regInput = new TextInputBuilder()
    .setCustomId("reg_minutes")
    .setLabel("Durée des inscriptions (minutes)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Ex: 60")
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(5);

  const endInput = new TextInputBuilder()
    .setCustomId("end_days")
    .setLabel("Fin du tournoi (jours dès maintenant)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Ex: 3")
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(4);

  const stakeInput = new TextInputBuilder()
    .setCustomId("stake")
    .setLabel("Stake virtuel (défaut 100)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("100")
    .setRequired(false)
    .setMaxLength(6);

  const row1 = new ActionRowBuilder<TextInputBuilder>().addComponents(regInput);
  const row2 = new ActionRowBuilder<TextInputBuilder>().addComponents(endInput);
  const row3 = new ActionRowBuilder<TextInputBuilder>().addComponents(
    stakeInput
  );

  modal.addComponents(row1, row2, row3);

  pendingCreateSessions.set(interaction.user.id, { name });
  await interaction.showModal(modal);
}

async function handleSetEnd(interaction: any) {
  if (!isAdmin(interaction)) {
    await interaction.editReply({
      content: "Permission requise.",
      ephemeral: true,
    });
    return;
  }
  const guildId = interaction.guildId!;
  const days = interaction.options.getInteger("jours");
  const t = await tutils.getCurrentOrMostRecentTournament(guildId);
  if (!t) {
    await interaction.editReply({
      content: "Aucun tournoi trouvé.",
      ephemeral: true,
    });
    return;
  }
  const endsAt = new Date(Date.now() + days * 86_400_000);
  const updated = await (prisma as any).tournament.update({
    where: { id: t.id },
    data: {
      endsAt,
      status:
        (t.status as any) === "REGISTRATION" ? ("ACTIVE" as any) : t.status,
    },
  });
  await interaction.editReply({
    content: `Fin définie: <t:${Math.floor(endsAt.getTime() / 1000)}:F>`,
    ephemeral: true,
  });
}

async function handleStop(interaction: any) {
  if (!isAdmin(interaction)) {
    await interaction.editReply({
      content: "Permission requise.",
      ephemeral: true,
    });
    return;
  }
  const guildId = interaction.guildId!;
  const t = await tutils.getCurrentOrMostRecentTournament(guildId);
  if (!t) {
    await interaction.editReply({
      content: "Aucun tournoi trouvé.",
      ephemeral: true,
    });
    return;
  }
  await (prisma as any).tournament.update({
    where: { id: t.id },
    data: { status: "FINISHED" as any, endsAt: new Date() },
  });
  try {
    const participants = await (prisma as any).tournamentParticipant.findMany({
      where: { tournamentId: t.id },
      orderBy: { points: "desc" },
    });
    if (participants.length >= 20) {
      for (let i = 0; i < Math.min(3, participants.length); i++) {
        const p = participants[i];
        await TitleManager.unlockTournamentPlacementTitle(
          p.userId,
          i + 1,
          interaction.client
        );
      }
    }
  } catch {}
  await interaction.editReply({ content: "Tournoi arrêté.", ephemeral: true });
}

async function handleStats(interaction: any) {
  const guildId = interaction.guildId!;
  const t = await tutils.getCurrentOrMostRecentTournament(guildId);
  if (!t) {
    await interaction.editReply({
      content: "Aucun tournoi pour ce serveur.",
      ephemeral: true,
    });
    return;
  }
  const participants = await (prisma as any).tournamentParticipant.findMany({
    where: { tournamentId: t.id },
    orderBy: { points: "desc" },
    take: 20,
  });
  const total = await (prisma as any).tournamentParticipant.count({
    where: { tournamentId: t.id },
  });
  const lines = await Promise.all(
    participants.map(async (p: any, i: number) => {
      const user = await prisma.user.findUnique({ where: { id: p.userId } });
      return `${i + 1}. ${user?.username || p.userId} — ${p.points}`;
    })
  );

  const me = await (prisma as any).tournamentParticipant.findUnique({
    where: {
      tournamentId_userId: {
        tournamentId: t.id,
        userId: interaction.user.id,
      } as any,
    },
  } as any);

  let myInfo = "Vous n'êtes pas inscrit.";
  if (me) {
    const rank = await (prisma as any).tournamentParticipant.count({
      where: { tournamentId: t.id, points: { gt: me.points } },
    });
    myInfo = `Votre score: ${me.points} (rang #${rank + 1}/${total})`;
  }

  const statusText =
    (t.status as any) === "REGISTRATION" ? "INSCRIPTIONS" : (t.status as any);
  const embed = new EmbedBuilder()
    .setColor(0x673ab7)
    .setTitle(`Tournoi: ${t.name}`)
    .setDescription(lines.length > 0 ? lines.join("\n") : "Aucun participant")
    .addFields(
      { name: "Statut", value: String(statusText), inline: true },
      {
        name: "Fin",
        value: t.endsAt
          ? `<t:${Math.floor(new Date(t.endsAt).getTime() / 1000)}:F>`
          : "Non définie",
        inline: true,
      },
      { name: "Vos performances", value: myInfo, inline: false }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed], ephemeral: true });
}

export async function handleTournamentJoin(interaction: any) {
  try {
    const [, , tournamentId] = interaction.customId.split("_");
    const t = await (prisma as any).tournament.findUnique({
      where: { id: tournamentId },
    });
    if (!t || (t.status as any) !== "REGISTRATION") {
      await interaction.reply({
        content: "Inscriptions closes.",
        ephemeral: true,
      });
      return;
    }
    if (t.guildId !== interaction.guildId) {
      await interaction.reply({
        content: "Serveur invalide.",
        ephemeral: true,
      });
      return;
    }
    await tutils.joinTournament(t.id, interaction.user.id);
    await interaction.reply({
      content: "Inscription confirmée.",
      ephemeral: true,
    });
  } catch (error) {
    logger.error("Error in handleTournamentJoin:", error);
    try {
      await interaction.reply({
        content: "Erreur d'inscription.",
        ephemeral: true,
      });
    } catch {}
  }
}

export async function handleTournamentCreateModal(interaction: any) {
  try {
    const session = pendingCreateSessions.get(interaction.user.id);
    if (!session) {
      await interaction.reply({ content: "Session expirée.", ephemeral: true });
      return;
    }
    const guildId = interaction.guildId!;
    const existing = await (prisma as any).tournament.findFirst({
      where: { guildId, status: { in: ["REGISTRATION", "ACTIVE"] } as any },
    });
    if (existing) {
      pendingCreateSessions.delete(interaction.user.id);
      await interaction.reply({
        content: "Un tournoi est déjà en cours.",
        ephemeral: true,
      });
      return;
    }

    const regMinutesStr = interaction.fields.getTextInputValue("reg_minutes");
    const endDaysStr = interaction.fields.getTextInputValue("end_days");
    const stakeStr = interaction.fields.getTextInputValue("stake");

    const regMinutes = parseInt(regMinutesStr, 10);
    const endDays = parseInt(endDaysStr, 10);
    const stake = stakeStr ? Math.max(1, parseInt(stakeStr, 10)) : 100;
    if (!Number.isFinite(regMinutes) || regMinutes <= 0) {
      await interaction.reply({
        content: "Minutes invalides.",
        ephemeral: true,
      });
      return;
    }
    if (!Number.isFinite(endDays) || endDays <= 0) {
      await interaction.reply({ content: "Jours invalides.", ephemeral: true });
      return;
    }

    const now = Date.now();
    const registrationEndsAt = new Date(now + regMinutes * 60_000);
    const endsAt = new Date(now + endDays * 86_400_000);

    const t = await (prisma as any).tournament.create({
      data: {
        guildId,
        name: session.name,
        status: "REGISTRATION" as any,
        createdBy: interaction.user.id,
        registrationEndsAt,
        endsAt,
        virtualStake: stake,
      },
    });

    const joinBtn = new ButtonBuilder()
      .setCustomId(`tournament_join_${t.id}`)
      .setLabel("S'inscrire")
      .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(joinBtn);

    const embed = new EmbedBuilder()
      .setColor(0x00bcd4)
      .setTitle(`Tournoi: ${t.name}`)
      .setDescription(
        `Inscriptions ouvertes. Fin: <t:${Math.floor(
          registrationEndsAt.getTime() / 1000
        )}:R>\nStake virtuel: ${stake} | Fin tour: <t:${Math.floor(
          endsAt.getTime() / 1000
        )}:F>`
      )
      .addFields({ name: "Statut", value: "INSCRIPTIONS", inline: true });

    const message = await interaction.channel!.send({
      embeds: [embed],
      components: [row],
    });

    await (prisma as any).tournament.update({
      where: { id: t.id },
      data: { messageChannelId: message.channel.id, messageId: message.id },
    });

    pendingCreateSessions.delete(interaction.user.id);
    await interaction.reply({ content: "Tournoi créé.", ephemeral: true });
  } catch (error) {
    logger.error("Error in handleTournamentCreateModal:", error);
    try {
      await interaction.reply({
        content: "Erreur de création.",
        ephemeral: true,
      });
    } catch {}
  }
}
