# Reef Coach AI architecture

**Version:** 0.1  
**Status:** Proposed  
**Date:** 2026-07-23

---

# Purpose

Reef Coach turns aquarium data into understandable observations, diagnoses, and recommendations.

The language model is an advisory reasoning layer. It is not the aquarium controller and is never the final authority for safety-critical actions.

modREEF Edge remains responsible for deterministic control, schedules, interlocks, limits, and fail-safe behavior. Cloud or AI failure must never stop aquarium control.

---

# Product principles

1. **Edge remains authoritative.** Heaters, dosers, outlets, alarms, and routines continue to operate locally without AI or internet access.
2. **Evidence before advice.** Every Coach conclusion must identify the measurements, trends, events, or reference material supporting it.
3. **Recommendations are not commands.** The model may propose an action, but a deterministic policy validator decides whether it is permitted.
4. **Uncertainty must be visible.** Stale sensors, uncalibrated probes, imprecise test kits, missing history, and conflicting readings lower confidence.
5. **Personalize from tank history.** A tank-specific baseline is more valuable than a generic reef target.
6. **Start supervised.** Physical actions require user confirmation until a narrow action has explicit preauthorization and proven safety constraints.
7. **Remain model-portable.** Reef Coach uses a provider adapter and stable internal schemas so the model can change without redesigning the product.

---

# System architecture

```text
                   modREEF Mobile
          Questions • Coach cards • Approval
                          |
                          v
                  Reef Coach Service
        Prompt • Model router • Tool orchestration
             |             |              |
             v             v              v
       Tank snapshot   Knowledge base   Read-only tools
       and features    and manuals      and history
             \             |              /
              \            |             /
               v           v            v
                Structured recommendation
                          |
                          v
                  Policy validator
             Limits • conflicts • confidence
                          |
                  approved proposal
                          |
                  user confirmation
                          |
                          v
                     modREEF Edge
        Deterministic execution • safety interlocks
```

## Edge responsibilities

- Device polling and control
- Schedules, routines, and automation
- Heater and dosing limits
- Equipment conflict rules
- Sensor freshness and calibration checks
- Local alarms and fail-safe behavior
- Event history and time-series storage
- Feature calculation needed for immediate safety decisions

## Reef Coach responsibilities

- Explain current conditions and historical trends
- Correlate measurements, equipment events, maintenance, feeding, and dosing
- Suggest the next measurement or maintenance step
- Retrieve relevant vetted documentation
- Produce ranked hypotheses rather than unsupported certainty
- Propose reversible actions for validation and user approval
- Summarize daily and weekly aquarium behavior

## Policy validator responsibilities

- Reject actions exceeding a configured dose, runtime, temperature, or frequency limit
- Reject actions based on stale, uncalibrated, implausible, or conflicting measurements
- Detect equipment and routine conflicts
- Require confirmation for side effects unless the action is explicitly preauthorized
- Record the recommendation, validation result, approval, execution, and outcome

---

# Model strategy

Use the OpenAI Responses API behind a modREEF model-provider interface.

Initial routing:

- **GPT-5.6 Terra:** normal Reef Coach questions, trend analysis, and recommendations
- **GPT-5.6 Sol:** difficult multi-factor diagnosis when the expected quality gain justifies additional cost and latency
- **GPT-5.6 Luna:** high-volume summaries, classification, and other bounded tasks after evaluation proves it adequate

Model names and reasoning levels are configuration, not hard-coded product behavior. Production deployments should use pinned model snapshots when repeatable behavior is more important than automatically receiving model updates.

The Raspberry Pi should not host the primary language model. Edge must remain lightweight, deterministic, and available. A future optional local-capability appliance may provide offline language features, but it is not required for the initial product.

---

# Aquarium context

The model should not receive an unbounded dump of raw readings. The Coach service builds a compact `ReefSnapshot` containing current state, calculated features, and the evidence relevant to the question.

## ReefSnapshot

The snapshot should include:

- Aquarium identity, water volume, system type, livestock profile, and user targets
- Current temperature, pH, ORP, and other connected sensor readings
- Recent water-test results with test kit, resolution, and timestamp
- Expected time-of-day range for continuously monitored values
- Trend slope, variability, minimum, maximum, and change over relevant windows
- Equipment state, physical binding, health, calibration, and recent state changes
- Dosing, feeding, water changes, routines, maintenance, and alarms
- Sensor age, calibration age, freshness, and confidence
- Missing or contradictory information
- Relevant prior Coach recommendations and observed outcomes

Example:

```json
{
  "observedAt": "2026-07-23T18:00:00Z",
  "temperature": {
    "current": 78.1,
    "unit": "F",
    "expectedNow": { "minimum": 77.6, "maximum": 78.4 },
    "change24Hours": 0.2,
    "confidence": "high"
  },
  "alkalinity": {
    "latest": 7.8,
    "unit": "dKH",
    "ageHours": 18,
    "slope7Days": -0.09,
    "testKit": "Hanna HI772",
    "confidence": "medium"
  },
  "recentEvents": [
    { "type": "water-change", "ageHours": 30, "volumePercent": 15 }
  ]
}
```

## Tank-specific baseline

Personalization does not initially require fine-tuning. modREEF should learn a statistical baseline for each aquarium:

- Normal daily temperature, pH, and ORP curves
- Normal rate of change and variability
- Alkalinity, calcium, and magnesium consumption
- Typical nitrate and phosphate movement
- Response to feeding, dosing, water changes, and maintenance
- Equipment duty cycles and startup behavior
- Seasonal or room-temperature effects

The baseline should preserve absolute safety limits. A value does not become safe merely because it is normal for that aquarium.

---

# Tools and knowledge

The model receives narrowly scoped tools with explicit input and output schemas.

Initial read-only tools:

- `get_aquarium_profile`
- `get_current_water_quality`
- `get_measurement_history`
- `get_equipment_state`
- `get_event_history`
- `get_dosing_history`
- `get_maintenance_history`
- `get_sensor_health`
- `search_reference_library`

Later proposal tools may include:

- `propose_routine_run`
- `propose_equipment_change`
- `propose_dose_adjustment`
- `schedule_follow_up_check`

Proposal tools do not execute equipment actions. They create a structured proposal for policy validation and approval.

The reference library should contain vetted, versioned material such as:

- modREEF operating and safety documentation
- Qualified device manuals
- Test-kit instructions and conversion tables
- Probe calibration and maintenance instructions
- Curated reef chemistry and husbandry references

Tank state belongs in tools and the Digital Twin. Current factual material belongs in the reference library. Neither should be baked into model weights.

---

# Structured recommendation

All Coach responses should conform to a stable schema before being rendered in the app.

```ts
type CoachRecommendation = {
  summary: string;
  severity: "info" | "watch" | "warning" | "critical";
  confidence: "low" | "medium" | "high";
  observations: Array<{
    statement: string;
    evidenceIds: string[];
  }>;
  hypotheses: Array<{
    explanation: string;
    confidence: "low" | "medium" | "high";
  }>;
  recommendations: Array<{
    action: string;
    reason: string;
    requiresConfirmation: boolean;
  }>;
  missingInformation: string[];
  suggestedFollowUpAt?: string;
};
```

The app should distinguish observed facts, model inferences, and recommended actions. A low-confidence answer should favor another measurement or inspection over an equipment change.

---

# Safety and autonomy

Reef Coach rolls out through explicit autonomy levels.

## Level 1: Observer

- Daily and weekly summaries
- Trend and anomaly explanations
- Suggested tests and maintenance
- No physical action proposals

## Level 2: Advisor

- Ranked diagnoses with supporting evidence
- Recommended actions and follow-up timing
- No physical execution

## Level 3: Supervised operator

- Creates validated action or routine proposals
- User reviews and confirms every side effect
- Edge executes and logs approved actions

## Level 4: Limited automation

- Only narrow, reversible actions explicitly preauthorized by the user
- Deterministic limits, cooldowns, and rollback behavior remain mandatory
- Dosing and life-support changes require higher safety standards than notifications or data collection

Reef Coach must never weaken an Edge safety interlock, bypass an equipment limit, or treat model confidence as a substitute for sensor validation.

---

# Improvement and training strategy

Do not train a model from scratch and do not begin with fine-tuning.

## Phase 1: Prompt, tools, and retrieval

- Establish the safety and evidence prompt
- Implement stable snapshots and structured outputs
- Supply current aquarium facts through tools
- Supply documentation through retrieval
- Review failures and improve schemas before adding prompt complexity

## Phase 2: Evaluation set

Create reviewed cases representing normal operation, ambiguous situations, and dangerous failures. Cases should include:

- Normal nighttime cooling versus heater failure
- A heater or doser stuck on
- Falling alkalinity with stable calcium
- pH suppression associated with room carbon dioxide
- Expected ORP movement following feeding or maintenance
- A sensor spike that conflicts with other evidence
- Chemistry changes explained by a recent water change
- Insufficient evidence where the correct response is to test again

Score each version for:

- Factual and numerical correctness
- Correct use of aquarium evidence
- Appropriate confidence and uncertainty
- Correct tool selection
- Safety-policy compliance
- Absence of invented measurements or events
- Helpfulness and clarity
- Cost and latency

No prompt, model, retrieval, or routing change should ship without running the same evaluation set.

## Phase 3: Outcome and feedback data

Record:

- The triggering question or event
- The exact snapshot and references supplied
- The Coach response and policy-validation result
- Whether the recommendation was accepted, modified, or dismissed
- The action actually taken
- Outcomes after approximately 6 hours, 24 hours, 72 hours, and 7 days
- User or expert assessment

An improved outcome does not automatically prove that a recommendation caused it. Confounded examples require review before reuse.

## Phase 4: Fine-tuning, if justified

Fine-tuning is considered only after evaluations reveal a repeated behavior that prompting, tool design, or retrieval does not solve economically.

Good candidates:

- Consistent Reef Coach tone and response organization
- Repeated classification or triage behavior
- Compact structured summaries at high volume

Poor candidates:

- Current aquarium readings
- Individual tank history
- Manufacturer documentation that may change
- Safety limits that must remain explicit and auditable
- General reef facts better supplied by vetted retrieval

Training examples must be reviewed, de-identified where appropriate, and separated from the evaluation set.

---

# Privacy, reliability, and observability

- Send the minimum aquarium context needed for the question
- Keep API credentials in the cloud service, never in the mobile application
- Log model, prompt version, tool calls, evidence IDs, token use, latency, and policy decisions
- Apply timeouts and bounded retries
- Display a clear unavailable state instead of silently substituting unsupported advice
- Retain local control when cloud connectivity is lost
- Add an Edge-to-cloud watchdog separately from Reef Coach reasoning
- Define retention and deletion behavior before using customer interactions for product improvement

---

# Initial product scope

The first production Reef Coach should be an observer and advisor only.

Initial capabilities:

1. Explain a selected measurement or sensor trend
2. Generate a concise daily aquarium summary
3. Flag unusual changes relative to the tank's baseline
4. Recommend the next test or inspection
5. Correlate recent equipment, feeding, dosing, maintenance, and water-change events
6. Create a follow-up reminder

Explicitly deferred:

- Autonomous dosing changes
- Autonomous heater or life-support control
- Unreviewed learning from customer outcomes
- A language model running on the required Edge hardware

---

# First implementation milestone

1. Define versioned `ReefSnapshot` and `CoachRecommendation` schemas
2. Implement read-only Coach tools over existing Digital Twin, event, and measurement APIs
3. Add sensor freshness, calibration, and confidence calculations
4. Build an initial reviewed evaluation set
5. Implement the provider adapter and GPT-5.6 Terra baseline
6. Render evidence, confidence, and missing information in the Reef Coach UI
7. Operate in Observer mode and collect reviewed feedback before enabling action proposals

