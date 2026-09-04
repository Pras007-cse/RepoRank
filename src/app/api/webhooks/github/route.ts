import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { reverifyStar, recomputeUserScore, recomputeGlobalRanks } from "@/lib/scoring";

/**
 * Receives GitHub's `star` webhook event (action: "created" | "deleted"),
 * which repo owners configure to point here. This is the fast path for
 * keeping scores accurate — `runPeriodicRevalidation` (lib/scoring.ts) is
 * the slower fallback path for repos without a webhook configured, or for
 * deliveries that are missed.
 *
 * Security:
 * - Verifies the `X-Hub-Signature-256` HMAC against GITHUB_WEBHOOK_SECRET
 *   before the raw body is parsed or trusted in any way.
 * - Deduplicates by `X-GitHub-Delivery` so retried deliveries are a no-op.
 * - Validates the parsed payload's shape with zod. This only ever runs
 *   after signature verification (so it protects against malformed/replayed
 *   bodies and future GitHub payload changes, not against a random
 *   attacker), but a validation failure still returns a clean 400 instead
 *   of throwing and returning an unhandled 500 with a stack trace.
 */
function verifySignature(rawBody: string, signatureHeader: string | null, secret: string) {
  if (!signatureHeader) return false;
  const expected =
    "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const starPayloadSchema = z.object({
  action: z.enum(["created", "deleted"]),
  starred_at: z.string().datetime().nullish(),
  repository: z.object({ id: z.number() }),
  sender: z.object({ id: z.number() }),
});

export async function POST(req: NextRequest) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    console.error("GITHUB_WEBHOOK_SECRET is not configured.");
    return NextResponse.json({ error: "Webhook not configured." }, { status: 500 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  if (!verifySignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  const deliveryId = req.headers.get("x-github-delivery");
  const eventType = req.headers.get("x-github-event");

  try {
    if (deliveryId) {
      const already = await prisma.webhookDelivery.findUnique({ where: { deliveryId } });
      if (already) {
        return NextResponse.json({ ok: true, duplicate: true });
      }
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Malformed JSON payload." }, { status: 400 });
    }

    if (deliveryId) {
      await prisma.webhookDelivery.create({
        data: {
          deliveryId,
          event: eventType ?? "unknown",
          payload: payload as object,
        },
      });
    }

    if (eventType === "ping") {
      return NextResponse.json({ ok: true, pong: true });
    }

    if (eventType !== "star") {
      // We only act on star events; other events are stored for audit above.
      return NextResponse.json({ ok: true, ignored: eventType });
    }

    const parsed = starPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      console.error("Webhook payload failed validation", parsed.error.flatten());
      return NextResponse.json({ error: "Unrecognized payload shape." }, { status: 400 });
    }
    const { action, repository: ghRepo, sender, starred_at } = parsed.data;

    const repository = await prisma.repository.findUnique({
      where: { githubId: ghRepo.id },
    });
    const user = await prisma.user.findUnique({ where: { githubId: sender.id } });

    if (!repository || !user) {
      // We don't track this repo or don't know this GitHub user — nothing to do.
      return NextResponse.json({ ok: true, tracked: false });
    }

    if (action === "created") {
      await prisma.star.upsert({
        where: { userId_repositoryId: { userId: user.id, repositoryId: repository.id } },
        create: {
          userId: user.id,
          repositoryId: repository.id,
          status: "PENDING",
          starredAt: starred_at ? new Date(starred_at) : new Date(),
        },
        update: {},
      });
      // Confirm against the API (source of truth) before crediting score.
      await reverifyStar(user.id, repository.id);
    } else {
      const star = await prisma.star.findUnique({
        where: { userId_repositoryId: { userId: user.id, repositoryId: repository.id } },
      });
      if (star && star.status !== "REMOVED") {
        await prisma.star.update({
          where: { id: star.id },
          data: { status: "REMOVED", lastCheckedAt: new Date() },
        });
        await prisma.activityEvent.create({
          data: {
            userId: user.id,
            repositoryId: repository.id,
            type: "STAR_REMOVED",
            message: `Unstarred ${repository.fullName} on GitHub; contribution removed.`,
          },
        });
        await recomputeUserScore(user.id);
      }
    }

    await recomputeGlobalRanks();
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Never leak internal error details (stack traces, DB errors) to the
    // caller — GitHub just needs a non-2xx to know to retry.
    console.error("POST /api/webhooks/github error", err);
    return NextResponse.json({ error: "Internal error processing webhook." }, { status: 500 });
  }
}
