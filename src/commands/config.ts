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
  handleRoleSelection,
  handleRolesConfirmation,
  handleRolesClear,
  showTeamsConfig,
  handleTeamSelection,
  handleTeamsConfirmation,
  handleTeamsClear,
  handleTeamsSelectAll,
  showPrematchConfig,
  handlePrematchToggle,
  showScoreConfig,
  handleScoreToggle,
} from "../handlers/configHandlers";

// Variables globales
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
    const pingRoles = (guildSettings as any).pingRoles || [];
    const pingRolesStatus =
      pingRoles.length === 0
        ? "Aucun rôle"
        : `${pingRoles.length} rôle(s) sélectionné(s)`;
    const prematchEnabled = (guildSettings as any).enablePreMatchNotifications
      ? "✅ Activé"
      : "❌ Désactivé";
    const scoreEnabled =
      (guildSettings as any).enableScoreNotifications === true
        ? "✅ Activé"
        : "❌ Désactivé";
    const filteredTeams = (guildSettings as any).filteredTeams || [];
    const teamsStatus =
      filteredTeams.length === 0
        ? "Toutes les équipes"
        : `${filteredTeams.length} équipe(s) sélectionnée(s)`;

    embed.addFields(
      { name: "📺 Canal d'annonce", value: channelMention, inline: true },
      { name: "👥 Rôles à mentionner", value: pingRolesStatus, inline: true },
      {
        name: "🔔 Notifications avant-match",
        value: prematchEnabled,
        inline: true,
      },
      { name: "🏆 Notifications de score", value: scoreEnabled, inline: true },
      { name: "🏆 Filtre d'équipes", value: teamsStatus, inline: true }
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
        .setLabel("📺 Canal d'annonce")
        .setDescription("Définir le salon pour les annonces")
        .setValue("channel")
        .setEmoji("📺"),
      new StringSelectMenuOptionBuilder()
        .setLabel("👥 Rôles à mentionner")
        .setDescription("Sélectionner les rôles à mentionner")
        .setValue("roles")
        .setEmoji("👥"),
      new StringSelectMenuOptionBuilder()
        .setLabel("🏆 Filtre d'équipes")
        .setDescription("Choisir quelles équipes annoncer")
        .setValue("teams")
        .setEmoji("🏆"),
      new StringSelectMenuOptionBuilder()
        .setLabel("🔔 Notifications avant-match")
        .setDescription("Activer/désactiver les notifications 30min avant")
        .setValue("prematch")
        .setEmoji("🔔"),
      new StringSelectMenuOptionBuilder()
        .setLabel("🏆 Notifications de score")
        .setDescription("Activer/désactiver les notifications de fin de match")
        .setValue("score")
        .setEmoji("🏆")
    );
}

// Fonction principale
export async function execute(interaction: CommandInteraction) {
  try {
    const userId = interaction.user.id;
    const guildId = interaction.guildId!;

    const guildSettings = await prisma.guildSettings.findUnique({
      where: { guildId },
    });
    const mainEmbed = createMainEmbed(guildSettings);
    const mainMenu = createMainMenu();
    const mainRow =
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(mainMenu);

    await interaction.editReply({
      embeds: [mainEmbed],
      components: [mainRow],
    });

    const collector = interaction.channel!.createMessageComponentCollector({
      time: 60000,
      filter: (i) => i.user.id === interaction.user.id,
    });

    activeConfigSessions.set(userId, { collector, guildId });

    collector.on("collect", async (i: ButtonInteraction | any) => {
      try {
        const customId = i.customId;

        if (customId === "main_menu") {
          const selectedValue = i.values[0];
          await handleMainMenuSelection(i, selectedValue, guildSettings);
        } else if (customId === "channel_select") {
          await handleChannelSelection(i, guildId);
        } else if (customId === "back_to_main") {
          await showMainMenu(i, guildId);
        } else if (customId.startsWith("team_")) {
          await handleTeamSelection(i, guildId);
        } else if (customId === "confirm_teams") {
          await handleTeamsConfirmation(i, guildId);
        } else if (customId === "clear_teams") {
          await handleTeamsClear(i, guildId);
        } else if (customId === "select_all_teams") {
          await handleTeamsSelectAll(i, guildId);
        } else if (customId.startsWith("role_")) {
          await handleRoleSelection(i, guildId);
        } else if (customId === "confirm_roles") {
          await handleRolesConfirmation(i, guildId);
        } else if (customId === "clear_roles") {
          await handleRolesClear(i, guildId);
        } else if (customId === "prematch_enable") {
          await handlePrematchToggle(i, guildId, true);
        } else if (customId === "prematch_disable") {
          await handlePrematchToggle(i, guildId, false);
        } else if (customId === "score_enable") {
          await handleScoreToggle(i, guildId, true);
        } else if (customId === "score_disable") {
          await handleScoreToggle(i, guildId, false);
        }
      } catch (error: any) {
        if (
          error.code === 10062 ||
          error.message?.includes("Unknown interaction")
        ) {
          logger.warn("Interaction expired in collector, skipping");
          return;
        }

        logger.error("Error handling interaction in collector:", error);
      }
    });

    collector.on("end", async () => {
      logger.info(
        "Config menu collector expired for user:",
        interaction.user.id
      );
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
      } catch (error) {
        logger.warn("Could not update expired config message:", error);
      }
    });

    collector.on("error", async (error) => {
      logger.error(
        "Error in config collector for user:",
        interaction.user.id,
        error
      );
      activeConfigSessions.delete(userId);
    });

    collector.on("dispose", async () => {
      logger.info(
        "Config menu collector disposed for user:",
        interaction.user.id
      );
      activeConfigSessions.delete(userId);
    });
  } catch (error) {
    logger.error("Error in config command:", error);
    activeConfigSessions.delete(interaction.user.id);
    await interaction.editReply({
      content:
        "Une erreur s'est produite lors de l'ouverture de la configuration.",
    });
  }
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
      logger.info(`Cleaned up expired config session for user: ${userId}`);
    }
  }
}, 5 * 60 * 1000);
