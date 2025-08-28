import { Client, GatewayIntentBits, Collection } from "discord.js";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { loadCommands } from "./commands/commandLoader";
import { logger } from "./utils/logger";
import { InteractionHandlers } from "./handlers/interactionHandlers";
import {
  handleDuelAccept,
  handleDuelAmountSubmit,
  handleDuelCancel,
  handleDuelMatchSelect,
  handleDuelReject,
  handleDuelTeamPick,
} from "./commands/duel";
import { EventHandlers } from "./handlers/eventHandlers";
import { StatusHandler } from "./handlers/statusHandler";

config();

export const prisma = new PrismaClient();

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
  ],
}) as Client & { commands: Collection<string, any> };

client.commands = new Collection();

const interactionHandlers = new InteractionHandlers(prisma);
const eventHandlers = new EventHandlers(prisma);
const statusHandler = new StatusHandler(client, prisma);

const handleShutdown = async () => {
  logger.info("Shutting down bot...");
  try {
    await prisma.$disconnect();
    await client.destroy();
  } catch (error) {
    logger.error("Error during shutdown:", error);
  }
  process.exit(0);
};

client.once("ready", async () => {
  logger.info(`Bot logged in as ${client.user?.tag}`);

  try {
    await loadCommands(client);
    logger.info("Commands loaded successfully");
    statusHandler.startStatusUpdates();
  } catch (error) {
    logger.error("Error during bot initialization:", error);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    await interactionHandlers.handleCommand(interaction, command);
  }

  if (interaction.isStringSelectMenu()) {
    const customId = interaction.customId;

    if (customId === "team_select") {
      await interactionHandlers.handleTeamSelect(interaction);
    } else if (customId === "tournament_select") {
      await interactionHandlers.handleTournamentSelect(interaction);
    } else if (customId === "mybets_select") {
      const { handleMyBetsSelect } = await import("./commands/mybets");
      await handleMyBetsSelect(interaction);
    } else if (customId === "duel_select_match") {
      await handleDuelMatchSelect(interaction);
    } else if (customId === "select_match") {
      await interactionHandlers.handleBettingInteraction(
        interaction,
        interactionHandlers.getBettingHandlers().select_match,
        "match selection"
      );
    } else if (customId.startsWith("bet_score_select_")) {
      await interactionHandlers.handleBettingInteraction(
        interaction,
        interactionHandlers.getBettingHandlers().bet_score_select,
        "score select"
      );
    } else if (customId === "parlay_team_match") {
      await interactionHandlers.handleParlayInteraction(
        interaction,
        interactionHandlers.getParlayHandlers().team_match_select,
        "parlay team match select"
      );
    } else if (customId === "parlay_team_pick") {
      await interactionHandlers.handleParlayInteraction(
        interaction,
        interactionHandlers.getParlayHandlers().team_pick,
        "parlay team pick"
      );
    } else if (customId === "parlay_score_match") {
      await interactionHandlers.handleParlayInteraction(
        interaction,
        interactionHandlers.getParlayHandlers().score_match_select,
        "parlay score match select"
      );
    } else if (customId === "parlay_score_pick") {
      await interactionHandlers.handleParlayInteraction(
        interaction,
        interactionHandlers.getParlayHandlers().score_pick,
        "parlay score pick"
      );
    } else if (customId === "title_selection") {
      await interactionHandlers.handleTitleSelection(interaction);
    }
  }

  if (interaction.isButton()) {
    const customId = interaction.customId;

    if (customId.startsWith("bet_team_")) {
      await interactionHandlers.handleBettingInteraction(
        interaction,
        interactionHandlers.getBettingHandlers().bet_team,
        "team selection"
      );
    } else if (customId.startsWith("bet_score_")) {
      await interactionHandlers.handleBettingInteraction(
        interaction,
        interactionHandlers.getBettingHandlers().bet_score,
        "score selection"
      );
    } else if (customId.startsWith("duel_team_")) {
      await handleDuelTeamPick(interaction);
    } else if (customId === "duel_cancel") {
      await handleDuelCancel(interaction);
    } else if (customId.startsWith("duel_accept_")) {
      await handleDuelAccept(interaction);
    } else if (customId.startsWith("duel_reject_")) {
      await handleDuelReject(interaction);
    } else if (customId === "back_to_matches") {
      await interactionHandlers.handleBettingInteraction(
        interaction,
        interactionHandlers.getBettingHandlers().back_to_matches,
        "back to matches"
      );
    } else if (customId === "back_to_match") {
      await interactionHandlers.handleBettingInteraction(
        interaction,
        interactionHandlers.getBettingHandlers().back_to_match,
        "back to match"
      );
    } else if (customId === "parlay_add_team") {
      await interactionHandlers.handleParlayInteraction(
        interaction,
        interactionHandlers.getParlayHandlers().add_team,
        "parlay add team"
      );
    } else if (customId === "parlay_add_score") {
      await interactionHandlers.handleParlayInteraction(
        interaction,
        interactionHandlers.getParlayHandlers().add_score,
        "parlay add score"
      );
    } else if (customId === "parlay_confirm") {
      await interactionHandlers.handleParlayInteraction(
        interaction,
        interactionHandlers.getParlayHandlers().confirm,
        "parlay confirm"
      );
    } else if (customId === "parlay_cancel") {
      await interactionHandlers.handleParlayInteraction(
        interaction,
        interactionHandlers.getParlayHandlers().cancel,
        "parlay cancel"
      );
    } else if (customId.startsWith("tournament_join_")) {
      await interactionHandlers.handleTournamentJoin(interaction);
    }
  }

  if (interaction.isModalSubmit()) {
    const customId = interaction.customId;

    if (customId.startsWith("ticket_modal_")) {
      await interactionHandlers.handleTicketModal(interaction);
    } else if (customId === "tournament_create_modal") {
      const { handleTournamentCreateModal } = await import(
        "./commands/tournament"
      );
      await handleTournamentCreateModal(interaction);
    } else if (customId.startsWith("bet_amount_")) {
      await interactionHandlers.handleBettingInteraction(
        interaction,
        interactionHandlers.getBettingHandlers().bet_amount,
        "bet amount"
      );
    } else if (customId.startsWith("bet_score_amount_")) {
      await interactionHandlers.handleBettingInteraction(
        interaction,
        interactionHandlers.getBettingHandlers().bet_score_amount,
        "score bet amount"
      );
    } else if (customId.startsWith("duel_amount_")) {
      await handleDuelAmountSubmit(interaction);
    }
  }
});

client.on("error", (error) => {
  logger.error("Discord client error:", error);
});

client.on("guildCreate", (guild) => eventHandlers.handleGuildCreate(guild));
client.on("guildDelete", (guild) => eventHandlers.handleGuildDelete(guild));

process.on("SIGINT", handleShutdown);
process.on("SIGTERM", handleShutdown);
process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception:", error);
  process.exit(1);
});
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

client.login(process.env.DISCORD_TOKEN);
