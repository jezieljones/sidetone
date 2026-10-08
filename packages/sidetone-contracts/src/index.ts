export type EntityType =
  | "person"
  | "business"
  | "team"
  | "case"
  | "deal"
  | "workflow"
  | "organization";

export type EntityStatus = "draft" | "active" | "paused" | "archived";

export type RiskClass = "standard" | "regulated" | "sensitive";

export type SidetonePlanTier = "free" | "smooth_operator" | "premier_pro" | "teams";

export type SidetoneBillablePlanTier = "free" | "smooth_operator" | "premier_pro";

export type SidetoneSubscriptionStatus =
  | "free"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid"
  | "paused";

export const sidetoneBillingPlans = {
  free: {
    label: "Free",
    monthlyPhoneMinutes: 100,
    monthlyPriceUsd: 0,
    phoneOverageCents: null,
    callIntelligence: false,
    overageEligible: false
  },
  smooth_operator: {
    label: "Smooth Operator",
    monthlyPhoneMinutes: 1000,
    monthlyPriceUsd: 14,
    phoneOverageCents: 10,
    callIntelligence: true,
    overageEligible: true
  },
  premier_pro: {
    label: "Premier Pro",
    monthlyPhoneMinutes: 2500,
    monthlyPriceUsd: 29,
    phoneOverageCents: 6,
    callIntelligence: true,
    overageEligible: true
  }
} as const satisfies Record<SidetoneBillablePlanTier, {
  label: string;
  monthlyPhoneMinutes: number;
  monthlyPriceUsd: number;
  phoneOverageCents: number | null;
  callIntelligence: boolean;
  overageEligible: boolean;
}>;

export const sidetoneTrialDays = 7;
export const sidetoneTrialPlan = "smooth_operator" as const;
export const sidetoneUsageWarningMinutes = 30;
export const sidetoneUsageGraceMinutes = 30;

export function sidetonePlanFromPricingSlug(slug?: string | null): "smooth_operator" | "premier_pro" | null {
  if (slug === "smooth-operator" || slug === "smooth_operator") {
    return "smooth_operator";
  }
  if (slug === "premier-pro" || slug === "premier_pro") {
    return "premier_pro";
  }
  return null;
}

export function sidetonePricingSlug(plan: "smooth_operator" | "premier_pro") {
  return plan === "smooth_operator" ? "smooth-operator" : "premier-pro";
}

export const sidetoneProductVocabulary = {
  suite: "Call Intelligence",
  cards: "Live signals",
  focus: "Listen For",
  docs: "Call Docs",
  contacts: "Contacts",
  entities: "Entities",
  tags: "Tags"
} as const;

export const sidetoneEntitlements = {
  free: {
    callRecords: true,
    contacts: true,
    tags: true,
    callDocs: false,
    callIntelligence: false,
    conversationCards: false,
    selectedCallQa: false
  },
  smooth_operator: {
    callRecords: true,
    contacts: true,
    tags: true,
    callDocs: true,
    callIntelligence: true,
    conversationCards: true,
    selectedCallQa: true
  },
  premier_pro: {
    callRecords: true,
    contacts: true,
    tags: true,
    callDocs: true,
    callIntelligence: true,
    conversationCards: true,
    selectedCallQa: true
  },
  teams: {
    callRecords: true,
    contacts: true,
    tags: true,
    callDocs: true,
    callIntelligence: true,
    conversationCards: true,
    selectedCallQa: true
  }
} as const satisfies Record<SidetonePlanTier, Record<string, boolean>>;

export function hasCallIntelligenceAccess(planTier?: SidetonePlanTier | null) {
  return sidetoneEntitlements[planTier ?? "free"].callIntelligence;
}

export const coachModeIds = [
  "just_notes",
  "close_the_deal",
  "negotiate",
  "sense_check",
  "support",
  "charm"
] as const;

export type CoachMode = typeof coachModeIds[number];
export type TuningMode = Exclude<CoachMode, "just_notes">;

export const industryProfileIds = [
  "general",
  "real_estate_mortgage",
  "recruiting_sourcing",
  "sales_founders_operators",
  "legal_client_services",
  "insurance_financial_services",
  "healthcare_sensitive",
  "athletics_recruiting",
  "oil_and_gas_landmen",
  "freight_brokerage"
] as const;

export type IndustryProfileId = typeof industryProfileIds[number];

export const sidetoneIntegrationIds = [
  "buildium",
  "rentvine",
  "doorloop",
  "appfolio",
  "rent_manager",
  "property_meld",
  "yardi_breeze"
] as const;

export type SidetoneIntegrationId = typeof sidetoneIntegrationIds[number];
export type SidetoneIntegrationStatus = "available" | "setup_only" | "unavailable";
export type SidetoneIntegrationConnectionType = "api" | "browser" | "apify" | "e2b" | "manual";
export type SidetoneIntegrationCapability =
  | "record_lookup"
  | "tenant_note_draft"
  | "owner_note_draft"
  | "association_owner_note_draft"
  | "maintenance_work_order_draft"
  | "maintenance_contact_request_draft"
  | "entity_match_cache";
export type SidetoneIntegrationRequiredField = {
  id: string;
  label: string;
  kind: "text" | "password" | "select";
  required: boolean;
  secret?: boolean;
  options?: readonly string[];
};
export type SidetoneIntegrationDescriptor = {
  id: SidetoneIntegrationId;
  label: string;
  description: string;
  personaIds: readonly IndustryProfileId[];
  audienceTags: readonly string[];
  connectionType: SidetoneIntegrationConnectionType;
  capabilities: readonly SidetoneIntegrationCapability[];
  writePolicy: LiveCardToolWritePolicy;
  requiredFields: readonly SidetoneIntegrationRequiredField[];
  setupGuide: readonly string[];
  status: SidetoneIntegrationStatus;
};

export type LiveCardKind = "focus_hit" | "clarify" | "memory" | "risk" | "web_context";
export type LiveCardToolWritePolicy = "read_only" | "draft_only" | "approval_required";

export type SidetoneLiveCardToolDescriptor = {
  id: string;
  label: string;
  description: string;
  connectionType: SidetoneIntegrationConnectionType;
  writePolicy: LiveCardToolWritePolicy;
  integrationId?: SidetoneIntegrationId;
  capabilities?: readonly SidetoneIntegrationCapability[];
};

export type SidetoneLiveCardSpecialist = {
  id: string;
  label: string;
  description: string;
  instructions: string;
  allowedToolIds: readonly string[];
};

export type SidetoneLiveCardExample = {
  transcript: string;
  expectedRoute: readonly string[];
  expectedSignal: string;
};

export type SidetoneLiveCardWorkflow = {
  version: string;
  supervisorPrompt: string;
  specialists: readonly SidetoneLiveCardSpecialist[];
  tools: readonly SidetoneLiveCardToolDescriptor[];
  emitPolicy: {
    maxActiveCards: number;
    maxSpecialistsPerWindow: number;
    minConfidence: number;
    cooldownMs: number;
  };
  examples: readonly SidetoneLiveCardExample[];
};

export type SidetonePromptProfile = {
  id: IndustryProfileId;
  label: string;
  shortLabel: string;
  personaName: string;
  suggestedTuningMode?: TuningMode;
  prompt: string;
  postCallFocus: readonly string[];
  liveFocus: readonly string[];
  mcpServers: readonly string[];
  liveCardWorkflow: SidetoneLiveCardWorkflow;
};

export type SidetoneCoachLensPrompt = {
  id: CoachMode;
  label: string;
  prompt: string;
  liveBehavior: string;
  postCallBehavior: string;
};

export const sidetoneIntegrationDescriptors = [
  {
    id: "buildium",
    label: "Buildium",
    description: "Draft tenant notes, owner notes, maintenance work orders, and contact requests for property-management calls.",
    personaIds: ["real_estate_mortgage"],
    audienceTags: ["property_manager", "community_manager", "rental_operations"],
    connectionType: "api",
    capabilities: [
      "record_lookup",
      "tenant_note_draft",
      "owner_note_draft",
      "association_owner_note_draft",
      "maintenance_work_order_draft",
      "maintenance_contact_request_draft",
      "entity_match_cache"
    ],
    writePolicy: "approval_required",
    requiredFields: [
      { id: "environment", label: "Environment", kind: "select", required: true, options: ["production", "sandbox"] },
      { id: "clientId", label: "Client ID", kind: "text", required: true },
      { id: "clientSecret", label: "Client secret", kind: "password", required: true, secret: true }
    ],
    setupGuide: [
      "Enable Buildium Open API in Application settings.",
      "Create an API key from Developer Tools with rental, tenant, owner, association, and maintenance access.",
      "Paste the client ID and secret into Sidetone Integrations."
    ],
    status: "available"
  },
  {
    id: "rentvine",
    label: "Rentvine",
    description: "Property-management system for portfolios that need future note, maintenance, and record lookup actions.",
    personaIds: ["real_estate_mortgage"],
    audienceTags: ["property_manager", "rental_operations"],
    connectionType: "api",
    capabilities: ["record_lookup", "tenant_note_draft", "maintenance_work_order_draft"],
    writePolicy: "approval_required",
    requiredFields: [],
    setupGuide: ["Capture the user's Rentvine system-of-record need before implementing credentials."],
    status: "setup_only"
  },
  {
    id: "doorloop",
    label: "DoorLoop",
    description: "Property-management system for future tenant, owner, and maintenance workflow drafts.",
    personaIds: ["real_estate_mortgage"],
    audienceTags: ["property_manager", "rental_operations"],
    connectionType: "api",
    capabilities: ["record_lookup", "tenant_note_draft", "owner_note_draft", "maintenance_work_order_draft"],
    writePolicy: "approval_required",
    requiredFields: [],
    setupGuide: ["Capture the user's DoorLoop workflow and API access requirements before implementation."],
    status: "setup_only"
  },
  {
    id: "appfolio",
    label: "AppFolio",
    description: "Property-management system that likely requires partner or approved integration access before deep writes.",
    personaIds: ["real_estate_mortgage"],
    audienceTags: ["property_manager", "rental_operations"],
    connectionType: "manual",
    capabilities: ["record_lookup", "tenant_note_draft", "owner_note_draft", "maintenance_work_order_draft"],
    writePolicy: "approval_required",
    requiredFields: [],
    setupGuide: ["Confirm partner access or browser-automation requirements before promising an AppFolio write path."],
    status: "setup_only"
  },
  {
    id: "rent_manager",
    label: "Rent Manager",
    description: "Property-management system for future tenant notes, service issues, and owner communication drafts.",
    personaIds: ["real_estate_mortgage"],
    audienceTags: ["property_manager", "rental_operations"],
    connectionType: "api",
    capabilities: ["record_lookup", "tenant_note_draft", "owner_note_draft", "maintenance_work_order_draft"],
    writePolicy: "approval_required",
    requiredFields: [],
    setupGuide: ["Confirm the customer's Rent Manager API access and target workflows before implementation."],
    status: "setup_only"
  },
  {
    id: "property_meld",
    label: "Property Meld",
    description: "Maintenance coordination system for future repair, vendor, and tenant update draft actions.",
    personaIds: ["real_estate_mortgage"],
    audienceTags: ["property_manager", "maintenance_coordinator"],
    connectionType: "api",
    capabilities: ["maintenance_work_order_draft", "maintenance_contact_request_draft"],
    writePolicy: "approval_required",
    requiredFields: [],
    setupGuide: ["Use when the call is specifically about maintenance coordination rather than the full property record."],
    status: "setup_only"
  },
  {
    id: "yardi_breeze",
    label: "Yardi Breeze",
    description: "Property-management system for future resident, owner, and maintenance workflow drafts.",
    personaIds: ["real_estate_mortgage"],
    audienceTags: ["property_manager", "rental_operations"],
    connectionType: "manual",
    capabilities: ["record_lookup", "tenant_note_draft", "owner_note_draft", "maintenance_work_order_draft"],
    writePolicy: "approval_required",
    requiredFields: [],
    setupGuide: ["Confirm available Yardi integration access or browser-automation feasibility before implementation."],
    status: "setup_only"
  }
] as const satisfies readonly SidetoneIntegrationDescriptor[];

const integrationDescriptorById = sidetoneIntegrationDescriptors.reduce((descriptorsById, descriptor) => {
  descriptorsById[descriptor.id] = descriptor;
  return descriptorsById;
}, {} as Record<SidetoneIntegrationId, SidetoneIntegrationDescriptor>);

export function isSidetoneIntegrationId(input: unknown): input is SidetoneIntegrationId {
  return typeof input === "string" && (sidetoneIntegrationIds as readonly string[]).includes(input);
}

export function integrationDescriptorFor(input?: string | null): SidetoneIntegrationDescriptor | undefined {
  return isSidetoneIntegrationId(input) ? integrationDescriptorById[input] : undefined;
}

export function integrationDescriptorsForPersona(input?: string | null): readonly SidetoneIntegrationDescriptor[] {
  const profileId = isIndustryProfileId(input) ? input : "general";
  return sidetoneIntegrationDescriptors.filter((descriptor) =>
    (descriptor.personaIds as readonly IndustryProfileId[]).includes(profileId)
  );
}

const genericLiveCardTools = [] as const satisfies readonly SidetoneLiveCardToolDescriptor[];

const zuriLiveCardTools = [
  {
    id: "teamworks_recruiting",
    label: "Teamworks Recruiting",
    description: "Read recruiting context and draft contact notes or follow-up tasks for athletics recruiting workflows.",
    connectionType: "api",
    writePolicy: "draft_only"
  },
  {
    id: "front_rush",
    label: "Front Rush",
    description: "Draft recruit contact logs, roster notes, tasks, and reminders for coaches using Front Rush.",
    connectionType: "browser",
    writePolicy: "draft_only"
  },
  {
    id: "ncsa_coach",
    label: "NCSA Coach",
    description: "Look up recruiting-platform context and draft athlete or parent follow-up actions.",
    connectionType: "browser",
    writePolicy: "draft_only"
  },
  {
    id: "coach_packet",
    label: "Coach Packet",
    description: "Draft profile, packet, or evaluation updates from a recruiting call.",
    connectionType: "browser",
    writePolicy: "draft_only"
  },
  {
    id: "eventbeacon",
    label: "EventBeacon",
    description: "Draft event, camp, showcase, and attendance follow-up tasks from a live call.",
    connectionType: "api",
    writePolicy: "draft_only"
  },
  {
    id: "sportsrecruits",
    label: "SportsRecruits",
    description: "Draft recruiting profile notes and communication follow-ups for SportsRecruits workflows.",
    connectionType: "api",
    writePolicy: "draft_only"
  }
] as const satisfies readonly SidetoneLiveCardToolDescriptor[];

const mayaLiveCardTools = [
  {
    id: "buildium",
    integrationId: "buildium",
    label: "Buildium",
    description: "Look up property-management context and draft tenant notes, owner notes, association owner notes, maintenance work orders, or contact requests.",
    connectionType: "api",
    writePolicy: "approval_required",
    capabilities: [
      "record_lookup",
      "tenant_note_draft",
      "owner_note_draft",
      "association_owner_note_draft",
      "maintenance_work_order_draft",
      "maintenance_contact_request_draft",
      "entity_match_cache"
    ]
  },
  {
    id: "rentvine",
    integrationId: "rentvine",
    label: "Rentvine",
    description: "Draft future property-management actions after the user's Rentvine workflow is confirmed.",
    connectionType: "api",
    writePolicy: "approval_required",
    capabilities: ["record_lookup", "tenant_note_draft", "maintenance_work_order_draft"]
  },
  {
    id: "doorloop",
    integrationId: "doorloop",
    label: "DoorLoop",
    description: "Draft future tenant, owner, and maintenance actions after DoorLoop connection requirements are confirmed.",
    connectionType: "api",
    writePolicy: "approval_required",
    capabilities: ["record_lookup", "tenant_note_draft", "owner_note_draft", "maintenance_work_order_draft"]
  },
  {
    id: "appfolio",
    integrationId: "appfolio",
    label: "AppFolio",
    description: "Identify AppFolio system-of-record needs and keep actions setup-gated until partner or browser access is available.",
    connectionType: "manual",
    writePolicy: "approval_required",
    capabilities: ["record_lookup", "tenant_note_draft", "owner_note_draft", "maintenance_work_order_draft"]
  },
  {
    id: "rent_manager",
    integrationId: "rent_manager",
    label: "Rent Manager",
    description: "Identify Rent Manager property-management drafts once API access and target workflows are confirmed.",
    connectionType: "api",
    writePolicy: "approval_required",
    capabilities: ["record_lookup", "tenant_note_draft", "owner_note_draft", "maintenance_work_order_draft"]
  },
  {
    id: "property_meld",
    integrationId: "property_meld",
    label: "Property Meld",
    description: "Draft future maintenance coordination actions for repair, vendor, and tenant follow-up workflows.",
    connectionType: "api",
    writePolicy: "approval_required",
    capabilities: ["maintenance_work_order_draft", "maintenance_contact_request_draft"]
  },
  {
    id: "yardi_breeze",
    integrationId: "yardi_breeze",
    label: "Yardi Breeze",
    description: "Identify Yardi Breeze property-management drafts once integration access is confirmed.",
    connectionType: "manual",
    writePolicy: "approval_required",
    capabilities: ["record_lookup", "tenant_note_draft", "owner_note_draft", "maintenance_work_order_draft"]
  }
] as const satisfies readonly SidetoneLiveCardToolDescriptor[];

const genericLiveCardSpecialists = [
  {
    id: "commitment_signal",
    label: "Commitment signal",
    description: "Detect concrete commitments, owners, dates, amounts, next steps, and unresolved details worth confirming.",
    instructions: "Emit only when the latest transcript window contains a specific commitment, amount, date, owner, risk, or ambiguity the user should notice now.",
    allowedToolIds: []
  },
  {
    id: "memory_signal",
    label: "Memory signal",
    description: "Detect reusable relationship or account memory that should be saved for future calls.",
    instructions: "Emit only when the latest transcript window reveals durable context, preference, constraint, or relationship detail that should be remembered later.",
    allowedToolIds: []
  }
] as const satisfies readonly SidetoneLiveCardSpecialist[];

const mayaLiveCardSpecialists = [
  {
    id: "maya_transaction_terms",
    label: "Transaction terms",
    description: "Detect real-estate or mortgage offers, concessions, contingencies, lender timing, inspection items, deadlines, and client preferences.",
    instructions: "Emit when a realtor, client, lender, title, or mortgage call contains a concrete offer term, concession, deadline, financing detail, inspection item, or preference worth confirming. Do not suggest property-management integrations unless the call is about tenants, owners, leases, rent, units, or maintenance.",
    allowedToolIds: []
  },
  {
    id: "maya_property_caller_matcher",
    label: "Tenant and owner matcher",
    description: "Detect caller identity, unit, property, lease, owner, tenant, and association details that should be linked to a property-management record.",
    instructions: "Emit when the call reveals durable property-management identity context: tenant name, owner name, unit, property, lease, phone, email, association, or a mismatch that should be resolved before filing notes.",
    allowedToolIds: ["buildium", "rentvine", "doorloop", "appfolio", "rent_manager", "yardi_breeze"]
  },
  {
    id: "maya_maintenance_triage",
    label: "Maintenance triage",
    description: "Detect repair issues, urgency, access instructions, vendors, approvals, photos, safety concerns, and tenant communication requirements.",
    instructions: "Emit when a property-management call contains a concrete maintenance issue, access detail, vendor commitment, owner approval, tenant update, or urgency signal. Do not diagnose repairs or give legal advice.",
    allowedToolIds: ["buildium", "property_meld", "rentvine", "doorloop", "appfolio", "rent_manager", "yardi_breeze"]
  },
  {
    id: "maya_lease_rent_memory",
    label: "Lease and rent memory",
    description: "Capture lease dates, rent amounts, payment promises, late fees, renewals, notices, move-in/out facts, and durable tenant preferences.",
    instructions: "Emit when the call includes specific lease, rent, payment, renewal, notice, occupancy, or move-in/move-out facts that should survive the call. Avoid giving legal, eviction, or accounting advice.",
    allowedToolIds: ["buildium", "rentvine", "doorloop", "appfolio", "rent_manager", "yardi_breeze"]
  },
  {
    id: "maya_owner_tenant_followup",
    label: "Owner and tenant follow-up",
    description: "Detect promised callbacks, documents, approvals, tenant notices, owner updates, vendor coordination, and task follow-ups.",
    instructions: "Emit when the property manager made or received a concrete promise, owner update, tenant notice, document request, callback, or vendor follow-up. Capture the owner, deadline, and target audience if present.",
    allowedToolIds: ["buildium", "rentvine", "doorloop", "appfolio", "rent_manager", "property_meld", "yardi_breeze"]
  },
  {
    id: "maya_sensitive_risk",
    label: "Sensitive property risk",
    description: "Spot possible habitability, fair housing, access, safety, deposit, eviction, payment-plan, or complaint risk that should be documented carefully.",
    instructions: "Emit only when the call raises a concrete property-management risk or missing fact that should be reviewed. Do not decide legal compliance, fair housing, eviction, habitability, or accounting outcomes.",
    allowedToolIds: []
  },
  {
    id: "maya_property_integration_draft",
    label: "Property integration draft",
    description: "Draft safe, approval-gated actions for the property-management system of record, or emit setup guidance when the needed system is not connected.",
    instructions: "Emit when the call implies a concrete draft action for Buildium, Rentvine, DoorLoop, AppFolio, Rent Manager, Property Meld, or Yardi Breeze. If the relevant system is not connected, emit a setup action instead of pretending to write. Buildium is the only implemented write-draft adapter in this pass.",
    allowedToolIds: ["buildium", "rentvine", "doorloop", "appfolio", "rent_manager", "property_meld", "yardi_breeze"]
  }
] as const satisfies readonly SidetoneLiveCardSpecialist[];

const zuriLiveCardSpecialists = [
  {
    id: "zuri_recruiting_contact_logger",
    label: "Recruiting contact logger",
    description: "Detect NCAA-sensitive recruiting contacts, call timing, who participated, and what was discussed.",
    instructions: "Emit when a coach should log contact with an athlete, parent, club coach, or staff member. Capture who, when, topic, and any follow-up without giving compliance advice.",
    allowedToolIds: ["teamworks_recruiting", "front_rush", "sportsrecruits"]
  },
  {
    id: "zuri_compliance_risk",
    label: "Compliance risk spotter",
    description: "Spot possible recruiting compliance risk, eligibility ambiguity, promises, benefits, or contact-timing issues.",
    instructions: "Emit only when the call raises a concrete recruiting-compliance concern or missing fact that should be reviewed by the user's compliance process. Do not decide legality.",
    allowedToolIds: ["teamworks_recruiting"]
  },
  {
    id: "zuri_recruit_memory",
    label: "Recruit memory",
    description: "Capture durable athlete, parent, coach, school, academic, position, preference, and relationship memory.",
    instructions: "Emit when the latest transcript window includes athlete context, family context, preferences, schedule constraints, academic details, or relationship details that should survive the call.",
    allowedToolIds: ["front_rush", "ncsa_coach", "sportsrecruits"]
  },
  {
    id: "zuri_schedule_followup",
    label: "Schedule and camp follow-up",
    description: "Detect camp, showcase, visit, roster, evaluation, travel, or callback follow-up that needs action.",
    instructions: "Emit when the coach should confirm a date, event, visit, camp, evaluation, callback, or document follow-up from this call.",
    allowedToolIds: ["eventbeacon", "coach_packet", "sportsrecruits"]
  },
  {
    id: "zuri_integration_draft",
    label: "Recruiting integration draft",
    description: "Draft safe tool actions for the recruiting system of record without writing externally.",
    instructions: "Emit when the call implies a concrete draft action for Teamworks, Front Rush, NCSA Coach, Coach Packet, EventBeacon, or SportsRecruits. If the system is unknown or not connected, ask which system of record matters.",
    allowedToolIds: ["teamworks_recruiting", "front_rush", "ncsa_coach", "coach_packet", "eventbeacon", "sportsrecruits"]
  }
] as const satisfies readonly SidetoneLiveCardSpecialist[];

const oilAndGasLiveCardSpecialists = [
  {
    id: "oil_land_terms",
    label: "Land terms",
    description: "Detect lease bonus, royalty, acreage, tract, county, depth, option, extension, and title details from land calls.",
    instructions: "Emit when a landowner, broker, operator, or landman states a concrete lease, royalty, acreage, legal description, county, tract, depth, payment, option, extension, or title detail that should be confirmed before it becomes disputed.",
    allowedToolIds: []
  },
  {
    id: "oil_owner_memory",
    label: "Owner memory",
    description: "Capture durable mineral-owner, surface-owner, family, heirship, preference, and negotiation context.",
    instructions: "Emit when the call reveals durable owner context: who controls minerals, family relationships, probate or heirship references, decision makers, preferred contact path, motivation, hesitation, or a detail that affects future trust. Do not give legal, tax, or title advice.",
    allowedToolIds: []
  },
  {
    id: "oil_title_due_diligence",
    label: "Title due diligence",
    description: "Spot missing documents, ownership ambiguity, competing interests, courthouse follow-up, and curative questions.",
    instructions: "Emit only when the transcript contains a concrete title, ownership, heirship, deed, probate, abstract, prior lease, curative, or document issue that needs follow-up. Phrase it as documentation to verify, not a legal conclusion.",
    allowedToolIds: []
  },
  {
    id: "oil_commitment_followup",
    label: "Commitment follow-up",
    description: "Detect verbal offers, accepted terms, promised callbacks, document sends, payment timing, and next-step ownership.",
    instructions: "Emit when either side makes a specific promise, verbal offer, acceptance, callback, document request, or payment/timing commitment. Capture amount, deadline, owner, and open condition if present.",
    allowedToolIds: []
  }
] as const satisfies readonly SidetoneLiveCardSpecialist[];

const freightLiveCardSpecialists = [
  {
    id: "freight_rate_commitment",
    label: "Rate commitment",
    description: "Detect carrier/customer rate quotes, RPM, accessorials, detention, layover, lumper, and verbal commitments.",
    instructions: "Emit when a broker, carrier, dispatcher, or shipper states a concrete rate, per-mile figure, accessorial, detention, layover, lumper, fuel, or payment commitment that should be confirmed before dispatch.",
    allowedToolIds: []
  },
  {
    id: "freight_load_specs",
    label: "Load specs",
    description: "Capture lane, pickup/drop, appointment windows, equipment, weight, commodity, temperature, and special instructions.",
    instructions: "Emit when the call contains specific load facts: origin, destination, appointment, equipment type, trailer requirement, weight, commodity, temperature, reference number, facility instruction, or special handling requirement.",
    allowedToolIds: []
  },
  {
    id: "freight_carrier_memory",
    label: "Carrier memory",
    description: "Capture durable carrier, dispatcher, driver, lane preference, reliability, relationship, and objection context.",
    instructions: "Emit when the call reveals reusable carrier or customer context: preferred lanes, equipment constraints, reliability notes, dispatcher behavior, objection patterns, driver details, or communication preferences.",
    allowedToolIds: []
  },
  {
    id: "freight_exception_followup",
    label: "Exception follow-up",
    description: "Spot late pickup/delivery risk, claims, reconsignment, cancellation, check-call gaps, and escalation needs.",
    instructions: "Emit only when there is a concrete exception or risk: missed appointment, late truck, cargo issue, claim, rejected load, detention dispute, reconsignment, cancellation, or check-call commitment. Do not invent severity.",
    allowedToolIds: []
  }
] as const satisfies readonly SidetoneLiveCardSpecialist[];

const genericLiveCardWorkflow = {
  version: "live-card-generic-v1",
  supervisorPrompt: [
    "You are Sidetone's live-card supervisor.",
    "Decide whether the latest transcript window deserves a private Live signal card.",
    "Prefer skipping. Route only when a specialist can help with a concrete, timely signal.",
    "Never summarize the call. Never emit generic coaching advice.",
    "Ignore Sidetone onboarding, recording disclosure, filler, and product-testing chatter unless it contains a concrete product issue the owner asked to remember."
  ].join(" "),
  specialists: genericLiveCardSpecialists,
  tools: genericLiveCardTools,
  emitPolicy: {
    maxActiveCards: 3,
    maxSpecialistsPerWindow: 2,
    minConfidence: 0.64,
    cooldownMs: 90_000
  },
  examples: [
    {
      transcript: "Can you send the revised agreement by Friday and copy Maya?",
      expectedRoute: ["commitment_signal"],
      expectedSignal: "Confirm Friday agreement follow-up and owner."
    },
    {
      transcript: "Welcome to Sidetone. In your phone app, tap add call, then merge calls.",
      expectedRoute: [],
      expectedSignal: "Skip Sidetone onboarding audio."
    }
  ]
} as const satisfies SidetoneLiveCardWorkflow;

const mayaLiveCardWorkflow = {
  version: "live-card-maya-real-estate-v1",
  supervisorPrompt: [
    "You are Maya's live-card supervisor for real estate, mortgage, and property-management calls.",
    "Route only when the transcript contains a concrete transaction term, lender/title deadline, client preference, tenant/owner identity, lease/rent fact, maintenance issue, property risk, follow-up, or system-of-record draft action.",
    "Keep realtor and mortgage calls useful without pushing property-management integrations into calls that are only about buyers, sellers, offers, inspections, appraisal, title, or lending.",
    "Only route to property-management integration specialists when the call is about tenants, owners, units, leases, rent, associations, maintenance, vendors, or an explicit property-management system.",
    "Do not provide legal, eviction, fair-housing, habitability, accounting, mortgage, or investment advice."
  ].join(" "),
  specialists: mayaLiveCardSpecialists,
  tools: mayaLiveCardTools,
  emitPolicy: {
    maxActiveCards: 3,
    maxSpecialistsPerWindow: 2,
    minConfidence: 0.68,
    cooldownMs: 90_000
  },
  examples: [
    {
      transcript: "Tenant in unit 4B says the dishwasher is leaking and the owner approved a plumber up to $350.",
      expectedRoute: ["maya_maintenance_triage", "maya_property_integration_draft"],
      expectedSignal: "Draft a maintenance action and capture the unit, issue, owner approval, and spend cap."
    },
    {
      transcript: "The buyer wants to keep the appraisal contingency but can move the inspection deadline to Friday.",
      expectedRoute: ["maya_transaction_terms"],
      expectedSignal: "Capture appraisal contingency and Friday inspection deadline without suggesting Buildium."
    },
    {
      transcript: "They use Buildium, but I have not connected it yet. Make sure this call gets into the tenant record.",
      expectedRoute: ["maya_property_caller_matcher", "maya_property_integration_draft"],
      expectedSignal: "Emit a Buildium setup signal before any tenant-record draft can be written."
    }
  ]
} as const satisfies SidetoneLiveCardWorkflow;

const zuriLiveCardWorkflow = {
  version: "live-card-zuri-athletics-v1",
  supervisorPrompt: [
    "You are Zuri's live-card supervisor for athletics recruiting calls.",
    "Route only when the call contains a concrete recruiting contact, compliance-sensitive ambiguity, athlete memory, schedule follow-up, or system-of-record draft action.",
    "Preserve relationship warmth, but do not emit vague encouragement.",
    "Do not provide NCAA, legal, eligibility, scholarship, medical, or financial advice.",
    "If an integration target is mentioned but the system of record is unclear, route to the integration draft specialist to ask which system matters."
  ].join(" "),
  specialists: zuriLiveCardSpecialists,
  tools: zuriLiveCardTools,
  emitPolicy: {
    maxActiveCards: 3,
    maxSpecialistsPerWindow: 2,
    minConfidence: 0.68,
    cooldownMs: 90_000
  },
  examples: [
    {
      transcript: "I want an integration for coaches, maybe Teamworks or Front Rush, but I cannot think of what to do.",
      expectedRoute: ["zuri_integration_draft"],
      expectedSignal: "Ask which recruiting system of record the coach uses before drafting an action."
    },
    {
      transcript: "Her ACT is next month, she plays center back, and her parents can visit during the July camp.",
      expectedRoute: ["zuri_recruit_memory", "zuri_schedule_followup"],
      expectedSignal: "Save athlete academics, position, parent availability, and July camp follow-up."
    }
  ]
} as const satisfies SidetoneLiveCardWorkflow;

const oilAndGasLiveCardWorkflow = {
  version: "live-card-oil-gas-landmen-v1",
  supervisorPrompt: [
    "You are Tessa's live-card supervisor for oil and gas land calls.",
    "Route only when the transcript contains a concrete lease term, royalty, acreage, legal description, title/document issue, mineral-owner memory, verbal offer, commitment, or due-diligence follow-up.",
    "Prefer precise factual capture over coaching. Do not provide legal, tax, title, mineral valuation, or investment advice.",
    "Skip broad industry chatter, filler, and generic product testing unless it contains a concrete issue the user asked to remember."
  ].join(" "),
  specialists: oilAndGasLiveCardSpecialists,
  tools: genericLiveCardTools,
  emitPolicy: {
    maxActiveCards: 3,
    maxSpecialistsPerWindow: 2,
    minConfidence: 0.7,
    cooldownMs: 90_000
  },
  examples: [
    {
      transcript: "She said she would take four hundred an acre if we keep the royalty at twenty percent and get papers out by Friday.",
      expectedRoute: ["oil_land_terms", "oil_commitment_followup"],
      expectedSignal: "Capture $400/acre, 20% royalty, and Friday document follow-up."
    },
    {
      transcript: "He thinks his sister still owns half of the minerals because of their dad's probate, but he has not found the deed.",
      expectedRoute: ["oil_owner_memory", "oil_title_due_diligence"],
      expectedSignal: "Flag sibling ownership and missing deed/probate follow-up without making a title conclusion."
    }
  ]
} as const satisfies SidetoneLiveCardWorkflow;

const freightLiveCardWorkflow = {
  version: "live-card-freight-brokerage-v1",
  supervisorPrompt: [
    "You are Miles's live-card supervisor for freight brokerage calls.",
    "Route only when the transcript contains a concrete rate, load spec, lane, appointment, equipment need, carrier/customer commitment, accessorial, exception, or relationship memory.",
    "Prioritize facts that would cost money if forgotten. Do not provide legal, insurance, safety, customs, or financial advice.",
    "Skip generic logistics chatter unless it changes a rate, commitment, load fact, risk, or follow-up."
  ].join(" "),
  specialists: freightLiveCardSpecialists,
  tools: genericLiveCardTools,
  emitPolicy: {
    maxActiveCards: 3,
    maxSpecialistsPerWindow: 2,
    minConfidence: 0.7,
    cooldownMs: 75_000
  },
  examples: [
    {
      transcript: "Carrier said he can do Dallas to Atlanta for twenty-five hundred all in, pickup at 2pm, dry van, forty-two thousand pounds.",
      expectedRoute: ["freight_rate_commitment", "freight_load_specs"],
      expectedSignal: "Confirm $2,500 all-in rate, Dallas to Atlanta lane, 2pm pickup, dry van, and 42k lbs."
    },
    {
      transcript: "If the shipper keeps him waiting past four, he wants detention after two free hours and a check call by noon.",
      expectedRoute: ["freight_rate_commitment", "freight_exception_followup"],
      expectedSignal: "Capture detention terms and noon check-call commitment."
    }
  ]
} as const satisfies SidetoneLiveCardWorkflow;

export const industryProfiles = [
  {
    id: "general",
    label: "General",
    shortLabel: "General",
    personaName: "Rowan",
    prompt: "This is a general professional phone call. Capture decisions, asks, owners, dates, next steps, and any personal or business details that should become useful memory.",
    postCallFocus: ["decisions", "asks", "owners", "dates", "next steps", "useful memory"],
    liveFocus: ["confirm the detail", "name the owner", "make the next step explicit"],
    mcpServers: [],
    liveCardWorkflow: genericLiveCardWorkflow
  },
  {
    id: "real_estate_mortgage",
    label: "Real estate and mortgage",
    shortLabel: "Real estate",
    personaName: "Maya",
    suggestedTuningMode: "negotiate",
    prompt: "This is a real estate or mortgage phone call. Track offers, concessions, comps, inspections, lender timing, deadlines, client preferences, and tradeoffs without flattening the relationship.",
    postCallFocus: ["offers", "concessions", "comps", "inspection items", "lender timing", "deadlines"],
    liveFocus: ["clarify concessions", "confirm timing", "separate preferences from terms"],
    mcpServers: [],
    liveCardWorkflow: mayaLiveCardWorkflow
  },
  {
    id: "recruiting_sourcing",
    label: "Recruiting and sourcing",
    shortLabel: "Recruiting",
    personaName: "Reese",
    suggestedTuningMode: "sense_check",
    prompt: "This is a recruiting or sourcing phone call. Track candidate motivators, constraints, compensation, availability, objections, fit signals, and questions that need to go back to the hiring manager.",
    postCallFocus: ["motivators", "constraints", "compensation", "availability", "objections", "hiring-manager questions"],
    liveFocus: ["separate signal from assumption", "clarify comp and timing", "name open fit questions"],
    mcpServers: [],
    liveCardWorkflow: genericLiveCardWorkflow
  },
  {
    id: "sales_founders_operators",
    label: "Sales, founders, and operators",
    shortLabel: "Sales and operators",
    personaName: "Omar",
    suggestedTuningMode: "close_the_deal",
    prompt: "This is a sales, founder, consultant, or operator phone call. Track readiness, friction, stakeholders, decision path, objections, promised follow-up, and the next commitment.",
    postCallFocus: ["readiness", "friction", "stakeholders", "decision path", "objections", "next commitment"],
    liveFocus: ["name the next commitment", "clarify the blocker", "surface the decision path"],
    mcpServers: [],
    liveCardWorkflow: genericLiveCardWorkflow
  },
  {
    id: "legal_client_services",
    label: "Legal and client services",
    shortLabel: "Legal/client",
    personaName: "Imani",
    suggestedTuningMode: "sense_check",
    prompt: "This is a legal or client-services phone call. Track intake facts, dates, terms, risks, documents, promises, and follow-up ownership. Do not give legal advice or imply legal conclusions.",
    postCallFocus: ["intake facts", "dates", "terms", "risks", "documents", "promises"],
    liveFocus: ["confirm facts", "avoid conclusions", "flag missing documents or dates"],
    mcpServers: [],
    liveCardWorkflow: genericLiveCardWorkflow
  },
  {
    id: "insurance_financial_services",
    label: "Insurance and financial services",
    shortLabel: "Insurance",
    personaName: "Anya",
    suggestedTuningMode: "support",
    prompt: "This is an insurance or financial-services phone call. Track client details, family context, coverage questions, quotes, exclusions, renewals, disclosures, and follow-up promises. Do not give financial, legal, insurance, or coverage advice.",
    postCallFocus: ["client details", "coverage questions", "quotes", "exclusions", "renewals", "follow-up promises"],
    liveFocus: ["confirm coverage details", "name disclosures", "reflect client concern", "avoid advice"],
    mcpServers: [],
    liveCardWorkflow: genericLiveCardWorkflow
  },
  {
    id: "healthcare_sensitive",
    label: "Healthcare and sensitive",
    shortLabel: "Healthcare",
    personaName: "Elena",
    suggestedTuningMode: "support",
    prompt: "This is a healthcare, benefits, or sensitive-support phone call. Track concerns, care details, benefits questions, handoffs, reassurance, and follow-up needs. Do not give medical advice or clinical recommendations.",
    postCallFocus: ["concerns", "care details", "benefits questions", "handoffs", "reassurance", "follow-up needs"],
    liveFocus: ["reflect concern first", "confirm handoff details", "avoid medical advice"],
    mcpServers: [],
    liveCardWorkflow: genericLiveCardWorkflow
  },
  {
    id: "athletics_recruiting",
    label: "Athletics and high-touch recruiting",
    shortLabel: "Athletics",
    personaName: "Zuri",
    suggestedTuningMode: "charm",
    prompt: "This is an athletics, coaching, or high-touch recruiting phone call. Track parent, athlete, staff, and coach context; schedules; expectations; promises; preferences; and relationship memory.",
    postCallFocus: ["parent context", "athlete context", "staff context", "schedules", "expectations", "relationship memory"],
    liveFocus: ["preserve warmth", "remember personal detail", "confirm schedules and expectations"],
    mcpServers: [],
    liveCardWorkflow: zuriLiveCardWorkflow
  },
  {
    id: "oil_and_gas_landmen",
    label: "Oil and gas landmen",
    shortLabel: "Oil and gas",
    personaName: "Tessa",
    suggestedTuningMode: "sense_check",
    prompt: "This is an oil and gas land, mineral, lease, or acquisition phone call. Track royalty, acreage, lease bonus, tract, county, owner identity, verbal offers, title follow-up, document needs, and relationship context. Do not give legal, tax, title, valuation, or investment advice.",
    postCallFocus: ["royalty", "acreage", "lease bonus", "tract and county", "owner identity", "verbal offers", "title follow-up", "document needs"],
    liveFocus: ["confirm acreage and royalty", "capture verbal offers", "flag title documents to verify"],
    mcpServers: [],
    liveCardWorkflow: oilAndGasLiveCardWorkflow
  },
  {
    id: "freight_brokerage",
    label: "Freight brokerage",
    shortLabel: "Freight",
    personaName: "Miles",
    suggestedTuningMode: "close_the_deal",
    prompt: "This is a freight brokerage, carrier, dispatcher, shipper, or logistics phone call. Track rates, lanes, load specs, equipment, pickup/drop times, accessorials, carrier commitments, exceptions, check calls, and customer follow-up.",
    postCallFocus: ["rates", "lanes", "load specs", "equipment", "pickup and drop times", "accessorials", "carrier commitments", "exceptions"],
    liveFocus: ["confirm rate and terms", "capture load specs", "name exception follow-up"],
    mcpServers: [],
    liveCardWorkflow: freightLiveCardWorkflow
  }
] as const satisfies readonly SidetonePromptProfile[];

export const coachLensPrompts = [
  {
    id: "just_notes",
    label: "Just notes",
    prompt: "Preserve the faithful record. Prioritize what should be remembered after the call over advice during the call.",
    liveBehavior: "When useful, prompt only to confirm details that should be written down.",
    postCallBehavior: "Produce a clean record with decisions, asks, dates, owners, open questions, and follow-up."
  },
  {
    id: "close_the_deal",
    label: "Close the deal",
    prompt: "Listen for readiness, friction, missing stakeholders, approval path, and whether the next commitment has been named.",
    liveBehavior: "Nudge toward a concrete commitment or next step before momentum fades.",
    postCallBehavior: "Make the decision path, blocker, commitment, and follow-up explicit."
  },
  {
    id: "negotiate",
    label: "Negotiate",
    prompt: "Clarify tradeoffs, concessions, constraints, timing, terms, and what each side is actually asking for.",
    liveBehavior: "Prompt the user to trade clearly, protect terms, and avoid vague concessions.",
    postCallBehavior: "Separate asks, concessions, constraints, counteroffers, and deadlines."
  },
  {
    id: "sense_check",
    label: "Sense-check me",
    prompt: "Separate facts from assumptions. Identify missing information, weak inferences, open questions, and next verification steps.",
    liveBehavior: "Prompt the user to verify assumptions and clarify ambiguous claims.",
    postCallBehavior: "Separate confirmed facts, assumptions, risks, and questions to verify."
  },
  {
    id: "support",
    label: "Support them",
    prompt: "Reflect concern before solving. Track what the other person needs, what they are worried about, and what reassurance or handoff was promised.",
    liveBehavior: "Prompt empathy, confirmation, and next support steps without overreaching.",
    postCallBehavior: "Summarize the concern, response, handoff, owner, and follow-up."
  },
  {
    id: "charm",
    label: "Charm",
    prompt: "Preserve warmth and personal detail. Track relationship context, preferences, small promises, and moments that make follow-up feel human.",
    liveBehavior: "Prompt specific warmth, callback details, and gracious next moves.",
    postCallBehavior: "Include relationship memory, personal details, commitments, and a warm follow-up draft."
  }
] as const satisfies readonly SidetoneCoachLensPrompt[];

const industryProfileById = industryProfiles.reduce((profilesById, profile) => {
  profilesById[profile.id] = profile;
  return profilesById;
}, {} as Record<IndustryProfileId, SidetonePromptProfile>);

const coachLensPromptById = coachLensPrompts.reduce((lensesById, lens) => {
  lensesById[lens.id] = lens;
  return lensesById;
}, {} as Record<CoachMode, SidetoneCoachLensPrompt>);

export function isCoachMode(input: unknown): input is CoachMode {
  return typeof input === "string" && (coachModeIds as readonly string[]).includes(input);
}

export function isTuningMode(input: unknown): input is TuningMode {
  return isCoachMode(input) && input !== "just_notes";
}

export function normalizeCoachMode(input?: string | null): CoachMode {
  return isCoachMode(input) ? input : "just_notes";
}

export function normalizeTuningMode(input?: string | null): TuningMode | undefined {
  return isTuningMode(input) ? input : undefined;
}

export function isIndustryProfileId(input: unknown): input is IndustryProfileId {
  return typeof input === "string" && (industryProfileIds as readonly string[]).includes(input);
}

export function normalizeIndustryProfileId(input?: string | null): IndustryProfileId {
  return isIndustryProfileId(input) ? input : "general";
}

export function industryProfileFor(input?: string | null): SidetonePromptProfile {
  return industryProfileById[normalizeIndustryProfileId(input)];
}

export function liveCardWorkflowFor(input?: string | null): SidetoneLiveCardWorkflow {
  return industryProfileFor(input).liveCardWorkflow;
}

export function coachLensPromptFor(input?: string | null): SidetoneCoachLensPrompt {
  return coachLensPromptById[normalizeCoachMode(input)];
}

export function buildSidetonePromptContext(input: {
  industryProfile?: string | null;
  coachMode?: string | null;
}) {
  const profile = industryProfileFor(input.industryProfile);
  const tuningMode = normalizeTuningMode(input.coachMode);
  const lens = tuningMode ? coachLensPromptFor(tuningMode) : undefined;

  const context = [
    `Industry profile: ${profile.label}`,
    `Industry context: ${profile.prompt}`,
    `Industry post-call focus: ${profile.postCallFocus.join(", ")}`,
    `Industry live focus: ${profile.liveFocus.join(", ")}`
  ];

  if (lens) {
    context.push(
      `Coach lens: ${lens.label}`,
      `Coach behavior: ${lens.prompt}`,
      `Live card behavior: ${lens.liveBehavior}`,
      `Post-call behavior: ${lens.postCallBehavior}`
    );
  }

  return context.join("\n");
}

export type ConsentMode =
  | "conference_disclosure"
  | "owner_acknowledgment"
  | "workspace_setting";

export interface EntityProfile {
  id: string;
  type: EntityType;
  name: string;
  ownerUserId: string;
  timezone: string;
  status: EntityStatus;
  riskClass: RiskClass;
  defaultIndustryProfile?: IndustryProfileId;
  defaultCoachMode?: CoachMode | null;
  defaultConsentMode: ConsentMode;
  createdAt: number;
  updatedAt: number;
}

export type PhoneNumberStatus =
  | "searching"
  | "ordering"
  | "configuring"
  | "active"
  | "failed"
  | "released";

export interface PhoneNumberAssignment {
  id: string;
  entityId: string;
  phoneNumber: string;
  areaCode: string;
  status: PhoneNumberStatus;
  telnyxPhoneNumberId?: string;
  telnyxConnectionId?: string;
  callControlApplicationId?: string;
  voiceWebhookUrl?: string;
  mediaStreamUrl?: string;
  statusLabel?: string;
  lastInboundAt?: number;
  lastTestedAt?: number;
}

export interface AvailablePhoneNumber {
  phoneNumber: string;
  locality?: string;
  region?: string;
  monthlyCost?: string;
  upfrontCost?: string;
}

export type ContactSource = "manual" | "call_participant";

export interface Contact {
  id: string;
  entityId: string;
  phoneNumber?: string;
  displayName?: string;
  email?: string;
  relationshipLabel?: string;
  source: ContactSource;
  externalRefs?: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export type CallMode =
  | "conference_in"
  | "call_through"
  | "sidetone_session"
  | "shared_import"
  | "uploaded_recording"
  | "discord_voice"
  | "vexa_meeting";

export type CallSessionStatus =
  | "connecting"
  | "live"
  | "processing"
  | "ready"
  | "failed"
  | "cancelled";

export interface CallSession {
  id: string;
  entityId: string;
  mode: CallMode;
  status: CallSessionStatus;
  industryProfile?: IndustryProfileId;
  coachMode?: CoachMode | null;
  consentMode: ConsentMode;
  recordingDisclosurePlayed: boolean;
  startedAt?: number;
  endedAt?: number;
  durationSeconds?: number;
  ownerContactId?: string;
  primaryCounterpartyContactId?: string;
  telnyxConferenceId?: string;
  telnyxClientState?: string;
  failureReason?: string;
  activeArtifactId?: string;
}

export interface CallThroughRequest {
  entityId: string;
  toPhoneNumber: string;
  industryProfile?: IndustryProfileId;
  coachMode?: CoachMode | null;
}

export interface CallThroughResult {
  callSessionId: string;
  telnyxCallControlId?: string;
  telnyxCallSessionId?: string;
}

export type CallLegRole = "owner" | "counterparty" | "sidetone" | "unknown";

export type CallLegDirection = "inbound" | "outbound";

export interface CallLeg {
  id: string;
  callSessionId: string;
  participantContactId?: string;
  role: CallLegRole;
  direction: CallLegDirection;
  telnyxCallControlId?: string;
  telnyxCallSessionId?: string;
  fromPhoneNumber?: string;
  toPhoneNumber?: string;
  status: string;
  joinedAt?: number;
  leftAt?: number;
}

export type MediaTrack = "inbound" | "outbound" | "both";

export type StreamStatus = "starting" | "live" | "stopped" | "failed";

export interface MediaStreamSession {
  id: string;
  callSessionId: string;
  callLegId?: string;
  provider: "telnyx";
  streamId?: string;
  track: MediaTrack;
  status: StreamStatus;
  startedAt?: number;
  endedAt?: number;
  error?: string;
}

export type TelnyxCallControlEventType =
  | "call.initiated"
  | "call.answered"
  | "call.hangup"
  | "call.bridged"
  | "call.recording.saved"
  | "call.streaming.started"
  | "call.streaming.stopped"
  | "call.failed"
  | string;

export interface TelnyxCallControlWebhookPayload {
  eventId: string;
  eventType: TelnyxCallControlEventType;
  callControlId?: string;
  callSessionId?: string;
  clientState?: string;
  fromPhoneNumber?: string;
  toPhoneNumber?: string;
  direction?: "incoming" | "outgoing";
  occurredAt?: string;
}

export interface TranscriptSegment {
  id: string;
  callSessionId: string;
  callLegId?: string;
  speakerRole: CallLegRole;
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
  isFinal: boolean;
  provider: "assemblyai" | "telnyx" | "vexa" | "manual";
  providerSegmentId?: string;
}

export type CoachCardStatus = "active" | "dismissed" | "pinned" | "expired";

export type CoachCardPriority = "low" | "normal" | "high";

export interface CoachCard {
  id: string;
  callSessionId: string;
  coachMode: TuningMode;
  text: string;
  reason?: string;
  priority: CoachCardPriority;
  timestampMs: number;
  status: CoachCardStatus;
  sourceTranscriptSegmentIds: string[];
  promptVersion: string;
  model: string;
}

export type CallArtifactStatus = "draft" | "ready" | "edited" | "delivered" | "failed";

export interface CallArtifact {
  id: string;
  callSessionId: string;
  type: "call_record";
  status: CallArtifactStatus;
  summary: string;
  keyMoments: string[];
  decisions: string[];
  actionItems: string[];
  openQuestions: string[];
  followUpDraft?: string;
  crmNoteDraft?: string;
  transcriptText?: string;
  model?: string;
  promptVersion?: string;
  sourceTranscriptSegmentIds: string[];
}

export interface ConsentRecord {
  id: string;
  entityId: string;
  callSessionId: string;
  scope: "recording" | "transcription" | "coaching";
  source: ConsentMode;
  evidence: string;
  capturedAt: number;
}

export interface AuditEvent {
  id: string;
  entityId: string;
  callSessionId?: string;
  eventType: string;
  provider?: string;
  providerEventId?: string;
  payloadHash?: string;
  message?: string;
  createdAt: number;
}
