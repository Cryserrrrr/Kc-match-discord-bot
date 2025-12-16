-- AlterTable
ALTER TABLE "guild_settings" ADD COLUMN     "enableTwitchNotifications" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "twitch_players" (
    "id" TEXT NOT NULL,
    "twitchLogin" TEXT NOT NULL,
    "twitchUserId" TEXT,
    "playerName" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "teamName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "twitch_players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "twitch_streams" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userLogin" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "gameName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "viewerCount" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "thumbnailUrl" TEXT NOT NULL,
    "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "twitch_streams_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "twitch_players_twitchLogin_key" ON "twitch_players"("twitchLogin");

-- CreateIndex
CREATE UNIQUE INDEX "twitch_streams_userId_key" ON "twitch_streams"("userId");
