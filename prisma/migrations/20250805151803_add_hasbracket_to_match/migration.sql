-- AlterTable
ALTER TABLE "matches" ADD COLUMN     "hasBracket" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tournamentId" TEXT;

-- CreateTable
CREATE TABLE "standing_cache" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "standing_cache_pkey" PRIMARY KEY ("id")
);
