const { REST, Routes } = require("discord.js");
const { readdirSync } = require("fs");
const { join } = require("path");
const { logger } = require("../dist/utils/logger");

const NODE_ENV = process.env.NODE_ENV || "development";
const isDevelopment = NODE_ENV === "development";

logger.info("🔍 NODE_ENV:", NODE_ENV);
logger.info("🔍 isDevelopment:", isDevelopment);

async function deployCommands() {
  try {
    const commands = [];
    const commandsPath = join(__dirname, "../dist/commands");

    try {
      const commandFiles = readdirSync(commandsPath)
        .filter((file) => file.endsWith(".js"))
        .filter((file) => file !== "commandLoader.js");

      for (const file of commandFiles) {
        try {
          const filePath = join(commandsPath, file);
          const command = require(filePath);

          if ("data" in command && "execute" in command) {
            commands.push(command.data.toJSON());
            logger.info(`Loaded command: ${command.data.name}`);
          } else {
            logger.warn(
              `Command at ${filePath} is missing required properties`
            );
          }
        } catch (error) {
          logger.error(`Error loading command from ${file}:`, error);
        }
      }
    } catch (error) {
      logger.error("Error reading commands directory:", error);
      logger.info(
        "Please run 'npm run build' first to compile TypeScript files"
      );
      return;
    }

    if (commands.length === 0) {
      logger.warn("No commands found to deploy");
      return;
    }

    const rest = new REST({ version: "10" }).setToken(
      process.env.DISCORD_TOKEN
    );

    if (isDevelopment) {
      logger.info("🛠️  Development mode: Deploying commands to guild...");

      logger.info("🗑️  Deleting existing commands...");
      await rest.put(
        Routes.applicationGuildCommands(
          process.env.CLIENT_ID,
          process.env.GUILD_ID
        ),
        {
          body: [],
        }
      );

      logger.info("⏳ Waiting for Discord to process deletion...");
      await new Promise((resolve) => setTimeout(resolve, 2000));

      logger.info("📤 Deploying new commands...");
      logger.info(
        "Commands to deploy:",
        commands.map((cmd) => cmd.name)
      );

      await rest.put(
        Routes.applicationGuildCommands(
          process.env.CLIENT_ID,
          process.env.GUILD_ID
        ),
        {
          body: commands,
        }
      );

      logger.info(
        "✅ Successfully deployed commands to guild for development."
      );
    } else {
      logger.info("🚀 Production mode: Deploying commands globally...");

      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
        body: commands,
      });

      logger.info("✅ Successfully deployed commands globally.");
    }
  } catch (error) {
    logger.error("Error deploying commands:", error);
  }
}

deployCommands();
