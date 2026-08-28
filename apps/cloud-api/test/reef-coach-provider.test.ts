import { describe, expect, it, vi } from "vitest";
import { buildReefSnapshot } from "@modreef/api-contract";
import { OpenAIReefCoachProvider } from "../src/reef-coach-provider.js";

const snapshot = buildReefSnapshot({
  aquarium: { id: "reef-a", name: "Reef" }, equipment: [],
  observedAt: "2026-08-10T12:00:00.000Z",
});

function responseFor(value: unknown): Response {
  return new Response(JSON.stringify({
    status: "completed",
    output: [{ content: [{ type: "output_text", text: JSON.stringify(value) }] }],
  }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("OpenAIReefCoachProvider", () => {
  it("requests strict structured output and validates the recommendation", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => responseFor({
      schemaVersion: "1", generatedAt: snapshot.observedAt,
      summary: "Waiting for readings", severity: "watch", confidence: "low",
      observations: [], hypotheses: [], recommendations: [],
      missingInformation: snapshot.missingInformation, suggestedFollowUpAt: null,
    }));
    const provider = new OpenAIReefCoachProvider("secret", "gpt-test", fetcher as typeof fetch);
    expect((await provider.analyze(snapshot)).summary).toBe("Waiting for readings");
    const request = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(request).toMatchObject({
      model: "gpt-test", store: false,
      text: { format: { type: "json_schema", strict: true } },
    });
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual(expect.objectContaining({ authorization: "Bearer secret" }));
  });

  it("rejects invented evidence identifiers", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => responseFor({
      schemaVersion: "1", generatedAt: snapshot.observedAt,
      summary: "Invented", severity: "info", confidence: "high",
      observations: [{ statement: "Invented", evidenceIds: ["measurement:not-real"] }],
      hypotheses: [], recommendations: [], missingInformation: [], suggestedFollowUpAt: null,
    }));
    const provider = new OpenAIReefCoachProvider("secret", "gpt-test", fetcher as typeof fetch);
    await expect(provider.analyze(snapshot)).rejects.toThrow("outside the Reef Snapshot");
  });
});
