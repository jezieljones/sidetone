import assert from "node:assert/strict";
import test from "node:test";
import { liveCardWorkflowFor } from "@sidetone/contracts";
import {
  deterministicSpecialistCandidate,
  deterministicSupervisorDecision,
  normalizeCandidate,
  normalizeRoutedAgentIds
} from "./functions";

test("suppresses Sidetone onboarding audio", () => {
  const workflow = liveCardWorkflowFor("general");
  const decision = deterministicSupervisorDecision({
    transcriptWindow: "Welcome to Sidetone. In your phone app, tap add call, then merge calls.",
    workflow,
    industryProfile: "general"
  });

  assert.equal(decision.decision, "skip");
  assert.deepEqual(normalizeRoutedAgentIds(decision, workflow), []);
});

test("routes a concrete live-call control signal", () => {
  const workflow = liveCardWorkflowFor("general");
  const decision = deterministicSupervisorDecision({
    transcriptWindow: "By the way there should be an end call button on the actual call live page.",
    workflow,
    industryProfile: "general"
  });

  assert.equal(decision.decision, "route");
  assert.deepEqual(normalizeRoutedAgentIds(decision, workflow), ["commitment_signal"]);

  const specialist = workflow.specialists.find((candidate) => candidate.id === "commitment_signal");
  assert.ok(specialist);
  const candidate = deterministicSpecialistCandidate({
    transcriptWindow: "By the way there should be an end call button on the actual call live page.",
    specialist,
    sourceSegmentIds: ["segment-1"]
  });

  assert.equal(candidate.emit, true);
  assert.equal(candidate.title, "Stop notes control");
  assert.equal(candidate.dedupeKey, "product:stop-notes-control");
});

test("routes Zuri coach integration signals to the integration specialist", () => {
  const workflow = liveCardWorkflowFor("athletics_recruiting");
  const decision = deterministicSupervisorDecision({
    transcriptWindow: "I would love to provide an integration for coaches with Teamworks or Front Rush.",
    workflow,
    industryProfile: "athletics_recruiting"
  });

  assert.equal(decision.decision, "route");
  assert.deepEqual(normalizeRoutedAgentIds(decision, workflow), ["zuri_integration_draft"]);

  const specialist = workflow.specialists.find((candidate) => candidate.id === "zuri_integration_draft");
  assert.ok(specialist);
  const candidate = deterministicSpecialistCandidate({
    transcriptWindow: "I would love to provide an integration for coaches with Teamworks or Front Rush.",
    specialist,
    sourceSegmentIds: ["segment-2"]
  });

  assert.equal(candidate.emit, true);
  assert.equal(candidate.title, "Confirm recruiting system");
  assert.equal(candidate.dedupeKey, "zuri:integration-system-of-record");
});

test("routes Maya property-management calls to Buildium setup when not connected", () => {
  const workflow = liveCardWorkflowFor("real_estate_mortgage");
  const decision = deterministicSupervisorDecision({
    transcriptWindow: "Tenant in unit 4B says the dishwasher is leaking and we need a Buildium work order.",
    workflow,
    industryProfile: "real_estate_mortgage"
  });

  assert.equal(decision.decision, "route");
  assert.deepEqual(normalizeRoutedAgentIds(decision, workflow), ["maya_maintenance_triage", "maya_property_integration_draft"]);

  const specialist = workflow.specialists.find((candidate) => candidate.id === "maya_property_integration_draft");
  assert.ok(specialist);
  const candidate = deterministicSpecialistCandidate({
    transcriptWindow: "Tenant in unit 4B says the dishwasher is leaking and we need a Buildium work order.",
    specialist,
    sourceSegmentIds: ["segment-3"],
    integrations: [{ id: "buildium", label: "Buildium", status: "available", connection: null }]
  });

  assert.equal(candidate.emit, true);
  assert.equal(candidate.cardAction?.type, "integration_setup");
  assert.equal(candidate.cardAction?.integrationId, "buildium");
  assert.equal(candidate.integrationActionDraft, undefined);
});

test("emits a Buildium draft card when Buildium is connected", () => {
  const workflow = liveCardWorkflowFor("real_estate_mortgage");
  const specialist = workflow.specialists.find((candidate) => candidate.id === "maya_property_integration_draft");
  assert.ok(specialist);

  const candidate = deterministicSpecialistCandidate({
    transcriptWindow: "Tenant in unit 4B says the dishwasher is leaking and we need a maintenance work order.",
    specialist,
    sourceSegmentIds: ["segment-4"],
    integrations: [{
      id: "buildium",
      label: "Buildium",
      status: "available",
      connection: { _id: "connection-1", status: "active", hasCredentials: true }
    }]
  });

  assert.equal(candidate.emit, true);
  assert.equal(candidate.cardAction?.type, "integration_draft");
  assert.equal(candidate.integrationActionDraft?.integrationId, "buildium");
  assert.equal(candidate.integrationActionDraft?.actionType, "maintenance_work_order");
});

test("does not suggest Buildium for realtor transaction terms", () => {
  const workflow = liveCardWorkflowFor("real_estate_mortgage");
  const decision = deterministicSupervisorDecision({
    transcriptWindow: "The buyer wants to keep the appraisal contingency but can move the inspection deadline to Friday.",
    workflow,
    industryProfile: "real_estate_mortgage"
  });

  assert.equal(decision.decision, "route");
  assert.deepEqual(normalizeRoutedAgentIds(decision, workflow), ["maya_transaction_terms"]);
});

test("routes oil and gas calls to land-term and follow-up specialists", () => {
  const workflow = liveCardWorkflowFor("oil_and_gas_landmen");
  const decision = deterministicSupervisorDecision({
    transcriptWindow: "She said she would take four hundred an acre if we keep the royalty at twenty percent and get papers out by Friday.",
    workflow,
    industryProfile: "oil_and_gas_landmen"
  });

  assert.equal(decision.decision, "route");
  assert.deepEqual(normalizeRoutedAgentIds(decision, workflow), ["oil_land_terms", "oil_commitment_followup"]);

  const specialist = workflow.specialists.find((candidate) => candidate.id === "oil_land_terms");
  assert.ok(specialist);
  const candidate = deterministicSpecialistCandidate({
    transcriptWindow: "She said she would take four hundred an acre if we keep the royalty at twenty percent and get papers out by Friday.",
    specialist,
    sourceSegmentIds: ["segment-5"]
  });

  assert.equal(candidate.emit, true);
  assert.equal(candidate.title, "Confirm land terms");
  assert.equal(candidate.dedupeKey, "oil:land-terms");
});

test("routes freight brokerage calls to rate and load-spec specialists", () => {
  const workflow = liveCardWorkflowFor("freight_brokerage");
  const decision = deterministicSupervisorDecision({
    transcriptWindow: "Carrier can do Dallas to Atlanta for twenty-five hundred all in, pickup at 2pm, dry van, forty-two thousand pounds.",
    workflow,
    industryProfile: "freight_brokerage"
  });

  assert.equal(decision.decision, "route");
  assert.deepEqual(normalizeRoutedAgentIds(decision, workflow), ["freight_rate_commitment", "freight_load_specs"]);

  const specialist = workflow.specialists.find((candidate) => candidate.id === "freight_rate_commitment");
  assert.ok(specialist);
  const candidate = deterministicSpecialistCandidate({
    transcriptWindow: "Carrier can do Dallas to Atlanta for twenty-five hundred all in, pickup at 2pm, dry van, forty-two thousand pounds.",
    specialist,
    sourceSegmentIds: ["segment-6"]
  });

  assert.equal(candidate.emit, true);
  assert.equal(candidate.title, "Confirm freight rate");
  assert.equal(candidate.dedupeKey, "freight:rate-commitment");
});

test("normalization rejects unknown integrations and unsafe direct-write actions", () => {
  const unknown = normalizeCandidate({
    emit: true,
    title: "Bad integration",
    body: "Bad integration",
    reason: "Bad integration",
    priority: "normal",
    confidence: 0.9,
    sourceSegmentIds: [],
    sourceUrls: [],
    cardAction: { type: "integration_setup", integrationId: "not_real", label: "Connect", href: "/integrations" },
    integrationActionDraft: null,
    skipReason: null
  });
  assert.equal(unknown.cardAction, undefined);

  const unsafe = normalizeCandidate({
    emit: true,
    title: "Unsafe",
    body: "Unsafe",
    reason: "Unsafe",
    priority: "normal",
    confidence: 0.9,
    sourceSegmentIds: [],
    sourceUrls: [],
    cardAction: null,
    integrationActionDraft: {
      integrationId: "buildium",
      actionType: "direct_write_delete",
      title: "Unsafe",
      summary: "Unsafe",
      payloadJson: "{}"
    },
    skipReason: null
  });
  assert.equal(unsafe.integrationActionDraft, undefined);
});
