export interface AquariumInvitation {
  aquariumId: string;
  aquariumName: string;
  email: string;
  invitedBy: string | null;
  expiresAt: string | null;
}

export interface InvitationNotifier {
  sendInvitation(invitation: AquariumInvitation): Promise<void>;
  sendAlert?(alert: AquariumAlertEmail): Promise<void>;
}

export interface AquariumAlertEmail {
  aquariumName: string;
  email: string;
  title: string;
  details: string | null;
}

export class ResendInvitationNotifier implements InvitationNotifier {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly applicationUrl = "https://www.modreef.net",
  ) {}

  async sendInvitation(invitation: AquariumInvitation): Promise<void> {
    const url = `${this.applicationUrl.replace(/\/$/, "")}/?invitation=${encodeURIComponent(invitation.aquariumId)}`;
    const expiry = invitation.expiresAt
      ? ` This invitation expires ${new Date(invitation.expiresAt).toLocaleString("en-US", { timeZone: "UTC" })} UTC.`
      : "";
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: [invitation.email],
        subject: `You were invited to ${invitation.aquariumName} in modREEF`,
        text: `${invitation.invitedBy ?? "A modREEF owner"} invited you to ${invitation.aquariumName}. Sign in with this email address to accept: ${url}.${expiry}`,
      }),
    });
    if (!response.ok) throw new Error(`Invitation email provider returned ${response.status}`);
  }

  async sendAlert(alert: AquariumAlertEmail): Promise<void> {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: [alert.email],
        subject: `${alert.aquariumName}: ${alert.title}`,
        text: `${alert.title}${alert.details ? `\n\n${alert.details}` : ""}\n\nOpen modREEF: ${this.applicationUrl}`,
      }),
    });
    if (!response.ok) throw new Error(`Alert email provider returned ${response.status}`);
  }
}
