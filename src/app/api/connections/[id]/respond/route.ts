import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveCurrentBuilderId } from "@/lib/builderSession";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().cuid() });
const bodySchema = z.object({ action: z.enum(["accept", "decline"]) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await resolveCurrentBuilderId();
  if (!userId) {
    return NextResponse.json({ error: "Verify your builder identity first." }, { status: 401 });
  }

  const parsedParams = paramsSchema.safeParse(await params);
  const parsedBody = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsedParams.success || !parsedBody.success) {
    return NextResponse.json({ error: 'Invalid request; action must be "accept" or "decline".' }, { status: 400 });
  }

  const connection = await prisma.connection.findUnique({ where: { id: parsedParams.data.id } });
  if (!connection) {
    return NextResponse.json({ error: "Connection request not found." }, { status: 404 });
  }
  if (connection.addresseeId !== userId) {
    return NextResponse.json({ error: "Only the addressee can respond to this request." }, { status: 403 });
  }
  if (connection.status !== "PENDING") {
    return NextResponse.json({ error: "This request has already been responded to." }, { status: 409 });
  }

  const updated = await prisma.connection.update({
    where: { id: connection.id },
    data: {
      status: parsedBody.data.action === "accept" ? "ACCEPTED" : "DECLINED",
      respondedAt: new Date(),
    },
  });

  return NextResponse.json({ connection: updated });
}
