import {
  Client,
  Collection,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import { readdirSync } from "fs";
import { join } from "path";
import { logger } from "../utils/logger";

export interface Command {
  data: SlashCommandBuilder;
  execute: (interaction: any) => Promise<void>;
}

export async function loadCommands(client: Client) {
  const commands: SlashCommandBuilder[] = [];
  const commandsPath = join(__dirname);

  const commandFiles = readdirSync(commandsPath)
    .filter((file) => file.endsWith(".js") || file.endsWith(".ts"))
    .filter((file) => !file.endsWith(".d.ts"))
    .filter(
      (file) => file !== "commandLoader.js" && file !== "commandLoader.ts"
    );

  for (const file of commandFiles) {
    try {
      const filePath = join(commandsPath, file);
      const command = require(filePath);

      if ("data" in command && "execute" in command) {
        (client as any).commands.set(command.data.name, command);
        commands.push(command.data.toJSON());
        logger.info(`Loaded command: ${command.data.name}`);
      } else {
        logger.warn(`Command at ${filePath} is missing required properties`);
      }
    } catch (error) {
      logger.error(`Error loading command from ${file}:`, error);
    }
  }

  if (commands.length > 0) {
    try {
      const rest = new REST({ version: "10" }).setToken(
        process.env.DISCORD_TOKEN!
      );

      logger.info("Started refreshing application (/) commands.");

      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID!), {
        body: commands,
      });

      logger.info("Successfully reloaded application (/) commands.");
    } catch (error) {
      logger.error("Error registering commands:", error);
    }
  }
}
