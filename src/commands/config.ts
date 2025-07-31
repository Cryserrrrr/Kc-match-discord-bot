import {
  SlashCommandBuilder,
  CommandInteraction,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ButtonInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelType,
} from "discord.js";
import { prisma } from "../index";
import { logger } from "../utils/logger";

export const data = new SlashCommandBuilder()
  .setName("config")
  .setDescription("Configuration complète du bot pour les annonces de matchs")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

const TEAMS = {
  "134078": "KC (LEC)",
  "128268": "KCB (LFL)",
  "136080": "KCBS (LFL2)",
  "130922": "KC Valorant",
  "132777": "KCGC Valorant",
  "136165": "KCBS Valorant",
  "129570": "KC Rocket League",
};

export async function execute(interaction: CommandInteraction) {
  try {
    const guildId = interaction.guildId!;

    // Get current guild settings
    let guildSettings = await prisma.guildSettings.findUnique({
      where: { guildId },
    });

    // Create main menu embed
    const mainEmbed = new EmbedBuilder()
      .setTitle("⚙️ Configuration du Bot Karmine Corp")
      .setDescription(
        "Sélectionnez une option à configurer dans le menu ci-dessous."
      )
      .setColor(0x0099ff)
      .setFooter({ text: "Configuration du serveur" });

    // Add current settings to embed
    if (guildSettings) {
      const channelMention = guildSettings.channelId
        ? `<#${guildSettings.channelId}>`
        : "Non configuré";
      const customMessage =
        guildSettings.customMessage || "@everyone Match du jour !";
      const prematchEnabled = (guildSettings as any).enablePreMatchNotifications
        ? "✅ Activé"
        : "❌ Désactivé";
      const filteredTeams = (guildSettings as any).filteredTeams || [];
      const teamsStatus =
        filteredTeams.length === 0
          ? "Toutes les équipes"
          : `${filteredTeams.length} équipe(s) sélectionnée(s)`;

      mainEmbed.addFields(
        { name: "📺 Canal d'annonce", value: channelMention, inline: true },
        {
          name: "💬 Message personnalisé",
          value:
            customMessage.length > 50
              ? customMessage.substring(0, 50) + "..."
              : customMessage,
          inline: true,
        },
        {
          name: "🔔 Notifications avant-match",
          value: prematchEnabled,
          inline: true,
        },
        { name: "🏆 Filtre d'équipes", value: teamsStatus, inline: true }
      );
    } else {
      mainEmbed.addFields({
        name: "⚠️ Configuration requise",
        value:
          "Aucune configuration trouvée. Commencez par configurer le canal d'annonce.",
        inline: false,
      });
    }

    // Create main menu
    const mainMenu = new StringSelectMenuBuilder()
      .setCustomId("main_menu")
      .setPlaceholder("Sélectionnez une option de configuration")
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel("📺 Canal d'annonce")
          .setDescription("Définir le salon pour les annonces")
          .setValue("channel")
          .setEmoji("📺"),
        new StringSelectMenuOptionBuilder()
          .setLabel("💬 Message personnalisé")
          .setDescription("Personnaliser le message d'annonce")
          .setValue("message")
          .setEmoji("💬"),
        new StringSelectMenuOptionBuilder()
          .setLabel("🏆 Filtre d'équipes")
          .setDescription("Choisir quelles équipes annoncer")
          .setValue("teams")
          .setEmoji("🏆"),
        new StringSelectMenuOptionBuilder()
          .setLabel("🔔 Notifications avant-match")
          .setDescription("Activer/désactiver les notifications 30min avant")
          .setValue("prematch")
          .setEmoji("🔔")
      );

    const mainRow =
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(mainMenu);

    // Send initial embed
    await interaction.editReply({
      embeds: [mainEmbed],
      components: [mainRow],
    });

    // Create collector for interactions on the channel
    const collector = interaction.channel!.createMessageComponentCollector({
      time: 300000, // 5 minutes
      filter: (i) => i.user.id === interaction.user.id,
    });

    collector.on("collect", async (i: ButtonInteraction | any) => {
      const customId = i.customId;

      if (customId === "main_menu") {
        const selectedValue = i.values[0];
        await handleMainMenuSelection(i, selectedValue, guildSettings);
      } else if (customId === "channel_select") {
        await handleChannelSelection(i, guildId);
      } else if (customId === "message_select") {
        await handleMessageSelection(i, guildId);
      } else if (customId === "custom_message") {
        await handleCustomMessage(i, guildId);
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
      } else if (customId === "prematch_enable") {
        await handlePrematchToggle(i, guildId, true);
      } else if (customId === "prematch_disable") {
        await handlePrematchToggle(i, guildId, false);
      }
    });

    collector.on("end", async () => {
      // Simply log that the collector expired - no need to edit the message
      // as it can cause issues with component limits
      logger.info(
        "Config menu collector expired for user:",
        interaction.user.id
      );
    });
  } catch (error) {
    logger.error("Error in config command:", error);
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
    case "message":
      await showMessageConfig(interaction, guildSettings);
      break;
    case "teams":
      await showTeamsConfig(interaction, guildSettings);
      break;
    case "prematch":
      await showPrematchConfig(interaction, guildSettings);
      break;
  }
}

async function showChannelConfig(interaction: any, guildSettings: any) {
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

  // Get all text channels in the guild (limit to 20 to stay well under Discord's 25 option limit)
  const guild = interaction.guild;
  const textChannels = guild.channels.cache
    .filter((channel: any) => channel.type === ChannelType.GuildText)
    .map((channel: any) => ({
      id: channel.id,
      name: channel.name,
      isCurrent: channel.id === guildSettings?.channelId,
    }))
    .sort((a: any, b: any) => {
      // Put current channel first, then sort alphabetically
      if (a.isCurrent) return -1;
      if (b.isCurrent) return 1;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 20); // Limit to 20 options to stay well under Discord's 25 option limit

  // Create channel selection menu
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

  // Check if we have any channels to display
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

    const backButton = new ButtonBuilder()
      .setCustomId("back_to_main")
      .setLabel("← Retour au menu principal")
      .setStyle(ButtonStyle.Secondary);

    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      backButton
    );

    await interaction.update({
      embeds: [noChannelsEmbed],
      components: [buttonRow],
    });
    return;
  }

  const channelRow =
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(channelMenu);

  const backButton = new ButtonBuilder()
    .setCustomId("back_to_main")
    .setLabel("← Retour au menu principal")
    .setStyle(ButtonStyle.Secondary);

  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    backButton
  );

  await interaction.update({
    embeds: [embed],
    components: [channelRow, buttonRow],
  });
}

async function showMessageConfig(interaction: any, guildSettings: any) {
  const embed = new EmbedBuilder()
    .setTitle("💬 Configuration du Message Personnalisé")
    .setDescription(
      "Sélectionnez un message prédéfini ou utilisez le bouton pour personnaliser.\n\n" +
        "**Message actuel :** " +
        (guildSettings?.customMessage || "@everyone Match du jour !")
    )
    .setColor(0x0099ff);

  // Create message selection menu with predefined options
  const messageMenu = new StringSelectMenuBuilder()
    .setCustomId("message_select")
    .setPlaceholder("Sélectionnez un message prédéfini")
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel("@everyone Match du jour !")
        .setValue("@everyone Match du jour !")
        .setDescription("Message par défaut")
        .setDefault(
          guildSettings?.customMessage === "@everyone Match du jour !"
        ),
      new StringSelectMenuOptionBuilder()
        .setLabel("@here Match Karmine Corp !")
        .setValue("@here Match Karmine Corp !")
        .setDescription("Notification avec @here")
        .setDefault(
          guildSettings?.customMessage === "@here Match Karmine Corp !"
        ),
      new StringSelectMenuOptionBuilder()
        .setLabel("🏆 Match KC en cours !")
        .setValue("🏆 Match KC en cours !")
        .setDescription("Message avec emoji")
        .setDefault(guildSettings?.customMessage === "🏆 Match KC en cours !"),
      new StringSelectMenuOptionBuilder()
        .setLabel("⚡ Match live Karmine Corp !")
        .setValue("⚡ Match live Karmine Corp !")
        .setDescription("Message dynamique")
        .setDefault(
          guildSettings?.customMessage === "⚡ Match live Karmine Corp !"
        )
    );

  const messageRow =
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(messageMenu);

  const customButton = new ButtonBuilder()
    .setCustomId("custom_message")
    .setLabel("✏️ Message personnalisé")
    .setStyle(ButtonStyle.Secondary);

  const backButton = new ButtonBuilder()
    .setCustomId("back_to_main")
    .setLabel("← Retour au menu principal")
    .setStyle(ButtonStyle.Secondary);

  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    customButton,
    backButton
  );

  await interaction.update({
    embeds: [embed],
    components: [messageRow, buttonRow],
  });
}

async function showTeamsConfig(interaction: any, guildSettings: any) {
  const currentFilteredTeams = (guildSettings as any)?.filteredTeams || [];

  // Initialize selectedTeams with all teams if no teams are currently selected
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

  // Add team status to embed
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

  // Create buttons for each team
  const teamButtons: ButtonBuilder[] = [];
  Object.entries(TEAMS).forEach(([id, name]) => {
    const isSelected = selectedTeams.includes(id);
    const button = new ButtonBuilder()
      .setCustomId(`team_${id}`)
      .setLabel(name)
      .setStyle(isSelected ? ButtonStyle.Success : ButtonStyle.Secondary);
    teamButtons.push(button);
  });

  // Create action rows (max 5 buttons per row)
  const actionRows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < teamButtons.length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    row.addComponents(teamButtons.slice(i, i + 5));
    actionRows.push(row);
  }

  // Add control buttons
  const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
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
    new ButtonBuilder()
      .setCustomId("back_to_main")
      .setLabel("← Retour")
      .setStyle(ButtonStyle.Secondary)
  );

  actionRows.push(controlRow);

  await interaction.update({
    embeds: [embed],
    components: actionRows,
  });
}

async function showPrematchConfig(interaction: any, guildSettings: any) {
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

  const backButton = new ButtonBuilder()
    .setCustomId("back_to_main")
    .setLabel("← Retour au menu principal")
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    enableButton,
    disableButton,
    backButton
  );

  await interaction.update({
    embeds: [embed],
    components: [row],
  });
}

async function showMainMenu(interaction: any, guildId: string) {
  // Refresh guild settings
  const guildSettings = await prisma.guildSettings.findUnique({
    where: { guildId },
  });

  const mainEmbed = new EmbedBuilder()
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
    const customMessage =
      guildSettings.customMessage || "@everyone Match du jour !";
    const prematchEnabled = (guildSettings as any).enablePreMatchNotifications
      ? "✅ Activé"
      : "❌ Désactivé";
    const filteredTeams = (guildSettings as any).filteredTeams || [];
    const teamsStatus =
      filteredTeams.length === 0
        ? "Toutes les équipes"
        : `${filteredTeams.length} équipe(s) sélectionnée(s)`;

    mainEmbed.addFields(
      { name: "📺 Canal d'annonce", value: channelMention, inline: true },
      {
        name: "💬 Message personnalisé",
        value:
          customMessage.length > 50
            ? customMessage.substring(0, 50) + "..."
            : customMessage,
        inline: true,
      },
      {
        name: "🔔 Notifications avant-match",
        value: prematchEnabled,
        inline: true,
      },
      { name: "🏆 Filtre d'équipes", value: teamsStatus, inline: true }
    );
  } else {
    mainEmbed.addFields({
      name: "⚠️ Configuration requise",
      value:
        "Aucune configuration trouvée. Commencez par configurer le canal d'annonce.",
      inline: false,
    });
  }

  const mainMenu = new StringSelectMenuBuilder()
    .setCustomId("main_menu")
    .setPlaceholder("Sélectionnez une option de configuration")
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel("📺 Canal d'annonce")
        .setDescription("Définir le salon pour les annonces")
        .setValue("channel")
        .setEmoji("📺"),
      new StringSelectMenuOptionBuilder()
        .setLabel("💬 Message personnalisé")
        .setDescription("Personnaliser le message d'annonce")
        .setValue("message")
        .setEmoji("💬"),
      new StringSelectMenuOptionBuilder()
        .setLabel("🏆 Filtre d'équipes")
        .setDescription("Choisir quelles équipes annoncer")
        .setValue("teams")
        .setEmoji("🏆"),
      new StringSelectMenuOptionBuilder()
        .setLabel("🔔 Notifications avant-match")
        .setDescription("Activer/désactiver les notifications 30min avant")
        .setValue("prematch")
        .setEmoji("🔔")
    );

  const mainRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    mainMenu
  );

  await interaction.update({
    embeds: [mainEmbed],
    components: [mainRow],
  });
}

// Team selection handlers
let selectedTeams: string[] = [];

async function handleTeamSelection(interaction: any, guildId: string) {
  const teamId = interaction.customId.replace("team_", "");

  if (selectedTeams.includes(teamId)) {
    selectedTeams = selectedTeams.filter((id) => id !== teamId);
  } else {
    selectedTeams.push(teamId);
  }

  await updateTeamsDisplay(interaction, guildId);
}

async function handleTeamsConfirmation(interaction: any, guildId: string) {
  await prisma.guildSettings.update({
    where: { guildId },
    data: {
      filteredTeams: selectedTeams,
    } as any,
  });

  let responseMessage: string;
  if (selectedTeams.length === 0) {
    responseMessage =
      "✅ **Filtre mis à jour :** Toutes les équipes de Karmine Corp seront annoncées.";
  } else {
    const selectedTeamNames = selectedTeams.map(
      (id) => TEAMS[id as keyof typeof TEAMS] || id
    );
    responseMessage = `✅ **Filtre mis à jour :** Seules les équipes suivantes seront annoncées :\n${selectedTeamNames
      .map((name) => `• ${name}`)
      .join("\n")}`;
  }

  await interaction.update({
    content: responseMessage,
    embeds: [],
    components: [],
  });

  logger.info(
    `Guild ${guildId} updated team filter: ${
      selectedTeams.join(", ") || "all teams"
    }`
  );
}

async function handleTeamsClear(interaction: any, guildId: string) {
  selectedTeams = [];
  await updateTeamsDisplay(interaction, guildId);
}

async function handleTeamsSelectAll(interaction: any, guildId: string) {
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

  const teamButtons: ButtonBuilder[] = [];
  Object.entries(TEAMS).forEach(([id, name]) => {
    const isSelected = selectedTeams.includes(id);
    const button = new ButtonBuilder()
      .setCustomId(`team_${id}`)
      .setLabel(name)
      .setStyle(isSelected ? ButtonStyle.Success : ButtonStyle.Secondary);
    teamButtons.push(button);
  });

  const actionRows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < teamButtons.length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    row.addComponents(teamButtons.slice(i, i + 5));
    actionRows.push(row);
  }

  const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
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
    new ButtonBuilder()
      .setCustomId("back_to_main")
      .setLabel("← Retour")
      .setStyle(ButtonStyle.Secondary)
  );

  actionRows.push(controlRow);

  await interaction.update({
    embeds: [embed],
    components: actionRows,
  });
}

async function handleChannelSelection(interaction: any, guildId: string) {
  const selectedChannelId = interaction.values[0];
  const selectedChannel =
    interaction.guild.channels.cache.get(selectedChannelId);

  // Upsert guild settings
  await prisma.guildSettings.upsert({
    where: { guildId },
    update: {
      channelId: selectedChannelId,
    },
    create: {
      guildId,
      channelId: selectedChannelId,
      customMessage: "@everyone Match du jour !",
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

  const backButton = new ButtonBuilder()
    .setCustomId("back_to_main")
    .setLabel("← Retour au menu principal")
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backButton);

  await interaction.update({
    embeds: [embed],
    components: [row],
  });

  logger.info(
    `Guild ${guildId} set announcement channel to ${selectedChannelId}`
  );
}

async function handleMessageSelection(interaction: any, guildId: string) {
  const selectedMessage = interaction.values[0];

  await prisma.guildSettings.update({
    where: { guildId },
    data: { customMessage: selectedMessage },
  });

  const embed = new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle("✅ Message personnalisé configuré")
    .setDescription(`Le message d'annonce a été mis à jour`)
    .addFields({
      name: "Nouveau message",
      value: selectedMessage,
      inline: false,
    })
    .setTimestamp()
    .setFooter({
      text: `Configuré par ${interaction.user.tag}`,
      iconURL: interaction.user.displayAvatarURL(),
    });

  const backButton = new ButtonBuilder()
    .setCustomId("back_to_main")
    .setLabel("← Retour au menu principal")
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backButton);

  await interaction.update({
    embeds: [embed],
    components: [row],
  });

  logger.info(`Guild ${guildId} updated custom message: ${selectedMessage}`);
}

async function handleCustomMessage(interaction: any, guildId: string) {
  const embed = new EmbedBuilder()
    .setTitle("✏️ Message Personnalisé")
    .setDescription(
      "Pour configurer un message personnalisé, utilisez la commande `/setphrase` suivie de votre message.\n\n" +
        "**Exemples :**\n" +
        "• `/setphrase @everyone Match KC en cours !`\n" +
        "• `/setphrase 🏆 Match live Karmine Corp !`\n" +
        "• `/setphrase @here Match du jour !`"
    )
    .setColor(0x0099ff);

  const backButton = new ButtonBuilder()
    .setCustomId("back_to_main")
    .setLabel("← Retour au menu principal")
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backButton);

  await interaction.update({
    embeds: [embed],
    components: [row],
  });
}

async function handlePrematchToggle(
  interaction: any,
  guildId: string,
  enabled: boolean
) {
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

  const backButton = new ButtonBuilder()
    .setCustomId("back_to_main")
    .setLabel("← Retour au menu principal")
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backButton);

  await interaction.update({
    embeds: [embed],
    components: [row],
  });

  logger.info(
    `Guild ${guildId} ${
      enabled ? "enabled" : "disabled"
    } pre-match notifications`
  );
}
