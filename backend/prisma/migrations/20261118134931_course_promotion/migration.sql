-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "isPromoted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "promotionOrder" INTEGER NOT NULL DEFAULT 0;
