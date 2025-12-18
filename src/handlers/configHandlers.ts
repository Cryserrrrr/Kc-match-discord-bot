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

const TEAMS: Record<string, string> = {
  "134078": "KC (LEC)",
  "128268": "KCB (LFL)",
  "136080": "KCBS (LFL2)",
  "130922": "KC Valorant",
  "132777": "KCGC Valorant",
  "136165": "KCBS Valorant",
  "129570": "KC Rocket League",
};

let selectedTeams: string[] = [];
let selectedTeamRoles: Record<string, string> = {};
let currentEditingTeamId: string | null = null;

function createBackButton(): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId("back_to_main")
    .setLabel("← Retour au menu principal")
    .setStyle(ButtonStyle.Secondary);
}

function createRolesBackButton(): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId("back_to_roles_menu")
    .setLabel("← Retour aux rôles")
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
      return;
    }
    if (interaction.deferred && interaction.editReply) {
      await interaction.editReply(options);
    } else if (interaction.update) {
      await interaction.update(options);
    } else if (interaction.editReply) {
      await interaction.editReply(options);
    }
  } catch (error: any) {
    if (
      error.code === 10062 ||
      error.message?.includes("Unknown interaction")
    ) {
      return;
    }
    if (error.code && error.code >= 10000 && error.code < 10099) {
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
      .setDescription("Aucun canal texte trouvé dans ce serveur.")
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
      return;
    }
    return;
  }

  const selectedChannelId = interaction.values[0];

  await prisma.guildSettings.upsert({
    where: { guildId },
    update: { channelId: selectedChannelId },
    create: {
      guildId,
      channelId: selectedChannelId,
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
}

export async function showRolesConfig(interaction: any, guildSettings: any) {
  const matchRole = guildSettings?.matchAnnouncementRole;
  const twitchRole = guildSettings?.twitchLiveRole;
  const teamRoles = (guildSettings?.teamRoles as Record<string, string>) || {};
  const teamRolesCount = Object.keys(teamRoles).filter(
    (k) => teamRoles[k]
  ).length;

  const embed = new EmbedBuilder()
    .setTitle("👥 Configuration des Rôles")
    .setDescription("Configurez les rôles à mentionner pour chaque type de notification.")
    .setColor(0x0099ff)
    .addFields(
      {
        name: "📢 Rôle Annonces Match",
        value: matchRole ? `<@&${matchRole}>` : "Non configuré",
        inline: true,
      },
      {
        name: "🔴 Rôle Live Twitch",
        value: twitchRole ? `<@&${twitchRole}>` : "Non configuré",
        inline: true,
      },
      {
        name: "🏆 Rôles par Équipe",
        value: teamRolesCount > 0 ? `${teamRolesCount} équipe(s) configurée(s)` : "Non configuré",
        inline: true,
      }
    );

  const rolesMenu = new StringSelectMenuBuilder()
    .setCustomId("roles_submenu")
    .setPlaceholder("Sélectionnez le type de rôle à configurer")
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel("Rôle Annonces Match")
        .setDescription("Matchs, scores et notifications journalières")
        .setValue("match_role")
        .setEmoji("📢"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Rôle Live Twitch")
        .setDescription("Notifications de stream Twitch")
        .setValue("twitch_role")
        .setEmoji("🔴"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Rôles par Équipe")
        .setDescription("Un rôle par équipe KC")
        .setValue("team_roles")
        .setEmoji("🏆")
    );

  const menuRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    rolesMenu
  );
  const buttonRow = createActionRow([createBackButton()]);

  await safeInteractionUpdate(interaction, {
    embeds: [embed],
    components: [menuRow, buttonRow],
  });
}

export async function showMatchRoleConfig(interaction: any, guildSettings: any) {
  const currentRole = guildSettings?.matchAnnouncementRole;

  const embed = new EmbedBuilder()
    .setTitle("📢 Rôle Annonces Match")
    .setDescription(
      "Sélectionnez le rôle à mentionner pour les annonces de match, scores et notifications journalières.\n\n" +
      "**Rôle actuel :** " +
      (currentRole ? `<@&${currentRole}>` : "Aucun")
    )
    .setColor(0x0099ff);

  const guild = interaction.guild;
  const roles = Array.from(guild.roles.cache.values())
    .filter((role: any) => !role.managed && role.name !== "@everyone")
    .sort((a: any, b: any) => b.position - a.position)
    .slice(0, 23);

  const specialRoles = [
    { id: "none", name: "❌ Aucun rôle", description: "Désactiver les mentions" },
    { id: "everyone", name: "@everyone", description: "Mentionner tout le monde" },
    { id: "here", name: "@here", description: "Mentionner les présents" },
  ];

  const options = [
    ...specialRoles.map((r) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(r.name)
        .setDescription(r.description)
        .setValue(`match_role_${r.id}`)
        .setDefault(currentRole === r.id || (!currentRole && r.id === "none"))
    ),
    ...roles.map((role: any) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(role.name.substring(0, 100))
        .setValue(`match_role_${role.id}`)
        .setDefault(currentRole === role.id)
    ),
  ];

  const roleMenu = new StringSelectMenuBuilder()
    .setCustomId("match_role_select")
    .setPlaceholder("Sélectionnez un rôle")
    .addOptions(options.slice(0, 25));

  const menuRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    roleMenu
  );
  const buttonRow = createActionRow([createRolesBackButton()]);

  await safeInteractionUpdate(interaction, {
    embeds: [embed],
    components: [menuRow, buttonRow],
  });
}

export async function handleMatchRoleSelection(
  interaction: any,
  guildId: string
) {
  try {
    await interaction.deferUpdate();
  } catch {
    return;
  }

  const selectedValue = interaction.values[0].replace("match_role_", "");
  const roleValue = selectedValue === "none" ? null : selectedValue;

  await prisma.guildSettings.update({
    where: { guildId },
    data: { matchAnnouncementRole: roleValue },
  });

  const embed = new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle("✅ Rôle Annonces Match configuré")
    .setDescription(
      roleValue
        ? roleValue === "everyone"
          ? "Le rôle @everyone sera mentionné"
          : roleValue === "here"
            ? "Le rôle @here sera mentionné"
            : `Le rôle <@&${roleValue}> sera mentionné`
        : "Aucun rôle ne sera mentionné"
    )
    .setTimestamp();

  await safeInteractionUpdate(interaction, {
    embeds: [embed],
    components: [createActionRow([createRolesBackButton()])],
  });
}

export async function showTwitchRoleConfig(interaction: any, guildSettings: any) {
  const currentRole = guildSettings?.twitchLiveRole;

  const embed = new EmbedBuilder()
    .setTitle("🔴 Rôle Live Twitch")
    .setDescription(
      "Sélectionnez le rôle à mentionner pour les notifications de stream Twitch.\n\n" +
      "**Rôle actuel :** " +
      (currentRole ? `<@&${currentRole}>` : "Aucun")
    )
    .setColor(0x9146ff);

  const guild = interaction.guild;
  const roles = Array.from(guild.roles.cache.values())
    .filter((role: any) => !role.managed && role.name !== "@everyone")
    .sort((a: any, b: any) => b.position - a.position)
    .slice(0, 23);

  const specialRoles = [
    { id: "none", name: "❌ Aucun rôle", description: "Désactiver les mentions" },
    { id: "everyone", name: "@everyone", description: "Mentionner tout le monde" },
    { id: "here", name: "@here", description: "Mentionner les présents" },
  ];

  const options = [
    ...specialRoles.map((r) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(r.name)
        .setDescription(r.description)
        .setValue(`twitch_role_${r.id}`)
        .setDefault(currentRole === r.id || (!currentRole && r.id === "none"))
    ),
    ...roles.map((role: any) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(role.name.substring(0, 100))
        .setValue(`twitch_role_${role.id}`)
        .setDefault(currentRole === role.id)
    ),
  ];

  const roleMenu = new StringSelectMenuBuilder()
    .setCustomId("twitch_role_select")
    .setPlaceholder("Sélectionnez un rôle")
    .addOptions(options.slice(0, 25));

  const menuRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    roleMenu
  );
  const buttonRow = createActionRow([createRolesBackButton()]);

  await safeInteractionUpdate(interaction, {
    embeds: [embed],
    components: [menuRow, buttonRow],
  });
}

export async function handleTwitchRoleSelection(
  interaction: any,
  guildId: string
) {
  try {
    await interaction.deferUpdate();
  } catch {
    return;
  }

  const selectedValue = interaction.values[0].replace("twitch_role_", "");
  const roleValue = selectedValue === "none" ? null : selectedValue;

  await prisma.guildSettings.update({
    where: { guildId },
    data: { twitchLiveRole: roleValue },
  });

  const embed = new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle("✅ Rôle Live Twitch configuré")
    .setDescription(
      roleValue
        ? roleValue === "everyone"
          ? "Le rôle @everyone sera mentionné"
          : roleValue === "here"
            ? "Le rôle @here sera mentionné"
            : `Le rôle <@&${roleValue}> sera mentionné`
        : "Aucun rôle ne sera mentionné"
    )
    .setTimestamp();

  await safeInteractionUpdate(interaction, {
    embeds: [embed],
    components: [createActionRow([createRolesBackButton()])],
  });
}

export async function showTeamRolesConfig(interaction: any, guildSettings: any) {
  const teamRoles = (guildSettings?.teamRoles as Record<string, string>) || {};
  selectedTeamRoles = { ...teamRoles };

  const embed = new EmbedBuilder()
    .setTitle("🏆 Rôles par Équipe")
    .setDescription(
      "Configurez un rôle à mentionner pour chaque équipe KC.\n" +
      "Ce rôle sera mentionné en plus du rôle d'annonce principal."
    )
    .setColor(0x0099ff);

  const teamStatus = Object.entries(TEAMS)
    .map(([id, name]) => {
      const roleId = teamRoles[id];
      return `${roleId ? "✅" : "❌"} **${name}** : ${roleId ? `<@&${roleId}>` : "Non configuré"
        }`;
    })
    .join("\n");

  embed.addFields({
    name: "État des équipes",
    value: teamStatus,
    inline: false,
  });

  const teamMenu = new StringSelectMenuBuilder()
    .setCustomId("team_role_select_team")
    .setPlaceholder("Sélectionnez une équipe à configurer")
    .addOptions(
      Object.entries(TEAMS).map(([id, name]) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(name)
          .setValue(`team_${id}`)
          .setDescription(teamRoles[id] ? "Rôle configuré" : "Non configuré")
      )
    );

  const menuRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    teamMenu
  );

  const clearButton = new ButtonBuilder()
    .setCustomId("clear_team_roles")
    .setLabel("🗑️ Tout effacer")
    .setStyle(ButtonStyle.Danger);

  const buttonRow = createActionRow([clearButton, createRolesBackButton()]);

  await safeInteractionUpdate(interaction, {
    embeds: [embed],
    components: [menuRow, buttonRow],
  });
}

export async function showTeamRoleSelection(
  interaction: any,
  teamId: string,
  guildSettings: any
) {
  currentEditingTeamId = teamId;
  const teamName = TEAMS[teamId] || teamId;
  const teamRoles = (guildSettings?.teamRoles as Record<string, string>) || {};
  const currentRole = teamRoles[teamId];

  const embed = new EmbedBuilder()
    .setTitle(`🏆 Rôle pour ${teamName}`)
    .setDescription(
      `Sélectionnez le rôle à mentionner pour l'équipe **${teamName}**.\n\n` +
      "**Rôle actuel :** " +
      (currentRole ? `<@&${currentRole}>` : "Aucun")
    )
    .setColor(0x0099ff);

  const guild = interaction.guild;
  const roles = Array.from(guild.roles.cache.values())
    .filter((role: any) => !role.managed && role.name !== "@everyone")
    .sort((a: any, b: any) => b.position - a.position)
    .slice(0, 24);

  const options = [
    new StringSelectMenuOptionBuilder()
      .setLabel("❌ Aucun rôle")
      .setDescription("Ne pas mentionner de rôle spécifique")
      .setValue(`teamrole_${teamId}_none`)
      .setDefault(!currentRole),
    ...roles.map((role: any) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(role.name.substring(0, 100))
        .setValue(`teamrole_${teamId}_${role.id}`)
        .setDefault(currentRole === role.id)
    ),
  ];

  const roleMenu = new StringSelectMenuBuilder()
    .setCustomId("team_role_assign")
    .setPlaceholder("Sélectionnez un rôle")
    .addOptions(options.slice(0, 25));

  const menuRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    roleMenu
  );

  const backToTeamsButton = new ButtonBuilder()
    .setCustomId("back_to_team_roles")
    .setLabel("← Retour aux équipes")
    .setStyle(ButtonStyle.Secondary);

  const buttonRow = createActionRow([backToTeamsButton]);

  await safeInteractionUpdate(interaction, {
    embeds: [embed],
    components: [menuRow, buttonRow],
  });
}

export async function handleTeamRoleAssignment(
  interaction: any,
  guildId: string
) {
  try {
    await interaction.deferUpdate();
  } catch {
    return;
  }

  const value = interaction.values[0];
  const parts = value.replace("teamrole_", "").split("_");
  const teamId = parts[0];
  const roleId = parts[1];

  const guildSettings = await prisma.guildSettings.findUnique({
    where: { guildId },
  });

  const teamRoles = ((guildSettings as any)?.teamRoles as Record<string, string>) || {};

  if (roleId === "none") {
    delete teamRoles[teamId];
  } else {
    teamRoles[teamId] = roleId;
  }

  await prisma.guildSettings.update({
    where: { guildId },
    data: { teamRoles: teamRoles },
  });

  const teamName = TEAMS[teamId] || teamId;
  const embed = new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle("✅ Rôle d'équipe configuré")
    .setDescription(
      roleId === "none"
        ? `Aucun rôle ne sera mentionné pour **${teamName}**`
        : `Le rôle <@&${roleId}> sera mentionné pour **${teamName}**`
    )
    .setTimestamp();

  const backToTeamsButton = new ButtonBuilder()
    .setCustomId("back_to_team_roles")
    .setLabel("← Retour aux équipes")
    .setStyle(ButtonStyle.Secondary);

  await safeInteractionUpdate(interaction, {
    embeds: [embed],
    components: [createActionRow([backToTeamsButton])],
  });
}

export async function handleClearTeamRoles(interaction: any, guildId: string) {
  try {
    await interaction.deferUpdate();
  } catch {
    return;
  }

  await prisma.guildSettings.update({
    where: { guildId },
    data: { teamRoles: {} },
  });

  const embed = new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle("✅ Rôles d'équipe effacés")
    .setDescription("Tous les rôles d'équipe ont été supprimés.")
    .setTimestamp();

  await safeInteractionUpdate(interaction, {
    embeds: [embed],
    components: [createActionRow([createRolesBackButton()])],
  });
}

export async function showTeamsConfig(interaction: any, guildSettings: any) {
  const currentFilteredTeams = guildSettings?.filteredTeams || [];
  selectedTeams =
    currentFilteredTeams.length === 0
      ? Object.keys(TEAMS)
      : [...currentFilteredTeams];

  const embed = new EmbedBuilder()
    .setTitle("🏆 Configuration du Filtre d'Équipes")
    .setDescription(
      "Sélectionnez les équipes dont vous souhaitez recevoir les annonces."
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
    value: teamStatus,
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
  await updateTeamsDisplay(interaction);
}

export async function handleTeamsConfirmation(
  interaction: any,
  guildId: string
) {
  try {
    await interaction.deferUpdate();
  } catch {
    return;
  }

  await prisma.guildSettings.update({
    where: { guildId },
    data: { filteredTeams: selectedTeams },
  });

  const responseMessage =
    selectedTeams.length === 0
      ? "✅ **Filtre mis à jour :** Toutes les équipes seront annoncées."
      : `✅ **Filtre mis à jour :** Seules les équipes suivantes seront annoncées :\n${selectedTeams
        .map((id) => TEAMS[id] || id)
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
  await updateTeamsDisplay(interaction);
}

export async function handleTeamsSelectAll(interaction: any, guildId: string) {
  selectedTeams = Object.keys(TEAMS);
  await updateTeamsDisplay(interaction);
}

async function updateTeamsDisplay(interaction: any) {
  const embed = new EmbedBuilder()
    .setTitle("🏆 Configuration du Filtre d'Équipes")
    .setDescription(
      "Sélectionnez les équipes dont vous souhaitez recevoir les annonces."
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
    value: teamStatus,
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
  const prematchEnabled = guildSettings?.enablePreMatchNotifications || false;

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
  } catch {
    return;
  }

  await prisma.guildSettings.update({
    where: { guildId },
    data: { enablePreMatchNotifications: enabled },
  });

  const embed = new EmbedBuilder()
    .setColor(enabled ? "#00ff00" : "#ff0000")
    .setTitle("🔔 Notifications avant-match")
    .setDescription(
      enabled
        ? "✅ Les notifications d'avant match sont maintenant **activées**"
        : "❌ Les notifications d'avant match sont maintenant **désactivées**"
    )
    .setTimestamp();

  await safeInteractionUpdate(interaction, {
    embeds: [embed],
    components: [createActionRow([createBackButton()])],
  });
}

export async function showScoreConfig(interaction: any, guildSettings: any) {
  const scoreEnabled = guildSettings?.enableScoreNotifications === true;

  const embed = new EmbedBuilder()
    .setTitle("🏆 Configuration des Notifications de Score")
    .setDescription(
      "Les notifications de score sont envoyées à la fin de chaque match.\n\n" +
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
  } catch {
    return;
  }

  await prisma.guildSettings.update({
    where: { guildId },
    data: { enableScoreNotifications: enabled },
  });

  const embed = new EmbedBuilder()
    .setColor(enabled ? "#00ff00" : "#ff0000")
    .setTitle("🏆 Notifications de score")
    .setDescription(
      enabled
        ? "✅ Les notifications de score sont maintenant **activées**"
        : "❌ Les notifications de score sont maintenant **désactivées**"
    )
    .setTimestamp();

  await safeInteractionUpdate(interaction, {
    embeds: [embed],
    components: [createActionRow([createBackButton()])],
  });
}

export async function showUpdateConfig(interaction: any, guildSettings: any) {
  const updateEnabled = guildSettings?.enableUpdateNotifications !== false;

  const embed = new EmbedBuilder()
    .setTitle("📢 Configuration des Notifications de Mise à Jour")
    .setDescription(
      "Les notifications de mise à jour sont envoyées lors de changements du bot.\n\n" +
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
  } catch {
    return;
  }

  await prisma.guildSettings.update({
    where: { guildId },
    data: { enableUpdateNotifications: enabled },
  });

  const embed = new EmbedBuilder()
    .setColor(enabled ? "#00ff00" : "#ff0000")
    .setTitle("📢 Notifications de mise à jour")
    .setDescription(
      enabled
        ? "✅ Les notifications de mise à jour sont maintenant **activées**"
        : "❌ Les notifications de mise à jour sont maintenant **désactivées**"
    )
    .setTimestamp();

  await safeInteractionUpdate(interaction, {
    embeds: [embed],
    components: [createActionRow([createBackButton()])],
  });
}

export async function showTwitchConfig(interaction: any, guildSettings: any) {
  const twitchEnabled = guildSettings?.enableTwitchNotifications !== false;

  const embed = new EmbedBuilder()
    .setTitle("🔴 Configuration des Notifications Twitch")
    .setDescription(
      "Les notifications Twitch sont envoyées lorsqu'un joueur KC commence à streamer.\n\n" +
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
  } catch {
    return;
  }

  await prisma.guildSettings.update({
    where: { guildId },
    data: { enableTwitchNotifications: enabled },
  });

  const embed = new EmbedBuilder()
    .setColor(enabled ? "#00ff00" : "#ff0000")
    .setTitle("🔴 Notifications Twitch")
    .setDescription(
      enabled
        ? "✅ Les notifications Twitch sont maintenant **activées**"
        : "❌ Les notifications Twitch sont maintenant **désactivées**"
    )
    .setTimestamp();

  await safeInteractionUpdate(interaction, {
    embeds: [embed],
    components: [createActionRow([createBackButton()])],
  });
}

export function handleRoleSelection() { }
export function handleRolesConfirmation() { }
export function handleRolesClear() { }
