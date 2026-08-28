const defaultDomain = "modreef-prod.us.auth0.com";
const defaultAudience = "https://api.modreef.net";
const defaultWebClientId = "hechWmvgelkOfHIOYGfxsGYilYwqvR5t";
const defaultNativeClientId = "GBBfPpP7bS3Ft1EcpLTUyA7JWyrmgkIU";
const defaultDatabaseConnection = "Username-Password-Authentication";

export interface AuthConfig {
  audience: string;
  clientId: string;
  databaseConnection: string;
  domain: string;
  issuer: string;
}

export function authConfig(platform: string): AuthConfig {
  const domain = process.env.EXPO_PUBLIC_MODREEF_AUTH0_DOMAIN ?? defaultDomain;
  const audience =
    process.env.EXPO_PUBLIC_MODREEF_AUTH0_AUDIENCE ?? defaultAudience;
  const webClientId =
    process.env.EXPO_PUBLIC_MODREEF_AUTH0_WEB_CLIENT_ID ?? defaultWebClientId;
  const nativeClientId =
    process.env.EXPO_PUBLIC_MODREEF_AUTH0_NATIVE_CLIENT_ID ??
    defaultNativeClientId;
  const databaseConnection =
    process.env.EXPO_PUBLIC_MODREEF_AUTH0_DATABASE_CONNECTION ??
    defaultDatabaseConnection;

  return {
    audience,
    clientId: platform === "web" ? webClientId : nativeClientId,
    databaseConnection,
    domain,
    issuer: `https://${domain}`,
  };
}
