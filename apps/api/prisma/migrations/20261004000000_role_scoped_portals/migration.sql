ALTER TABLE "User" ADD COLUMN "facultyDomainId" TEXT;

CREATE INDEX "User_facultyDomainId_idx" ON "User"("facultyDomainId");

ALTER TABLE "User" ADD CONSTRAINT "User_facultyDomainId_fkey"
  FOREIGN KEY ("facultyDomainId") REFERENCES "Domain"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
