import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
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
 * - Verifies the `X-Hub-Signature-256` HMAC against GITHUB_WEBHOOK_SECRET.
 * - Deduplicates by `X-GitHub-Delivery` so retried deliveries are a no-op.
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

  if (deliveryId) {
    const already = await prisma.webhookDelivery.findUnique({ where: { deliveryId } });
    if (already) {
      return NextResponse.json({ ok: true, duplicate: true });
    }
  }

  const payload = JSON.parse(rawBody);

  if (deliveryId) {
    await prisma.webhookDelivery.create({
      data: { deliveryId, event: eventType ?? "unknown", payload },
    });
  }

  if (eventType === "ping") {
    return NextResponse.json({ ok: true, pong: true });
  }

  if (eventType !== "star") {
    // We only act on star events; other events are stored for audit above.
    return NextResponse.json({ ok: true, ignored: eventType });
  }

  const action = payload.action as "created" | "deleted";
  const ghRepo = payload.repository;
  const sender = payload.sender;

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
        starredAt: payload.starred_at ? new Date(payload.starred_at) : new Date(),
      },
      update: {},
    });
    // Confirm against the API (source of truth) before crediting score.
    await reverifyStar(user.id, repository.id);
  } else if (action === "deleted") {
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
}
