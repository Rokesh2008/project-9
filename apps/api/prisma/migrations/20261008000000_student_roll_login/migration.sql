ALTER TABLE "User" ADD COLUMN "loginIdentifier" TEXT;
CREATE UNIQUE INDEX "User_loginIdentifier_key" ON "User"("loginIdentifier");
