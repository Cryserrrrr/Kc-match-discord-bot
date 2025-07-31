export const CONFIG = {
  // Timeouts
  TIMEOUTS: {
    DISCORD_LOGIN: 30000, // 30 seconds
    CLIENT_READY: 30000, // 30 seconds
    PANDASCORE_API: 30000, // 30 seconds
    PANDASCORE_FETCH: 60000, // 60 seconds
    DATABASE_QUERY: 10000, // 10 seconds
    INTERACTION_REPLY: 15000, // 15 seconds
  },

  // Rate limiting
  RATE_LIMITS: {
    MESSAGE_DELAY: 1000, // 1 second between messages
    API_CALLS_PER_MINUTE: 60,
  },

  // Retry settings
  RETRY: {
    MAX_ATTEMPTS: 3,
    DELAY_BETWEEN_ATTEMPTS: 2000, // 2 seconds
  },

  // Logging
  LOGGING: {
    ENABLE_DEBUG: process.env.NODE_ENV === "development",
    LOG_LEVEL: process.env.LOG_LEVEL || "info",
  },

  // Database
  DATABASE: {
    CONNECTION_TIMEOUT: 10000,
    QUERY_TIMEOUT: 10000,
  },

  // Discord
  DISCORD: {
    MAX_MESSAGE_LENGTH: 2000,
    MAX_EMBED_LENGTH: 6000,
    INTERACTION_TIMEOUT: 3000, // 3 seconds default
  },
};

export const ERROR_MESSAGES = {
  TIMEOUT: {
    DISCORD_LOGIN: "Timeout lors de la connexion à Discord",
    CLIENT_READY: "Timeout lors de l'initialisation du client Discord",
    PANDASCORE_API: "Timeout lors de la requête vers l'API PandaScore",
    DATABASE_QUERY: "Timeout lors de la requête à la base de données",
    INTERACTION_REPLY: "Timeout lors de la réponse à l'interaction",
  },
  NETWORK: {
    PANDASCORE_UNAVAILABLE: "L'API PandaScore n'est pas disponible",
    DISCORD_UNAVAILABLE: "Discord n'est pas disponible",
    DATABASE_UNAVAILABLE: "La base de données n'est pas disponible",
  },
  VALIDATION: {
    INVALID_TOKEN: "Token Discord invalide",
    INVALID_PANDASCORE_TOKEN: "Token PandaScore invalide",
    MISSING_PERMISSIONS: "Permissions manquantes",
  },
  GENERAL: {
    UNKNOWN_ERROR: "Une erreur inattendue s'est produite",
    COMMAND_EXECUTION_ERROR: "Erreur lors de l'exécution de la commande",
    INTERACTION_ERROR: "Erreur lors du traitement de l'interaction",
  },
};
