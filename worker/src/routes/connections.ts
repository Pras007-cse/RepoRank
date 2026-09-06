import { Env, errorResponse, jsonResponse } from "../types";
import { getSupabase } from "../db";
import { extractBearerToken, verifySessionToken } from "../session";
import { checkRateLimit, getClientIp } from "../ratelimit";

async function requireSession(req: Request, env: Env): Promise<string | null> {
  const token = extractBearerToken(req);
  if (!token) return null;
  return verifySessionToken(token, env.SESSION_SIGNING_SECRET);
}

/**
 * POST /api/connections
 * Body: { "addresseeId": "<user uuid>" }
 * Requester is taken from the session token, never from the request body —
 * that's the entire point of requiring a session here (see session.ts).
 */
export async function handleCreateConnection(req: Request, env: Env): Promise<Response> {
  const requesterId = await requireSession(req, env);
  if (!requesterId) return errorResponse("Verify a project first to get a session.", 401);

  const ip = getClientIp(req);
  const rl = await checkRateLimit(env.RATE_LIMIT_KV, `connect:${requesterId}:${ip}`, 30, 3600);
  if (!rl.allowed) return errorResponse("Too many connection requests, try again later.", 429);

  let body: { addresseeId?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body.");
  }
  if (!body.addresseeId || typeof body.addresseeId !== "string") {
    return errorResponse("addresseeId is required.");
  }
  if (body.addresseeId === requesterId) {
    return errorResponse("You can't connect with yourself.");
  }

  const db = getSupabase(env);
  const { data, error } = await db
    .from("connections")
    .insert({ requester_id: requesterId, addressee_id: body.addresseeId, status: "pending" })
    .select("*")
    .single();

  if (error) {
    // Unique index on the unordered pair (see schema.sql) rejects a second
    // pending/accepted request between the same two people either direction.
    if (error.code === "23505") {
      return errorResponse("A connection already exists or is pending between these accounts.", 409);
    }
    console.error("handleCreateConnection error", error);
    return errorResponse("Failed to create connection request.", 500);
  }

  return jsonResponse(data, 201);
}

/**
 * POST /api/connections/:id/respond
 * Body: { "action": "accept" | "decline" }
 * Only the addressee (proven via session) may respond.
 */
export async function handleRespondConnection(req: Request, env: Env, connectionId: string): Promise<Response> {
  const userId = await requireSession(req, env);
  if (!userId) return errorResponse("Verify a project first to get a session.", 401);

  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body.");
  }
  if (body.action !== "accept" && body.action !== "decline") {
    return errorResponse('action must be "accept" or "decline".');
  }

  const db = getSupabase(env);
  const { data: connection, error: findErr } = await db
    .from("connections")
    .select("*")
    .eq("id", connectionId)
    .maybeSingle();
  if (findErr) {
    console.error("handleRespondConnection lookup error", findErr);
    return errorResponse("Failed to look up connection.", 500);
  }
  if (!connection) return errorResponse("Connection request not found.", 404);
  if (connection.addressee_id !== userId) {
    return errorResponse("Only the addressee can respond to this request.", 403);
  }
  if (connection.status !== "pending") {
    return errorResponse("This request has already been responded to.", 409);
  }

  const { data: updated, error: updateErr } = await db
    .from("connections")
    .update({ status: body.action === "accept" ? "accepted" : "declined", responded_at: new Date().toISOString() })
    .eq("id", connectionId)
    .select("*")
    .single();
  if (updateErr) {
    console.error("handleRespondConnection update error", updateErr);
    return errorResponse("Failed to update connection.", 500);
  }

  return jsonResponse(updated);
}
