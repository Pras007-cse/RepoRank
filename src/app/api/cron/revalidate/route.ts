import { NextRequest, NextResponse } from "next/server";
import { runPeriodicRevalidation } from "@/lib/scoring";
import { isAuthorizedBearer } from "@/lib/authSecrets";

/**
 * Triggered on a schedule (Vercel Cron, GitHub Actions cron, or any external
 * scheduler) to re-check the stalest stars against GitHub. This is the
 * fallback path that guarantees scores stay correct even when a webhook
 * delivery is missed or a repo owner hasn't configured a webhook at all.
 *
 * Protect with a shared secret so this can't be triggered by the public.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!isAuthorizedBearer(auth, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runPeriodicRevalidation(50);
  return NextResponse.json({ ok: true, ...result });
}
