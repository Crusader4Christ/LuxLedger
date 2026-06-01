CREATE TYPE "public"."overdraft_policy" AS ENUM('ALLOW', 'DISALLOW');

ALTER TABLE "accounts"
ADD COLUMN "overdraft_policy" "overdraft_policy" NOT NULL DEFAULT 'ALLOW';
