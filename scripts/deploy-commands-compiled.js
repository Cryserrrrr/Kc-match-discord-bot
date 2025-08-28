const { REST, Routes } = require("discord.js");
const { readdirSync } = require("fs");
const { join } = require("path");
const { logger } = require("../dist/utils/logger");

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

    logger.info("🚀 Deploying commands globally...");

    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
      body: commands,
    });

    logger.info("✅ Successfully deployed commands globally.");
  } catch (error) {
    logger.error("Error deploying commands:", error);
  }
}

deployCommands();
