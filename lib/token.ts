export const TOKEN_EXPIRY_SECONDS = 120;
export const MAX_SESSION_SECONDS = 600;

/** GET https://agents.assemblyai.com/v1/token — expires_in_seconds is REQUIRED (1..600). */
export function buildTokenUrl(): URL {
  const url = new URL("https://agents.assemblyai.com/v1/token");
  url.searchParams.set("expires_in_seconds", String(TOKEN_EXPIRY_SECONDS));
  url.searchParams.set("max_session_duration_seconds", String(MAX_SESSION_SECONDS));
  return url;
}
