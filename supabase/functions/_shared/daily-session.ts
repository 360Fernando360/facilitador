const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function decodeJwtPayload(accessToken: string): Record<string, unknown> | null {
  const payload = accessToken.split(".")[1];
  if (!payload) return null;
  try {
    const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
    const padding = "=".repeat((4 - normalized.length % 4) % 4);
    return JSON.parse(atob(normalized + padding));
  } catch {
    return null;
  }
}

export function sessionIdFromAccessToken(accessToken: string): string | null {
  const sessionId = decodeJwtPayload(accessToken)?.session_id;
  return typeof sessionId === "string" && UUID_PATTERN.test(sessionId)
    ? sessionId
    : null;
}

export async function hasValidDailySession(
  admin: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> },
  accessToken: string,
  userId: string,
): Promise<boolean> {
  const sessionId = sessionIdFromAccessToken(accessToken);
  if (!sessionId) return false;
  const { data, error } = await admin.rpc("is_daily_session_valid_for", {
    target_user_id: userId,
    target_session_id: sessionId,
  });
  return !error && data === true;
}
