import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveCurrentBuilderId } from "@/lib/builderSession";
import { rateLimit } from "@/lib/rateLimit";
import { z } from "zod";

const bodySchema = z.object({ addresseeId: z.string().cuid() });

/**
 * POST /api/connections — send a connection request. Requires a verified
 * builder identity (either verification path); the requester is always
 * taken from that resolved identity, never from the request body.
 */
export async function POST(req: NextRequest) {
  const requesterId = await resolveCurrentBuilderId();
  if (!requesterId) {
    return NextResponse.json({ error: "Verify your builder identity first." }, { status: 401 });
  }

  const requester = await prisma.user.findUnique({ where: { id: requesterId } });
  if (!requester?.builderVerified) {
    return NextResponse.json({ error: "Verify your builder identity first." }, { status: 403 });
  }

  const rl = rateLimit(`connect:${requesterId}`, { limit: 30, windowMs: 3600_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many connection requests, try again later." }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "addresseeId is required." }, { status: 400 });
  }
  if (parsed.data.addresseeId === requesterId) {
    return NextResponse.json({ error: "You can't connect with yourself." }, { status: 400 });
  }

  const addressee = await prisma.user.findUnique({ where: { id: parsed.data.addresseeId } });
  if (!addressee?.builderVerified) {
    return NextResponse.json({ error: "That account hasn't verified a builder identity yet." }, { status: 422 });
  }

  // The schema's unique constraint only catches an exact-direction repeat;
  // check the reverse direction too so A→B pending doesn't let B→A create a
  // second, separate pending request between the same two people.
  const reverseExisting = await prisma.connection.findUnique({
    where: {
      requesterId_addresseeId: { requesterId: parsed.data.addresseeId, addresseeId: requesterId },
    },
  });
  if (reverseExisting && reverseExisting.status !== "DECLINED") {
    return NextResponse.json({ error: "A connection already exists or is pending between these accounts." }, { status: 409 });
  }

  try {
    const connection = await prisma.connection.create({
      data: { requesterId, addresseeId: parsed.data.addresseeId, status: "PENDING" },
    });
    return NextResponse.json({ connection }, { status: 201 });
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") {
      return NextResponse.json({ error: "A connection already exists or is pending between these accounts." }, { status: 409 });
    }
    console.error("POST /api/connections error", err);
    return NextResponse.json({ error: "Failed to create connection request." }, { status: 500 });
  }
}
