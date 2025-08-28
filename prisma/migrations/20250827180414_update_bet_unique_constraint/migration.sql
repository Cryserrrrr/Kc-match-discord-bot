/*
  Warnings:

  - A unique constraint covering the columns `[userId,matchId,team]` on the table `bets` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "bets_userId_matchId_key";

-- CreateIndex
CREATE UNIQUE INDEX "bets_userId_matchId_team_key" ON "bets"("userId", "matchId", "team");
