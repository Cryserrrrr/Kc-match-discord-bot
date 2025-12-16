import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelType,
} from "discord.js";
import { prisma } from "../index";
import { logger } from "../utils/logger";

const TEAMS = {
  "134078": "KC (LEC)",
  "128268": "KCB (LFL)",
  "136080": "KCBS (LFL2)",
  "130922": "KC Valorant",
  "132777": "KCGC Valorant",
  "136165": "KCBS Valorant",
  "129570": "KC Rocket League",
};

let selectedTeams: string[] = [];
let selectedRoles: string[] = [];
function createBackButton(): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId("back_to_main")
    .setLabel("← Retour au menu principal")
    .setStyle(ButtonStyle.Secondary);
}

function createActionRow(
  components: ButtonBuilder[]
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(components);
}

async function safeInteractionUpdate(interaction: any, options: any) {
  try {
    if (!interaction || interaction.isExpired) {
      logger.warn("Interaction is no longer valid, skipping update");
      return;
    }

    if (interaction.deferred && interaction.editReply) {
      await interaction.editReply(options);
    } else if (interaction.update) {
      await interaction.update(options);
    } else if (interaction.editReply) {
      await interaction.editReply(options);
    }

    setTimeout(async () => {
      try {
        if (interaction && !interaction.isExpired) {
          await interaction.editReply({
            embeds: [
              {
                title: "⏰ Session expirée",
                description:
                  "Cette session de configuration a expiré.\nUtilisez `/config` pour recommencer.",
                color: 0xff9900,
                timestamp: new Date().toISOString(),
              },
            ],
            components: [],
          });
        }
      } catch (error) {
        logger.warn("Could not update expired interaction:", error);
      }
    }, 60000);
  } catch (error: any) {
    if (
      error.code === 10062 ||
      error.message?.includes("Unknown interaction")
    ) {
      logger.warn("Interaction expired or became invalid, skipping update");
      return;
    }

    if (error.code && error.code >= 10000 && error.code < 10099) {
      logger.warn(`Discord API error ${error.code}: ${error.message}`);
      return;
    }

    logger.error("Error in safeInteractionUpdate:", error);
  }
}

export async function showChannelConfig(interaction: any, guildSettings: any) {
  const embed = new EmbedBuilder()
    .setTitle("📺 Configuration du Canal d'Annonce")
    .setDescription(
      "Sélectionnez le canal où les annonces de matchs seront envoyées.\n\n" +
        "**Canal actuel :** " +
        (guildSettings?.channelId
          ? `<#${guildSettings.channelId}>`
          : "Non configuré")
    )
    .setColor(0x0099ff);

  const guild = interaction.guild;
  const textChannels = guild.channels.cache
    .filter((channel: any) => channel.type === ChannelType.GuildText)
    .map((channel: any) => ({
      id: channel.id,
      name: channel.name,
      isCurrent: channel.id === guildSettings?.channelId,
    }))
    .sort((a: any, b: any) => {
      if (a.isCurrent) return -1;
      if (b.isCurrent) return 1;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 20);

  if (textChannels.length === 0) {
    const noChannelsEmbed = new EmbedBuilder()
      .setTitle("📺 Configuration du Canal d'Annonce")
      .setDescription(
        "Aucun canal texte trouvé dans ce serveur.\n\n" +
          "**Canal actuel :** " +
          (guildSettings?.channelId
            ? `<#${guildSettings.channelId}>`
            : "Non configuré")
      )
      .setColor(0xff0000);

    await safeInteractionUpdate(interaction, {
      embeds: [noChannelsEmbed],
      components: [createActionRow([createBackButton()])],
    });
    return;
  }

  const channelMenu = new StringSelectMenuBuilder()
    .setCustomId("channel_select")
    .setPlaceholder("Sélectionnez un canal")
    .addOptions(
      textChannels.map((channel: any) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(
            channel.name.length > 100
              ? channel.name.substring(0, 97) + "..."
              : channel.name
          )
          .setValue(channel.id)
          .setDescription(
            channel.isCurrent ? "Canal actuel" : "Cliquez pour sélectionner"
          )
          .setDefault(channel.isCurrent)
      )
    );

  const channelRow =
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(channelMenu);
  const buttonRow = createActionRow([createBackButton()]);

  await safeInteractionUpdate(interaction, {
    embeds: [embed],
    components: [channelRow, buttonRow],
  });
}

export async function handleChannelSelection(
  interaction: any,
  guildId: string
) {
  try {
    await interaction.deferUpdate();
  } catch (error: any) {
    if (
      error.code === 10062 ||
      error.message?.includes("Unknown interaction")
    ) {
      logger.warn("Interaction expired during channel selection, skipping");
      return;
    }
    logger.error("Error deferring channel selection update:", error);
    return;
  }

  const selectedChannelId = interaction.values[0];

  await prisma.guildSettings.upsert({
    where: { guildId },
    update: { channelId: selectedChannelId },
    create: {
      guildId,
      channelId: selectedChannelId,
      pingRoles: [],
      name: interaction.guild?.name || "Unknown Guild",
      memberCount: interaction.guild?.memberCount || 0,
    },
  });

  const embed = new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle("✅ Canal d'annonce configuré")
    .setDescription(
      `Le canal d'annonce a été défini sur <#${selectedChannelId}>`
    )
    .setTimestamp()
    .setFooter({
      text: `Configuré par ${interaction.user.tag}`,
      iconURL: interaction.user.displayAvatarURL(),
    });

  await safeInteractionUpdate(interaction, {
    embeds: [embed],
    components: [createActionRow([createBackButton()])],
  });

  logger.info(
    `Guild ${guildId} set announcement channel to ${selectedChannelId}`
  );
}

export async function showRolesConfig(interaction: any, guildSettings: any) {
  const currentPingRoles = (guildSettings as any)?.pingRoles || [];
  selectedRoles = [...currentPingRoles];

  const embed = new EmbedBuilder()
    .setTitle("👥 Configuration des Rôles à Mentionner")
    .setDescription(
      "Sélectionnez les rôles qui seront mentionnés dans les annonces de matchs.\n\n" +
        "**Rôles actuellement sélectionnés :**"
    )
    .setColor(0x0099ff);

  const guild = interaction.guild;
  const roles = Array.from(guild.roles.cache.values())
    .filter((role: any) => !role.managed && role.name !== "@everyone")
    .sort((a: any, b: any) => b.position - a.position)
    .slice(0, 18);

  const specialRoles = [
    { id: "everyone", name: "@everyone", isSpecial: true },
    { id: "here", name: "@here", isSpecial: true },
  ];

  const allRoles = [...specialRoles, ...roles];

  if (allRoles.length === 0) {
    const noRolesEmbed = new EmbedBuilder()
      .setTitle("👥 Configuration des Rôles à Mentionner")
      .setDescription(
        "Aucun rôle trouvé dans ce serveur.\n\n" +
          "**Rôles actuellement sélectionnés :** " +
          (currentPingRoles.length === 0
            ? "Aucun"
            : `${currentPingRoles.length} rôle(s)`)
      )
      .setColor(0xff0000);

    await safeInteractionUpdate(interaction, {
      embeds: [noRolesEmbed],
      components: [createActionRow([createBackButton()])],
    });
    return;
  }

  const roleStatus = allRoles
    .map((role: any) => {
      const isSelected = selectedRoles.includes(role.id);
      if (role.isSpecial) {
        return `${isSelected ? "✅" : "❌"} ${role.name}`;
      }
      return `${isSelected ? "✅" : "❌"} <@&${role.id}>`;
    })
    .join("\n");

  embed.addFields({
    name: "État des rôles",
    value: roleStatus || "Aucun rôle sélectionné",
    inline: false,
  });

  const roleButtons = allRoles.map((role: any) => {
    const isSelected = selectedRoles.includes(role.id);
    return new ButtonBuilder()
      .setCustomId(`role_${role.id}`)
      .setLabel(
        role.name.length > 20 ? role.name.substring(0, 17) + "..." : role.name
      )
      .setStyle(isSelected ? ButtonStyle.Success : ButtonStyle.Secondary);
  });

  const actionRows = [];
  for (let i = 0; i < roleButtons.length; i += 5) {
    actionRows.push(createActionRow(roleButtons.slice(i, i + 5)));
  }

  const controlRow = createActionRow([
    new ButtonBuilder()
      .setCustomId("confirm_roles")
      .setLabel("✅ Confirmer")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("clear_roles")
      .setLabel("🗑️ Tout effacer")
      .setStyle(ButtonStyle.Danger),
    createBackButton(),
  ]);

  actionRows.push(controlRow);

  await safeInteractionUpdate(interaction, {
    embeds: [embed],
    components: actionRows,
  });
}

export async function handleRoleSelection(interaction: any, guildId: string) {
  const roleId = interaction.customId.replace("role_", "");

  if (selectedRoles.includes(roleId)) {
    selectedRoles = selectedRoles.filter((id) => id !== roleId);
  } else {
    selectedRoles.push(roleId);
  }

  await updateRolesDisplay(interaction, guildId);
}

export async function handleRolesConfirmation(
  interaction: any,
  guildId: string
) {
  try {
    await interaction.deferUpdate();
  } catch (error: any) {
    if (
      error.code === 10062 ||
      error.message?.includes("Unknown interaction")
    ) {
      logger.warn("Interaction expired during roles confirmation, skipping");
      return;
    }
    logger.error("Error deferring roles confirmation update:", error);
    return;
  }

  await prisma.guildSettings.update({
    where: { guildId },
    data: { pingRoles: selectedRoles } as any,
  });

  const responseMessage =
    selectedRoles.length === 0
      ? "✅ **Configuration mise à jour :** Aucun rôle ne sera mentionné dans les annonces."
      : `✅ **Configuration mise à jour :** Les rôles suivants seront mentionnés :\n${selectedRoles
          .map((id) => {
            if (id === "everyone") return "@everyone";
            if (id === "here") return "@here";
            return `<@&${id}>`;
          })
          .join("\n")}`;

  await safeInteractionUpdate(interaction, {
    content: responseMessage,
    embeds: [],
    components: [],
  });

  logger.info(
    `Guild ${guildId} updated ping roles: ${
      selectedRoles.join(", ") || "no roles"
    }`
  );
}

export async function handleRolesClear(interaction: any, guildId: string) {
  selectedRoles = [];
  await updateRolesDisplay(interaction, guildId);
}

async function updateRolesDisplay(interaction: any, guildId: string) {
  const embed = new EmbedBuilder()
    .setTitle("👥 Configuration des Rôles à Mentionner")
    .setDescription(
      "Sélectionnez les rôles qui seront mentionnés dans les annonces de matchs.\n\n" +
        "**Rôles actuellement sélectionnés :**"
    )
    .setColor(0x0099ff);

  const guild = interaction.guild;
  const roles = Array.from(guild.roles.cache.values())
    .filter((role: any) => !role.managed && role.name !== "@everyone")
    .sort((a: any, b: any) => b.position - a.position)
    .slice(0, 18);

  const specialRoles = [
    { id: "everyone", name: "@everyone", isSpecial: true },
    { id: "here", name: "@here", isSpecial: true },
  ];

  const allRoles = [...specialRoles, ...roles];

  const roleStatus = allRoles
    .map((role: any) => {
      const isSelected = selectedRoles.includes(role.id);
      if (role.isSpecial) {
        return `${isSelected ? "✅" : "❌"} ${role.name}`;
      }
      return `${isSelected ? "✅" : "❌"} <@&${role.id}>`;
    })
    .join("\n");

  embed.addFields({
    name: "État des rôles",
    value: roleStatus || "Aucun rôle sélectionné",
    inline: false,
  });

  const roleButtons = allRoles.map((role: any) => {
    const isSelected = selectedRoles.includes(role.id);
    return new ButtonBuilder()
      .setCustomId(`role_${role.id}`)
      .setLabel(
        role.name.length > 20 ? role.name.substring(0, 17) + "..." : role.name
      )
      .setStyle(isSelected ? ButtonStyle.Success : ButtonStyle.Secondary);
  });

  const actionRows = [];
  for (let i = 0; i < roleButtons.length; i += 5) {
    actionRows.push(createActionRow(roleButtons.slice(i, i + 5)));
  }

  const controlRow = createActionRow([
    new ButtonBuilder()
      .setCustomId("confirm_roles")
      .setLabel("✅ Confirmer")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("clear_roles")
      .setLabel("🗑️ Tout effacer")
      .setStyle(ButtonStyle.Danger),
    createBackButton(),
  ]);

  actionRows.push(controlRow);

  await safeInteractionUpdate(interaction, {
    embeds: [embed],
    components: actionRows,
  });
}

export async function showTeamsConfig(interaction: any, guildSettings: any) {
  const currentFilteredTeams = (guildSettings as any)?.filteredTeams || [];
  selectedTeams =
    currentFilteredTeams.length === 0
      ? Object.keys(TEAMS)
      : [...currentFilteredTeams];

  const embed = new EmbedBuilder()
    .setTitle("🏆 Configuration du Filtre d'Équipes")
    .setDescription(
      "Sélectionnez les équipes que vous souhaitez annoncer. Cliquez sur les boutons pour activer/désactiver les équipes.\n\n" +
        "**Équipes actuellement sélectionnées :**"
    )
    .setColor(0x0099ff);

  const teamStatus = Object.entries(TEAMS)
    .map(([id, name]) => {
      const isSelected = selectedTeams.includes(id);
      return `${isSelected ? "✅" : "❌"} ${name}`;
    })
    .join("\n");

  embed.addFields({
    name: "État des équipes",
    value: teamStatus || "Aucune équipe sélectionnée",
    inline: false,
  });

  const teamButtons = Object.entries(TEAMS).map(([id, name]) => {
    const isSelected = selectedTeams.includes(id);
    return new ButtonBuilder()
      .setCustomId(`team_${id}`)
      .setLabel(name)
      .setStyle(isSelected ? ButtonStyle.Success : ButtonStyle.Secondary);
  });

  const actionRows = [];
  for (let i = 0; i < teamButtons.length; i += 5) {
    actionRows.push(createActionRow(teamButtons.slice(i, i + 5)));
  }

  const controlRow = createActionRow([
    new ButtonBuilder()
      .setCustomId("confirm_teams")
      .setLabel("✅ Confirmer")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("clear_teams")
      .setLabel("🗑️ Tout effacer")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("select_all_teams")
      .setLabel("📋 Tout sélectionner")
      .setStyle(ButtonStyle.Secondary),
    createBackButton(),
  ]);

  actionRows.push(controlRow);

  await safeInteractionUpdate(interaction, {
    embeds: [embed],
    components: actionRows,
  });
}

export async function handleTeamSelection(interaction: any, guildId: string) {
  const teamId = interaction.customId.replace("team_", "");

  if (selectedTeams.includes(teamId)) {
    selectedTeams = selectedTeams.filter((id) => id !== teamId);
  } else {
    selectedTeams.push(teamId);
  }

  await updateTeamsDisplay(interaction, guildId);
}

export async function handleTeamsConfirmation(
  interaction: any,
  guildId: string
) {
  try {
    await interaction.deferUpdate();
  } catch (error: any) {
    if (
      error.code === 10062 ||
      error.message?.includes("Unknown interaction")
    ) {
      logger.warn("Interaction expired during teams confirmation, skipping");
      return;
    }
    logger.error("Error deferring teams confirmation update:", error);
    return;
  }

  await prisma.guildSettings.update({
    where: { guildId },
    data: { filteredTeams: selectedTeams } as any,
  });

  const responseMessage =
    selectedTeams.length === 0
      ? "✅ **Filtre mis à jour :** Toutes les équipes de Karmine Corp seront annoncées."
      : `✅ **Filtre mis à jour :** Seules les équipes suivantes seront annoncées :\n${selectedTeams
          .map((id) => TEAMS[id as keyof typeof TEAMS] || id)
          .map((name) => `• ${name}`)
          .join("\n")}`;

  await safeInteractionUpdate(interaction, {
    content: responseMessage,
    embeds: [],
    components: [],
  });
}

export async function handleTeamsClear(interaction: any, guildId: string) {
  selectedTeams = [];
  await updateTeamsDisplay(interaction, guildId);
}

export async function handleTeamsSelectAll(interaction: any, guildId: string) {
  selectedTeams = Object.keys(TEAMS);
  await updateTeamsDisplay(interaction, guildId);
}

async function updateTeamsDisplay(interaction: any, guildId: string) {
  const embed = new EmbedBuilder()
    .setTitle("🏆 Configuration du Filtre d'Équipes")
    .setDescription(
      "Sélectionnez les équipes que vous souhaitez annoncer. Cliquez sur les boutons pour activer/désactiver les équipes.\n\n" +
        "**Équipes actuellement sélectionnées :**"
    )
    .setColor(0x0099ff);

  const teamStatus = Object.entries(TEAMS)
    .map(([id, name]) => {
      const isSelected = selectedTeams.includes(id);
      return `${isSelected ? "✅" : "❌"} ${name}`;
    })
    .join("\n");

  embed.addFields({
    name: "État des équipes",
    value: teamStatus || "Aucune équipe sélectionnée",
    inline: false,
  });

  const teamButtons = Object.entries(TEAMS).map(([id, name]) => {
    const isSelected = selectedTeams.includes(id);
    return new ButtonBuilder()
      .setCustomId(`team_${id}`)
      .setLabel(name)
      .setStyle(isSelected ? ButtonStyle.Success : ButtonStyle.Secondary);
  });

  const actionRows = [];
  for (let i = 0; i < teamButtons.length; i += 5) {
    actionRows.push(createActionRow(teamButtons.slice(i, i + 5)));
  }

  const controlRow = createActionRow([
    new ButtonBuilder()
      .setCustomId("confirm_teams")
      .setLabel("✅ Confirmer")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("clear_teams")
      .setLabel("🗑️ Tout effacer")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("select_all_teams")
      .setLabel("📋 Tout sélectionner")
      .setStyle(ButtonStyle.Secondary),
    createBackButton(),
  ]);

  actionRows.push(controlRow);

  await safeInteractionUpdate(interaction, {
    embeds: [embed],
    components: actionRows,
  });
}

export async function showPrematchConfig(interaction: any, guildSettings: any) {
  const prematchEnabled =
    (guildSettings as any)?.enablePreMatchNotifications || false;

  const embed = new EmbedBuilder()
    .setTitle("🔔 Configuration des Notifications Avant-Match")
    .setDescription(
      "Les notifications d'avant-match sont envoyées 30 minutes avant chaque match.\n\n" +
        "**État actuel :** " +
        (prematchEnabled ? "✅ Activé" : "❌ Désactivé")
    )
    .setColor(prematchEnabled ? 0x00ff00 : 0xff0000);

  const enableButton = new ButtonBuilder()
    .setCustomId("prematch_enable")
    .setLabel("✅ Activer")
    .setStyle(ButtonStyle.Success)
    .setDisabled(prematchEnabled);

  const disableButton = new ButtonBuilder()
    .setCustomId("prematch_disable")
    .setLabel("❌ Désactiver")
    .setStyle(ButtonStyle.Danger)
    .setDisabled(!prematchEnabled);

  await safeInteractionUpdate(interaction, {
    embeds: [embed],
    components: [
      createActionRow([enableButton, disableButton, createBackButton()]),
    ],
  });
}

export async function handlePrematchToggle(
  interaction: any,
  guildId: string,
  enabled: boolean
) {
  try {
    await interaction.deferUpdate();
  } catch (error: any) {
    if (
      error.code === 10062 ||
      error.message?.includes("Unknown interaction")
    ) {
      logger.warn("Interaction expired during prematch toggle, skipping");
      return;
    }
    logger.error("Error deferring prematch toggle update:", error);
    return;
  }

  await prisma.guildSettings.update({
    where: { guildId },
    data: { enablePreMatchNotifications: enabled },
  });

  const embed = new EmbedBuilder()
    .setColor(enabled ? "#00ff00" : "#ff0000")
    .setTitle("🔔 Configuration des notifications d'avant match")
    .setDescription(
      enabled
        ? "✅ Les notifications d'avant match sont maintenant **activées**"
        : "❌ Les notifications d'avant match sont maintenant **désactivées**"
    )
    .addFields({
      name: "📋 Détails",
      value: enabled
        ? "• Les notifications seront envoyées 30 minutes avant chaque match"
        : "• Aucune notification ne sera envoyée 30 minutes avant les matchs\n• Les autres notifications restent actives",
    })
    .setTimestamp()
    .setFooter({
      text: `Configuré par ${interaction.user.tag}`,
      iconURL: interaction.user.displayAvatarURL(),
    });

  await safeInteractionUpdate(interaction, {
    embeds: [embed],
    components: [createActionRow([createBackButton()])],
  });

  logger.info(
    `Guild ${guildId} ${
      enabled ? "enabled" : "disabled"
    } pre-match notifications`
  );
}

export async function showScoreConfig(interaction: any, guildSettings: any) {
  const scoreEnabled =
    (guildSettings as any)?.enableScoreNotifications === true;

  const embed = new EmbedBuilder()
    .setTitle("🏆 Configuration des Notifications de Score")
    .setDescription(
      "Les notifications de score sont envoyées à la fin de chaque match avec le résultat.\n\n" +
        "**État actuel :** " +
        (scoreEnabled ? "✅ Activé" : "❌ Désactivé")
    )
    .setColor(scoreEnabled ? 0x00ff00 : 0xff0000);

  const enableButton = new ButtonBuilder()
    .setCustomId("score_enable")
    .setLabel("✅ Activer")
    .setStyle(ButtonStyle.Success)
    .setDisabled(scoreEnabled);

  const disableButton = new ButtonBuilder()
    .setCustomId("score_disable")
    .setLabel("❌ Désactiver")
    .setStyle(ButtonStyle.Danger)
    .setDisabled(!scoreEnabled);

  await safeInteractionUpdate(interaction, {
    embeds: [embed],
    components: [
      createActionRow([enableButton, disableButton, createBackButton()]),
    ],
  });
}

export async function handleScoreToggle(
  interaction: any,
  guildId: string,
  enabled: boolean
) {
  try {
    await interaction.deferUpdate();
  } catch (error: any) {
    if (
      error.code === 10062 ||
      error.message?.includes("Unknown interaction")
    ) {
      logger.warn("Interaction expired during score toggle, skipping");
      return;
    }
    logger.error("Error deferring score toggle update:", error);
    return;
  }

  await prisma.guildSettings.update({
    where: { guildId },
    data: { enableScoreNotifications: enabled },
  });

  const embed = new EmbedBuilder()
    .setColor(enabled ? "#00ff00" : "#ff0000")
    .setTitle("🏆 Configuration des notifications de score")
    .setDescription(
      enabled
        ? "✅ Les notifications de score sont maintenant **activées**"
        : "❌ Les notifications de score sont maintenant **désactivées**"
    )
    .addFields({
      name: "📋 Détails",
      value: enabled
        ? "• Les notifications seront envoyées à la fin de chaque match avec le score"
        : "• Aucune notification ne sera envoyée à la fin des matchs\n• Les autres notifications restent actives",
    })
    .setTimestamp()
    .setFooter({
      text: `Configuré par ${interaction.user.tag}`,
      iconURL: interaction.user.displayAvatarURL(),
    });

  await safeInteractionUpdate(interaction, {
    embeds: [embed],
    components: [createActionRow([createBackButton()])],
  });

  logger.info(
    `Guild ${guildId} ${enabled ? "enabled" : "disabled"} score notifications`
  );
}

export async function showUpdateConfig(interaction: any, guildSettings: any) {
  const updateEnabled =
    (guildSettings as any)?.enableUpdateNotifications !== false;

  const embed = new EmbedBuilder()
    .setTitle("📢 Configuration des Notifications de Mise à Jour")
    .setDescription(
      "Les notifications de mise à jour sont envoyées lors de changements du bot (nouvelles fonctionnalités, corrections, etc.).\n\n" +
        "**État actuel :** " +
        (updateEnabled ? "✅ Activé" : "❌ Désactivé")
    )
    .setColor(updateEnabled ? 0x00ff00 : 0xff0000);

  const enableButton = new ButtonBuilder()
    .setCustomId("update_enable")
    .setLabel("✅ Activer")
    .setStyle(ButtonStyle.Success)
    .setDisabled(updateEnabled);

  const disableButton = new ButtonBuilder()
    .setCustomId("update_disable")
    .setLabel("❌ Désactiver")
    .setStyle(ButtonStyle.Danger)
    .setDisabled(!updateEnabled);

  await safeInteractionUpdate(interaction, {
    embeds: [embed],
    components: [
      createActionRow([enableButton, disableButton, createBackButton()]),
    ],
  });
}

export async function handleUpdateToggle(
  interaction: any,
  guildId: string,
  enabled: boolean
) {
  try {
    await interaction.deferUpdate();
  } catch (error: any) {
    if (
      error.code === 10062 ||
      error.message?.includes("Unknown interaction")
    ) {
      logger.warn("Interaction expired during update toggle, skipping");
      return;
    }
    logger.error("Error deferring update toggle update:", error);
    return;
  }

  await prisma.guildSettings.update({
    where: { guildId },
    data: { enableUpdateNotifications: enabled },
  });

  const embed = new EmbedBuilder()
    .setColor(enabled ? "#00ff00" : "#ff0000")
    .setTitle("📢 Configuration des notifications de mise à jour")
    .setDescription(
      enabled
        ? "✅ Les notifications de mise à jour sont maintenant **activées**"
        : "❌ Les notifications de mise à jour sont maintenant **désactivées**"
    )
    .addFields({
      name: "📋 Détails",
      value: enabled
        ? "• Les notifications seront envoyées lors de mises à jour du bot"
        : "• Aucune notification de mise à jour ne sera envoyée\n• Les autres notifications restent actives",
    })
    .setTimestamp()
    .setFooter({
      text: `Configuré par ${interaction.user.tag}`,
      iconURL: interaction.user.displayAvatarURL(),
    });

  await safeInteractionUpdate(interaction, {
    embeds: [embed],
    components: [createActionRow([createBackButton()])],
  });

  logger.info(
    `Guild ${guildId} ${enabled ? "enabled" : "disabled"} update notifications`
  );
}

export async function showTwitchConfig(interaction: any, guildSettings: any) {
  const twitchEnabled =
    (guildSettings as any)?.enableTwitchNotifications !== false;

  const embed = new EmbedBuilder()
    .setTitle("🔴 Configuration des Notifications de Stream Twitch")
    .setDescription(
      "Les notifications de stream Twitch sont envoyées lorsqu'un joueur de Karmine Corp commence à streamer.\n\n" +
        "**État actuel :** " +
        (twitchEnabled ? "✅ Activé" : "❌ Désactivé")
    )
    .setColor(twitchEnabled ? 0x00ff00 : 0xff0000);

  const enableButton = new ButtonBuilder()
    .setCustomId("twitch_enable")
    .setLabel("✅ Activer")
    .setStyle(ButtonStyle.Success)
    .setDisabled(twitchEnabled);

  const disableButton = new ButtonBuilder()
    .setCustomId("twitch_disable")
    .setLabel("❌ Désactiver")
    .setStyle(ButtonStyle.Danger)
    .setDisabled(!twitchEnabled);

  await safeInteractionUpdate(interaction, {
    embeds: [embed],
    components: [
      createActionRow([enableButton, disableButton, createBackButton()]),
    ],
  });
}

export async function handleTwitchToggle(
  interaction: any,
  guildId: string,
  enabled: boolean
) {
  try {
    await interaction.deferUpdate();
  } catch (error: any) {
    if (
      error.code === 10062 ||
      error.message?.includes("Unknown interaction")
    ) {
      logger.warn("Interaction expired during twitch toggle, skipping");
      return;
    }
    logger.error("Error deferring twitch toggle update:", error);
    return;
  }

  await prisma.guildSettings.update({
    where: { guildId },
    data: { enableTwitchNotifications: enabled },
  });

  const embed = new EmbedBuilder()
    .setColor(enabled ? "#00ff00" : "#ff0000")
    .setTitle("🔴 Configuration des notifications de stream Twitch")
    .setDescription(
      enabled
        ? "✅ Les notifications de stream Twitch sont maintenant **activées**"
        : "❌ Les notifications de stream Twitch sont maintenant **désactivées**"
    )
    .addFields({
      name: "📋 Détails",
      value: enabled
        ? "• Les notifications seront envoyées lorsqu'un joueur de Karmine Corp commence à streamer sur Twitch"
        : "• Aucune notification de stream Twitch ne sera envoyée\n• Les autres notifications restent actives",
    })
    .setTimestamp()
    .setFooter({
      text: `Configuré par ${interaction.user.tag}`,
      iconURL: interaction.user.displayAvatarURL(),
    });

  await safeInteractionUpdate(interaction, {
    embeds: [embed],
    components: [createActionRow([createBackButton()])],
  });

  logger.info(
    `Guild ${guildId} ${enabled ? "enabled" : "disabled"} twitch notifications`
  );
}
