export interface PasswordResetConfig {
  clientId: string;
  connection: string;
  domain: string;
}

export class PasswordResetRateLimitError extends Error {
  constructor() {
    super("Too many reset requests. Please wait a minute and try again.");
    this.name = "PasswordResetRateLimitError";
  }
}

export async function requestPasswordReset(
  config: PasswordResetConfig,
  email: string,
): Promise<void> {
  const response = await fetch(
    `https://${config.domain}/dbconnections/change_password`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: config.clientId,
        connection: config.connection,
        email: email.trim(),
      }),
    },
  );

  if (response.ok || response.status === 404) {
    return;
  }

  if (response.status === 429) {
    throw new PasswordResetRateLimitError();
  }

  throw new Error(
    "Password reset is temporarily unavailable. Please try again later.",
  );
}
