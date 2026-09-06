/**
 * Standalone entrypoint for periodic star revalidation, meant to be run by
 * an external scheduler (e.g. a GitHub Actions cron workflow) that has
 * access to the same DATABASE_URL and TOKEN_ENCRYPTION_KEY as the app.
 *
 * Usage: npm run revalidate:stars
 */
import { runPeriodicRevalidation } from "../src/lib/scoring";
import { prisma } from "../src/lib/prisma";

async function main() {
  console.log("[revalidate-stars] starting periodic revalidation pass...");
  const result = await runPeriodicRevalidation(100);
  console.log(
    `[revalidate-stars] checked ${result.checked} stars across ${result.users} users.`
  );
}

main()
  .catch((err) => {
    console.error("[revalidate-stars] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
