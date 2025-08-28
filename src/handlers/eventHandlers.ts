import { Guild, AuditLogEvent } from "discord.js";
import { PrismaClient } from "@prisma/client";
import { logger } from "../utils/logger";

export class EventHandlers {
  constructor(private prisma: PrismaClient) {}

  private createWelcomeEmbed(guildName: string, isDM: boolean = false) {
    const COMMANDS_LIST =
      "• `/nextmatch` - Voir le prochain match\n• `/standing` - Voir les classements\n• `/daily` - Récupérer votre récompense quotidienne\n• `/bet` - Parier sur un match\n• `/mybets` - Voir vos paris actifs\n• `/ticket` - Créer un ticket de support\n• `/mytickets` - Voir vos tickets\n• `/config` - Configurer le bot";
    const CONFIG_DESCRIPTION =
      "Utilisez `/config` pour définir :\n• Le canal d'annonce des matchs\n• Les rôles à mentionner\n• Les équipes à suivre\n• Les notifications avant-match, de score et de mise à jour";

    return {
      color: 0x00ff00,
      title: isDM
        ? "🎉 Merci d'avoir ajouté le Bot Karmine Corp !"
        : "🎉 Bot Karmine Corp ajouté avec succès !",
      description: `Le bot a été ajouté ${
        isDM ? "avec succès au serveur" : "au serveur"
      } **${guildName}** !`,
      fields: [
        {
          name: "⚙️ Configuration requise",
          value: isDM
            ? "Pour que les messages automatiques fonctionnent correctement, vous devez configurer le bot avec la commande `/config`."
            : "Pour que les messages automatiques fonctionnent correctement, un administrateur doit configurer le bot avec la commande `/config`.",
          inline: false,
        },
        {
          name: "📋 Commandes disponibles",
          value: COMMANDS_LIST,
          inline: false,
        },
        {
          name: "🔧 Configuration",
          value: CONFIG_DESCRIPTION,
          inline: false,
        },
      ],
      footer: { text: "Bot Karmine Corp - Configuration automatique" },
      timestamp: new Date().toISOString(),
    };
  }

  async handleGuildCreate(guild: Guild) {
    try {
      logger.info(`Bot added to guild: ${guild.name} (${guild.id})`);

      await this.prisma.guildSettings.upsert({
        where: { guildId: guild.id },
        update: {
          name: guild.name,
          memberCount: guild.memberCount,
          updatedAt: new Date(),
        },
        create: {
          guildId: guild.id,
          name: guild.name,
          memberCount: guild.memberCount,
          channelId: "",
        },
      });

      let welcomeMessageSent = false;
      const botMember = guild.members.me;
      const hasAuditLogPermission = botMember?.permissions.has("ViewAuditLog");

      if (hasAuditLogPermission) {
        try {
          const auditLogs = await guild.fetchAuditLogs({
            type: AuditLogEvent.BotAdd,
            limit: 1,
          });

          const botAddLog = auditLogs.entries.first();
          if (botAddLog && botAddLog.executor) {
            try {
              await botAddLog.executor.send({
                embeds: [this.createWelcomeEmbed(guild.name, true)],
              });
              logger.info(
                `Welcome message sent to ${botAddLog.executor.tag} for guild ${guild.name}`
              );
              welcomeMessageSent = true;
            } catch (dmError) {
              logger.warn(
                `Could not send DM to ${botAddLog.executor.tag}:`,
                dmError
              );
            }
          }
        } catch (auditError) {
          logger.warn(
            `Could not access audit logs for guild ${guild.name}:`,
            auditError
          );
        }
      }

      if (!welcomeMessageSent) {
        try {
          const textChannels = guild.channels.cache.filter(
            (channel) =>
              channel.type === 0 &&
              channel.permissionsFor(guild.members.me!)?.has("SendMessages")
          );

          if (textChannels.size > 0) {
            const firstChannel = textChannels.first();
            if (firstChannel && firstChannel.isTextBased()) {
              await firstChannel.send({
                embeds: [this.createWelcomeEmbed(guild.name, false)],
              });
              logger.info(
                `Welcome message sent to channel #${firstChannel.name} in guild ${guild.name}`
              );
            }
          }
        } catch (channelError) {
          logger.warn(
            `Could not send welcome message to any channel in guild ${guild.name}:`,
            channelError
          );
        }
      }

      logger.info(
        `Guild settings created for guild: ${guild.name} (${guild.id})`
      );
    } catch (error) {
      logger.error(`Error handling guild create for guild ${guild.id}:`, error);
    }
  }

  async handleGuildDelete(guild: Guild) {
    try {
      logger.info(`Bot removed from guild: ${guild.name} (${guild.id})`);

      await this.prisma.guildSettings.deleteMany({
        where: { guildId: guild.id },
      });

      logger.info(
        `Guild settings deleted for guild: ${guild.name} (${guild.id})`
      );
    } catch (error) {
      logger.error(
        `Error deleting guild settings for guild ${guild.id}:`,
        error
      );
    }
  }
}
