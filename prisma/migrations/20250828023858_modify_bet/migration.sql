-- Enum pour le type de bet
DO $$ BEGIN
  CREATE TYPE "BetType" AS ENUM ('TEAM', 'SCORE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Colonnes temporaires (nullables le temps du backfill)
ALTER TABLE "bets" ADD COLUMN "selection" TEXT;
ALTER TABLE "bets" ADD COLUMN "type" "BetType";

-- Backfill depuis l’ancienne colonne "team"
UPDATE "bets"
SET "type" = 'SCORE',
    "selection" = REPLACE("team",'SCORE:','')
WHERE "team" LIKE 'SCORE:%';

UPDATE "bets"
SET "type" = 'TEAM',
    "selection" = "team"
WHERE "type" IS NULL;

-- Rendre NOT NULL après backfill
ALTER TABLE "bets" ALTER COLUMN "selection" SET NOT NULL;
ALTER TABLE "bets" ALTER COLUMN "type" SET NOT NULL;

-- Supprimer ancienne contrainte unique et ajouter la nouvelle
DO $$ BEGIN
  ALTER TABLE "bets" DROP CONSTRAINT "bets_userId_matchId_team_key";
EXCEPTION
  WHEN undefined_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "bets_userId_matchId_type_key"
ON "bets"("userId","matchId","type");

-- Supprimer l’ancienne colonne
ALTER TABLE "bets" DROP COLUMN "team";