-- CreateEnum
CREATE TYPE "TournamentStatus" AS ENUM ('REGISTRATION', 'ACTIVE', 'FINISHED', 'CANCELLED');

-- AlterTable
ALTER TABLE "bets" ADD COLUMN     "guildId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "duels" ADD COLUMN     "guildId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "parlays" ADD COLUMN     "guildId" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "tournaments" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TournamentStatus" NOT NULL DEFAULT 'REGISTRATION',
    "createdBy" TEXT NOT NULL,
    "registrationEndsAt" TIMESTAMP(3) NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "virtualStake" INTEGER NOT NULL DEFAULT 100,
    "messageChannelId" TEXT,
    "messageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tournaments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_participants" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "betsWon" INTEGER NOT NULL DEFAULT 0,
    "betsLost" INTEGER NOT NULL DEFAULT 0,
    "parlaysWon" INTEGER NOT NULL DEFAULT 0,
    "parlaysLost" INTEGER NOT NULL DEFAULT 0,
    "duelsWon" INTEGER NOT NULL DEFAULT 0,
    "duelsLost" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tournament_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_bets" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "betId" TEXT NOT NULL,

    CONSTRAINT "tournament_bets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_parlays" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "parlayId" TEXT NOT NULL,

    CONSTRAINT "tournament_parlays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_duels" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "duelId" TEXT NOT NULL,

    CONSTRAINT "tournament_duels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tournament_participants_tournamentId_userId_key" ON "tournament_participants"("tournamentId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_bets_betId_key" ON "tournament_bets"("betId");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_parlays_parlayId_key" ON "tournament_parlays"("parlayId");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_duels_duelId_key" ON "tournament_duels"("duelId");

-- AddForeignKey
ALTER TABLE "tournament_participants" ADD CONSTRAINT "tournament_participants_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_bets" ADD CONSTRAINT "tournament_bets_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_bets" ADD CONSTRAINT "tournament_bets_betId_fkey" FOREIGN KEY ("betId") REFERENCES "bets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_parlays" ADD CONSTRAINT "tournament_parlays_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_parlays" ADD CONSTRAINT "tournament_parlays_parlayId_fkey" FOREIGN KEY ("parlayId") REFERENCES "parlays"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_duels" ADD CONSTRAINT "tournament_duels_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_duels" ADD CONSTRAINT "tournament_duels_duelId_fkey" FOREIGN KEY ("duelId") REFERENCES "duels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
