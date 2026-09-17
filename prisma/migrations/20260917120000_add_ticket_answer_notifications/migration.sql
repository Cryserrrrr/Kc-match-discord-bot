-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "notifiedAnswer" TEXT,
ADD COLUMN     "notifyOnAnswer" BOOLEAN NOT NULL DEFAULT false;
