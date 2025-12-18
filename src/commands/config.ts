import {
  SlashCommandBuilder,
  CommandInteraction,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  EmbedBuilder,
} from "discord.js";
import { prisma } from "../index";
import { logger } from "../utils/logger";
import {
  showChannelConfig,
  handleChannelSelection,
  showRolesConfig,
  showMatchRoleConfig,
  handleMatchRoleSelection,
  showTwitchRoleConfig,
  handleTwitchRoleSelection,
  showTeamRolesConfig,
  showTeamRoleSelection,
  handleTeamRoleAssignment,
  handleClearTeamRoles,
  showTeamsConfig,
  handleTeamSelection,
  handleTeamsConfirmation,
  handleTeamsClear,
  handleTeamsSelectAll,
  showPrematchConfig,
  handlePrematchToggle,
  showScoreConfig,
  handleScoreToggle,
  showUpdateConfig,
  handleUpdateToggle,
  showTwitchConfig,
  handleTwitchToggle,
} from "../handlers/configHandlers";
import { StatsManager } from "../utils/statsManager";

const activeConfigSessions = new Map<string, any>();

export const data = new SlashCommandBuilder()
  .setName("config")
  .setDescription("Configuration complète du bot pour les annonces de matchs")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

function createMainEmbed(guildSettings: any): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle("⚙️ Configuration du Bot Karmine Corp")
    .setDescription(
      "Sélectionnez une option à configurer dans le menu ci-dessous."
    )
    .setColor(0x0099ff)
    .setFooter({ text: "Configuration du serveur" });

  if (guildSettings) {
    const channelMention = guildSettings.channelId
      ? `<#${guildSettings.channelId}>`
      : "Non configuré";

    const matchRole = guildSettings.matchAnnouncementRole;
    const twitchRole = guildSettings.twitchLiveRole;
    const teamRoles = (guildSettings.teamRoles as Record<string, string>) || {};
    const teamRolesCount = Object.keys(teamRoles).filter(
      (k) => teamRoles[k]
    ).length;

    let rolesStatus = "";
    if (matchRole || twitchRole || teamRolesCount > 0) {
      const parts = [];
      if (matchRole) parts.push("Match");
      if (twitchRole) parts.push("Twitch");
      if (teamRolesCount > 0) parts.push(`${teamRolesCount} équipe(s)`);
      rolesStatus = parts.join(", ");
    } else {
      rolesStatus = "Non configuré";
    }

    const prematchEnabled = guildSettings.enablePreMatchNotifications
      ? "✅ Activé"
      : "❌ Désactivé";
    const scoreEnabled =
      guildSettings.enableScoreNotifications === true
        ? "✅ Activé"
        : "❌ Désactivé";
    const updateEnabled =
      guildSettings.enableUpdateNotifications !== false
        ? "✅ Activé"
        : "❌ Désactivé";
    const twitchEnabled =
      guildSettings.enableTwitchNotifications !== false
        ? "✅ Activé"
        : "❌ Désactivé";
    const filteredTeams = guildSettings.filteredTeams || [];
    const teamsStatus =
      filteredTeams.length === 0
        ? "Toutes les équipes"
        : `${filteredTeams.length} équipe(s) sélectionnée(s)`;

    embed.addFields(
      { name: "📺 Canal d'annonce", value: channelMention, inline: true },
      { name: "👥 Rôles à mentionner", value: rolesStatus, inline: true },
      { name: "🏆 Filtre d'équipes", value: teamsStatus, inline: true },
      {
        name: "🔔 Notifications avant-match",
        value: prematchEnabled,
        inline: true,
      },
      { name: "🏆 Notifications de score", value: scoreEnabled, inline: true },
      {
        name: "📢 Notifications de mise à jour",
        value: updateEnabled,
        inline: true,
      },
      {
        name: "🔴 Notifications Twitch",
        value: twitchEnabled,
        inline: true,
      }
    );
  } else {
    embed.addFields({
      name: "⚠️ Configuration requise",
      value:
        "Aucune configuration trouvée. Commencez par configurer le canal d'annonce.",
      inline: false,
    });
  }

  return embed;
}

function createMainMenu(): StringSelectMenuBuilder {
  return new StringSelectMenuBuilder()
    .setCustomId("main_menu")
    .setPlaceholder("Sélectionnez une option de configuration")
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel("Canal d'annonce")
        .setDescription("Définir le salon pour les annonces")
        .setValue("channel")
        .setEmoji("📺"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Rôles à mentionner")
        .setDescription("Configurer les rôles par type de notification")
        .setValue("roles")
        .setEmoji("👥"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Filtre d'équipes")
        .setDescription("Choisir quelles équipes annoncer")
        .setValue("teams")
        .setEmoji("🏆"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Notifications avant-match")
        .setDescription(
          "Activer/désactiver les notifications au lancement du match"
        )
        .setValue("prematch")
        .setEmoji("🔔"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Notifications de score")
        .setDescription("Activer/désactiver les notifications de fin de match")
        .setValue("score")
        .setEmoji("🏆"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Notifications de mise à jour")
        .setDescription(
          "Activer/désactiver les notifications de mise à jour du bot"
        )
        .setValue("update")
        .setEmoji("📢"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Notifications Twitch")
        .setDescription(
          "Activer/désactiver les notifications de stream Twitch"
        )
        .setValue("twitch")
        .setEmoji("🔴")
    );
}

export async function execute(interaction: CommandInteraction) {
  const startTime = Date.now();

  try {
    const userId = interaction.user.id;
    const guildId = interaction.guildId;

    if (!guildId) {
      await interaction.reply({
        content:
          "❌ Cette commande ne peut être utilisée que dans un serveur Discord.",
        flags: 64,
      });
      return;
    }

    const guildSettings = await prisma.guildSettings.findUnique({
      where: { guildId },
    });

    await StatsManager.ensureGuildExists(
      guildId,
      interaction.guild?.name,
      interaction.guild?.memberCount
    );
    const mainEmbed = createMainEmbed(guildSettings);
    const mainMenu = createMainMenu();
    const mainRow =
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(mainMenu);

    await interaction.editReply({
      embeds: [mainEmbed],
      components: [mainRow],
    });

    const collector = interaction.channel!.createMessageComponentCollector({
      time: 120000,
      filter: (i) => i.user.id === interaction.user.id,
    });

    activeConfigSessions.set(userId, { collector, guildId });

    collector.on("collect", async (i: ButtonInteraction | any) => {
      try {
        const customId = i.customId;
        const currentGuildSettings = await prisma.guildSettings.findUnique({
          where: { guildId },
        });

        if (customId === "main_menu") {
          const selectedValue = i.values[0];
          await handleMainMenuSelection(i, selectedValue, currentGuildSettings);
        } else if (customId === "channel_select") {
          await handleChannelSelection(i, guildId);
        } else if (customId === "back_to_main") {
          await showMainMenu(i, guildId);
        } else if (customId === "roles_submenu") {
          const selectedValue = i.values[0];
          await handleRolesSubmenuSelection(i, selectedValue, currentGuildSettings);
        } else if (customId === "back_to_roles_menu") {
          await showRolesConfig(i, currentGuildSettings);
        } else if (customId === "match_role_select") {
          await handleMatchRoleSelection(i, guildId);
        } else if (customId === "twitch_role_select") {
          await handleTwitchRoleSelection(i, guildId);
        } else if (customId === "team_role_select_team") {
          const teamId = i.values[0].replace("team_", "");
          await showTeamRoleSelection(i, teamId, currentGuildSettings);
        } else if (customId === "team_role_assign") {
          await handleTeamRoleAssignment(i, guildId);
        } else if (customId === "back_to_team_roles") {
          const updatedSettings = await prisma.guildSettings.findUnique({
            where: { guildId },
          });
          await showTeamRolesConfig(i, updatedSettings);
        } else if (customId === "clear_team_roles") {
          await handleClearTeamRoles(i, guildId);
        } else if (customId.startsWith("team_")) {
          await handleTeamSelection(i, guildId);
        } else if (customId === "confirm_teams") {
          await handleTeamsConfirmation(i, guildId);
        } else if (customId === "clear_teams") {
          await handleTeamsClear(i, guildId);
        } else if (customId === "select_all_teams") {
          await handleTeamsSelectAll(i, guildId);
        } else if (customId === "prematch_enable") {
          await handlePrematchToggle(i, guildId, true);
        } else if (customId === "prematch_disable") {
          await handlePrematchToggle(i, guildId, false);
        } else if (customId === "score_enable") {
          await handleScoreToggle(i, guildId, true);
        } else if (customId === "score_disable") {
          await handleScoreToggle(i, guildId, false);
        } else if (customId === "update_enable") {
          await handleUpdateToggle(i, guildId, true);
        } else if (customId === "update_disable") {
          await handleUpdateToggle(i, guildId, false);
        } else if (customId === "twitch_enable") {
          await handleTwitchToggle(i, guildId, true);
        } else if (customId === "twitch_disable") {
          await handleTwitchToggle(i, guildId, false);
        }
      } catch (error: any) {
        if (
          error.code === 10062 ||
          error.message?.includes("Unknown interaction")
        ) {
          return;
        }
        logger.error("Error handling interaction in collector:", error);
      }
    });

    collector.on("end", async () => {
      activeConfigSessions.delete(userId);
      try {
        await interaction.editReply({
          embeds: [
            {
              title: "⏰ Session expirée",
              description:
                "La session de configuration a expiré. \nUtilisez `/config` pour recommencer.",
              color: 0xff9900,
              timestamp: new Date().toISOString(),
            },
          ],
          components: [],
        });
      } catch { }
    });

    collector.on("error", async () => {
      activeConfigSessions.delete(userId);
    });

    collector.on("dispose", async () => {
      activeConfigSessions.delete(userId);
    });
  } catch (error) {
    logger.error("Error in config command:", error);
    activeConfigSessions.delete(interaction.user.id);
    await interaction.editReply({
      content:
        "Une erreur s'est produite lors de l'ouverture de la configuration.",
    });

    await StatsManager.recordCommandExecution({
      guildId: interaction.guildId!,
      commandName: "config",
      userId: interaction.user.id,
      username: interaction.user.username,
      startTime,
      success: false,
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
  }

  try {
    await StatsManager.recordCommandExecution({
      guildId: interaction.guildId!,
      commandName: "config",
      userId: interaction.user.id,
      username: interaction.user.username,
      startTime,
      success: true,
    });
  } catch { }
}

async function handleMainMenuSelection(
  interaction: any,
  selectedValue: string,
  guildSettings: any
) {
  switch (selectedValue) {
    case "channel":
      await showChannelConfig(interaction, guildSettings);
      break;
    case "roles":
      await showRolesConfig(interaction, guildSettings);
      break;
    case "teams":
      await showTeamsConfig(interaction, guildSettings);
      break;
    case "prematch":
      await showPrematchConfig(interaction, guildSettings);
      break;
    case "score":
      await showScoreConfig(interaction, guildSettings);
      break;
    case "update":
      await showUpdateConfig(interaction, guildSettings);
      break;
    case "twitch":
      await showTwitchConfig(interaction, guildSettings);
      break;
  }
}

async function handleRolesSubmenuSelection(
  interaction: any,
  selectedValue: string,
  guildSettings: any
) {
  switch (selectedValue) {
    case "match_role":
      await showMatchRoleConfig(interaction, guildSettings);
      break;
    case "twitch_role":
      await showTwitchRoleConfig(interaction, guildSettings);
      break;
    case "team_roles":
      await showTeamRolesConfig(interaction, guildSettings);
      break;
  }
}

async function showMainMenu(interaction: any, guildId: string) {
  const guildSettings = await prisma.guildSettings.findUnique({
    where: { guildId },
  });
  const mainEmbed = createMainEmbed(guildSettings);
  const mainMenu = createMainMenu();
  const mainRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    mainMenu
  );

  await interaction.update({
    embeds: [mainEmbed],
    components: [mainRow],
  });
}

export function getActiveConfigSessionsCount(): number {
  return activeConfigSessions.size;
}

export function getActiveConfigSessions(): Map<string, any> {
  return new Map(activeConfigSessions);
}

setInterval(() => {
  for (const [userId, session] of activeConfigSessions.entries()) {
    if (session.collector.ended) {
      activeConfigSessions.delete(userId);
    }
  }
}, 5 * 60 * 1000);
