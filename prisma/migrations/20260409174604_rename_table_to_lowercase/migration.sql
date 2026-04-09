/*
  Warnings:

  - You are about to drop the `Subscription` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "Subscription";

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "confirmToken" TEXT NOT NULL,
    "unsubscribeToken" TEXT NOT NULL,
    "lastSeenTag" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_confirmToken_key" ON "subscriptions"("confirmToken");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_unsubscribeToken_key" ON "subscriptions"("unsubscribeToken");

-- CreateIndex
CREATE INDEX "subscriptions_email_idx" ON "subscriptions"("email");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_email_repo_key" ON "subscriptions"("email", "repo");
