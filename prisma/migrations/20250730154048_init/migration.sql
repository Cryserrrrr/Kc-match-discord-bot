-- CreateTable
CREATE TABLE "matches" (
    "id" TEXT NOT NULL,
    "kcTeam" TEXT NOT NULL,
    "kcId" TEXT NOT NULL,
    "opponent" TEXT NOT NULL,
    "opponentImage" TEXT,
    "leagueName" TEXT NOT NULL,
    "leagueImage" TEXT,
    "serieName" TEXT NOT NULL,
    "tournamentName" TEXT NOT NULL,
    "numberOfGames" INTEGER NOT NULL,
    "beginAt" TIMESTAMP(3) NOT NULL,
    "announced" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guild_settings" (
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "customMessage" TEXT NOT NULL,
    "filteredTeams" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "guild_settings_pkey" PRIMARY KEY ("guildId")
);
