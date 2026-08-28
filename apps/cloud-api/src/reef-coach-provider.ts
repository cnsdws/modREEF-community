import {
  coachRecommendationJsonSchema,
  isCoachRecommendation,
  type CoachRecommendation,
  type ReefSnapshot,
} from "@modreef/api-contract";

export interface ReefCoachProvider {
  readonly name: "openai";
  readonly model: string;
  analyze(snapshot: ReefSnapshot): Promise<CoachRecommendation>;
}

interface OpenAIResponsesResult {
  status?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string; refusal?: string }> }>;
}

export class OpenAIReefCoachProvider implements ReefCoachProvider {
  readonly name = "openai" as const;

  constructor(
    private readonly apiKey: string,
    readonly model = "gpt-5.6-sol",
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async analyze(snapshot: ReefSnapshot): Promise<CoachRecommendation> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await this.fetcher("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          store: false,
          instructions: [
            "You are modREEF Reef Coach in observer-only mode.",
            "Use only the supplied versioned snapshot. Never invent readings, events, causes, or aquarium facts.",
            "Every observation must cite one or more evidence IDs present in the snapshot.",
            "Treat stale, unstable, missing, or uncalibrated data as lower confidence.",
            "Rank plausible hypotheses without presenting them as facts.",
            "Recommend only review, observation, testing, or user-confirmed husbandry steps.",
            "Never claim to operate equipment, change dosing, or execute a control action.",
          ].join(" "),
          input: JSON.stringify(snapshot),
          text: {
            format: {
              type: "json_schema",
              name: "reef_coach_recommendation",
              strict: true,
              schema: coachRecommendationJsonSchema,
            },
          },
        }),
      });
      if (!response.ok) throw new Error(`OpenAI Responses API returned ${response.status}`);
      const result = await response.json() as OpenAIResponsesResult;
      const content = result.output?.flatMap((item) => item.content ?? []) ?? [];
      const refusal = content.find((item) => item.type === "refusal")?.refusal;
      if (refusal) throw new Error("The model declined the Reef Coach analysis");
      const outputText = content.find((item) => item.type === "output_text")?.text;
      if (!outputText) throw new Error("The model returned no structured Reef Coach output");
      const recommendation: unknown = JSON.parse(outputText);
      if (!isCoachRecommendation(recommendation)) throw new Error("The model returned an invalid Reef Coach recommendation");
      const evidenceIds = new Set([
        ...Object.values(snapshot.waterQuality).map((metric) => metric.evidenceId),
        ...snapshot.recentEvents.map((event) => event.evidenceId),
      ]);
      if (recommendation.observations.some((item) =>
        item.evidenceIds.length === 0 || item.evidenceIds.some((id) => !evidenceIds.has(id)))) {
        throw new Error("The model cited evidence outside the Reef Snapshot");
      }
      const normalized = { ...recommendation, generatedAt: new Date().toISOString() };
      if (normalized.suggestedFollowUpAt === null) delete normalized.suggestedFollowUpAt;
      return normalized;
    } finally {
      clearTimeout(timeout);
    }
  }
}
