import { afterEach, describe, expect, it, vi } from "vitest";
import { ResendInvitationNotifier } from "../src/invitation-notifier.js";

describe("ResendInvitationNotifier", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends a text-only invitation without exposing credentials in the link", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const notifier = new ResendInvitationNotifier("email-secret", "modREEF <invites@example.com>");
    await notifier.sendInvitation({
      aquariumId: "reef/one", aquariumName: "Display Reef", email: "helper@example.com",
      invitedBy: "owner@example.com", expiresAt: "2026-09-15T00:00:00Z",
    });
    expect(fetcher).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ authorization: "Bearer email-secret" }),
    }));
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as { text: string; to: string[] };
    expect(body.to).toEqual(["helper@example.com"]);
    expect(body.text).toContain("?invitation=reef%2Fone");
    expect(body.text).not.toContain("email-secret");
  });

  it("reports provider failure to its caller", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("no", { status: 429 }));
    await expect(new ResendInvitationNotifier("key", "from@example.com").sendInvitation({
      aquariumId: "reef", aquariumName: "Reef", email: "helper@example.com",
      invitedBy: null, expiresAt: null,
    })).rejects.toThrow("429");
  });

  it("sends aquarium alerts through the same transactional provider", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await new ResendInvitationNotifier("key", "from@example.com").sendAlert({
      aquariumName: "Display Reef", email: "helper@example.com",
      title: "Return pump is offline", details: "Confirm power and network connectivity.",
    });
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as { subject: string; text: string };
    expect(body.subject).toContain("Display Reef");
    expect(body.text).toContain("Return pump is offline");
  });
});
