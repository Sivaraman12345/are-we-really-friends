import crypto from "crypto";
import type { Participant } from "./types";

/**
 * Security, sanitization, and ID validation helpers for A.W.R.F.
 */

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const AUTH_COOKIE_NAME = "awrf_auth";
const MAX_STORED_SESSIONS = 12;

export interface StoredSessionItem {
  participantId: string;
  sessionToken: string;
  role: "A" | "B";
}

export type SessionMap = Record<string, StoredSessionItem>;

/**
 * Validates if a string is a standard RFC 4122 UUID.
 */
export function isValidUuid(id: unknown): id is string {
  if (!id || typeof id !== "string") return false;
  return UUID_REGEX.test(id.trim());
}

/**
 * Sanitizes and bounds display names.
 * Strips HTML tags, control characters, and limits to 50 characters.
 */
export function sanitizeDisplayName(name: unknown): string | null {
  if (!name || typeof name !== "string") return null;

  const cleaned = name
    .replace(/[<>'"&]/g, "") // strip HTML tags/dangerous characters
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "") // strip control characters
    .replace(/\s+/g, " ") // normalize repeated whitespace
    .trim();

  if (cleaned.length === 0) return null;
  return cleaned.slice(0, 50);
}

/**
 * Generates an anonymous, cryptographically secure bearer session token
 * for authenticating participant actions without accounts.
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Parses raw Cookie header string and returns the session map.
 */
export function parseAuthCookie(cookieHeader: string | null): SessionMap {
  if (!cookieHeader) return {};

  try {
    const cookies = cookieHeader.split(";");
    for (const cookie of cookies) {
      const [rawName, ...rest] = cookie.trim().split("=");
      if (rawName === AUTH_COOKIE_NAME) {
        const rawVal = rest.join("=");
        if (!rawVal) continue;
        const decoded = Buffer.from(decodeURIComponent(rawVal), "base64").toString("utf-8");
        const parsed = JSON.parse(decoded);
        if (parsed && typeof parsed.sessions === "object" && parsed.sessions !== null) {
          return parsed.sessions as SessionMap;
        }
      }
    }
  } catch {
    // Malformed cookie ignored
  }

  return {};
}

/**
 * Encodes the sessions map into a secure Set-Cookie header string.
 */
export function serializeAuthCookie(sessions: SessionMap): string {
  // Prune to the latest N sessions to stay safely below 4KB cookie limit
  const keys = Object.keys(sessions);
  const prunedSessions: SessionMap = {};
  const recentKeys = keys.slice(-MAX_STORED_SESSIONS);
  for (const k of recentKeys) {
    prunedSessions[k] = sessions[k];
  }

  const payload = JSON.stringify({ v: 1, sessions: prunedSessions });
  const encoded = Buffer.from(payload, "utf-8").toString("base64");
  const isProd = process.env.NODE_ENV === "production";
  const secureFlag = isProd ? "; Secure" : "";

  // 30 days max age
  return `${AUTH_COOKIE_NAME}=${encodeURIComponent(encoded)}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax${secureFlag}`;
}

/**
 * Helper to build an updated Set-Cookie header containing a new or updated test session.
 */
export function buildUpdatedAuthCookie(
  testId: string,
  participantId: string,
  sessionToken: string,
  role: "A" | "B",
  existingCookieHeader: string | null
): string {
  const currentSessions = parseAuthCookie(existingCookieHeader);
  currentSessions[testId] = {
    participantId,
    sessionToken,
    role,
  };
  return serializeAuthCookie(currentSessions);
}

/**
 * Extracts a participant session token from incoming request headers or secure cookie.
 * Strictly checks x-session-token header, Authorization: Bearer, and awrf_auth cookie.
 */
export function extractSessionToken(
  request: Request,
  testId?: string | null,
  participantId?: string | null
): string | null {
  const headers = request.headers;

  // 1. Check explicit header token
  const headerToken = headers.get("x-session-token");
  if (headerToken && headerToken.trim().length > 0) {
    return headerToken.trim();
  }

  // 2. Check Authorization Bearer header
  const auth = headers.get("authorization");
  if (auth && auth.startsWith("Bearer ")) {
    const bearer = auth.slice(7).trim();
    if (bearer.length > 0) return bearer;
  }

  // 3. Check persistent HTTP-only cookie
  const cookieHeader = headers.get("cookie");
  if (cookieHeader) {
    const sessions = parseAuthCookie(cookieHeader);

    // Look up by testId if provided
    if (testId && sessions[testId]?.sessionToken) {
      return sessions[testId].sessionToken;
    }

    // Or look up by participantId across all sessions in the cookie
    if (participantId) {
      for (const item of Object.values(sessions)) {
        if (item.participantId === participantId && item.sessionToken) {
          return item.sessionToken;
        }
      }
    }
  }

  return null;
}

/**
 * Verifies if the provided session token matches the participant's secret token.
 */
export function verifyParticipantAuthorization(
  participant: Participant,
  token: string | null
): boolean {
  if (!participant.session_token) {
    // Legacy fallback for tests created prior to token enforcement
    return true;
  }
  if (!token) return false;

  // Constant-time comparison to prevent timing attacks
  const tokenBuf = Buffer.from(token.trim());
  const expectedBuf = Buffer.from(participant.session_token.trim());

  if (tokenBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(tokenBuf, expectedBuf);
}

/**
 * High-level helper to check if an incoming HTTP request is authorized to act as the given participant.
 */
export function isRequestAuthorizedForParticipant(
  request: Request,
  participant: Participant
): boolean {
  const token = extractSessionToken(request, participant.test_id, participant.id);
  return verifyParticipantAuthorization(participant, token);
}
