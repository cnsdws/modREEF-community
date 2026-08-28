# Shared client connection

Step 5 connects the adaptive Expo application used by web, iPhone/iPad, and Android to the shared cloud client while preserving the local development path.

The default is local Edge mode. Cloud mode requires an explicit build setting:

```text
EXPO_PUBLIC_MODREEF_CONNECTION_MODE=cloud
EXPO_PUBLIC_MODREEF_CLOUD_URL=https://api.modreef.net
```

Access tokens are supplied by the OIDC sign-in screen through `setCloudAccessToken`. Native clients persist them with Expo Secure Store. The web client keeps its token in the active session instead of embedding credentials in a public environment variable.

The shared client now uses Auth0 Authorization Code + PKCE in cloud mode. It
selects the Auth0 SPA client registration on web and the Native registration
on iOS and Android. The public defaults target the production modREEF tenant;
deployments can override them with `EXPO_PUBLIC_MODREEF_AUTH0_DOMAIN`,
`EXPO_PUBLIC_MODREEF_AUTH0_AUDIENCE`,
`EXPO_PUBLIC_MODREEF_AUTH0_WEB_CLIENT_ID`, and
`EXPO_PUBLIC_MODREEF_AUTH0_NATIVE_CLIENT_ID`. No client secret is shipped.

In cloud mode the dashboard selects the last available aquarium, loads its registered Edges and reported equipment snapshots, and submits manual on/off operations to the durable command queue. Local mode continues to call the Pi directly.

Automatic program editing, aquarium renaming, and equipment renaming remain local-only in this slice. Cloud mode returns a clear error for those actions. All existing advanced Edge panels still use their LAN APIs until their cloud contracts are implemented.

No cloud connection occurs in current development builds because local mode is the default and no cloud URL or access token is configured.
