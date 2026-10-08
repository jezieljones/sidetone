import type { IndustryProfileId, TuningMode } from "@sidetone/contracts";

export type ModeTone =
  | "primary"
  | "accent"
  | "success"
  | "secondary"
  | "warning"
  | "danger"
  | "violet";

export type CoachModeId =
  | "just_notes"
  | "close_the_deal"
  | "negotiate"
  | "sense_check"
  | "support"
  | "charm";

export type ModePersonaSlug =
  | "margo"
  | "vince"
  | "nico"
  | "sloane"
  | "alma"
  | "val";

export type IndustryPersonaSlug =
  | "rowan"
  | "maya"
  | "reese"
  | "omar"
  | "imani"
  | "zuri"
  | "tessa"
  | "miles"
  | "anya"
  | "elena"
  | "priya";

export type ModePersona = {
  slug: ModePersonaSlug;
  coachMode: CoachModeId;
  personaName: string;
  modeLabel: string;
  modeShortLabel: string;
  badgeLabel: string;
  headline: string;
  body: string;
  emotionalJob: string;
  audiences: string[];
  callMoment: string;
  caller: string;
  recipient: string;
  privatePrompt: string;
  afterCallOutput: string[];
  icon: string;
  symbol: string;
  visualRole: string;
  cardPose: string;
  wardrobeNotes: string;
  phoneProp: string;
  palette: string[];
  accent: string;
  accentHsl: string;
  background: string;
  cardImage: string;
  isolatedImage: string;
  tone: ModeTone;
  source: string;
};

export type IndustryPersona = {
  slug: IndustryPersonaSlug;
  personaName: string;
  industry: string;
  badgeLabel: string;
  headline: string;
  body: string;
  callMoment: string;
  visualRole: string;
  wardrobeNotes: string;
  phoneProp: string;
  palette: string[];
  accent: string;
  modeAffinity: CoachModeId;
};

export type DashboardIndustryProfile = IndustryPersona & {
  id: IndustryProfileId;
  cardImage: string;
  compactLabel: string;
  suggestedTuningMode?: TuningMode;
  outcome: string;
};

export type VisualDirection = {
  slug: string;
  name: string;
  role: string;
  strength: string;
  risk: string;
  anchorPrompt: string;
};

const sharedAvoid =
  "Avoid: AI employee language, mascot framing, character-card controls, generic SaaS dashboards, beige gradients, cyberpunk styling, weapons, emergency-services cosplay, implementation jargon, watermark.";

const sharedStyle =
  "Style: studio-grade phone-call product, navy on-air surfaces, cream editorial type, crimson live signal, amber standby accent, slate information layer, precise controls, quiet confidence, vivid but professional.";

export const rosterAssetBase = "/brand/generated/call-mode-roster-v1";

export const rosterAssets = {
  source: "Core mode persona art / 2026-05-14T14:44:52.700Z; Rowan standalone industry phone-card set generated 2026-05-19",
  provider: "openai",
  model: "gpt-image-2",
  primaryLineup: `${rosterAssetBase}/openai-gpt-image-2-primary-mode-lineup.png`,
  industryLineup: `${rosterAssetBase}/openai-gpt-image-2-industry-persona-lineup.png`,
  brandAnchorSheet: `${rosterAssetBase}/openai-gpt-image-2-brand-anchor-sheet.png`,
  modeBadgeIconSheet: `${rosterAssetBase}/openai-gpt-image-2-mode-badge-icon-sheet.png`
} as const;

function openAiRosterAsset(slug: string) {
  return `/profiles/${slug.split("-").at(-1)}.svg`;
}

export const modePersonas: ModePersona[] = [
  {
    slug: "margo",
    coachMode: "just_notes",
    personaName: "Margo",
    modeLabel: "Just notes",
    modeShortLabel: "Notes",
    badgeLabel: "Just notes",
    headline: "The useful version of the call, written clean.",
    body: "For the call that needs a faithful record, Sidetone separates decisions, asks, dates, and next steps from the noise.",
    emotionalJob: "I need the call captured cleanly.",
    audiences: ["Phone-heavy professionals", "Operators", "Client work"],
    callMoment: "A client changes three details that need to land in the record.",
    caller: "Owner",
    recipient: "Client",
    privatePrompt: "Confirm what should be written down before the call ends.",
    afterCallOutput: [
      "Decision log separated from small talk",
      "Clean summary ready for notes",
      "Follow-up asks grouped by owner"
    ],
    icon: "Archive",
    symbol: "Archive ring",
    visualRole: "Margo, a precise call-note archivist with a clean ledger, compact recorder, and calm phone-call focus.",
    cardPose: "upright, centered, pen and call ledger visible, confident but quiet",
    wardrobeNotes: "structured navy editorial jacket, cream shirt, archive tabs, slim recorder pouch",
    phoneProp: "call ledger, compact recorder, timestamp tape, classic handset, handwritten notes",
    palette: ["Poster pink", "Cherry red", "Warm cream"],
    accent: "#f04b7a",
    accentHsl: "343 85% 62%",
    background: "#c9203f",
    cardImage: openAiRosterAsset("square-card-margo"),
    isolatedImage: openAiRosterAsset("isolated-margo"),
    tone: "primary",
    source: "just_notes"
  },
  {
    slug: "vince",
    coachMode: "close_the_deal",
    personaName: "Vince",
    modeLabel: "Close the deal",
    modeShortLabel: "Close",
    badgeLabel: "Close the deal",
    headline: "Catch the buying signal while it is still live.",
    body: "Sidetone listens for readiness, friction, and missing commitments so the next step gets named before the call drifts.",
    emotionalJob: "I need commitment before the moment passes.",
    audiences: ["Founders", "Sales", "Consultants"],
    callMoment: "A prospect likes the offer but keeps circling implementation timing.",
    caller: "Founder",
    recipient: "Prospect",
    privatePrompt: "Ask what would make this worth approving this week.",
    afterCallOutput: [
      "Primary objection captured as implementation time",
      "Decision maker and approval path identified",
      "Pilot plan follow-up drafted"
    ],
    icon: "Target",
    symbol: "Locked orbit",
    visualRole: "Vince, a decisive deal closer with sharp tailoring, a signed agreement, and focused phone-call energy.",
    cardPose: "leaning forward with agreement in hand, decisive handshake angle, confident expression",
    wardrobeNotes: "deep plum jacket, crimson collar hit, gold signal stripe, tailored shirt",
    phoneProp: "signed agreement, approval card, red desk phone, close-check mark",
    palette: ["Burnt orange", "Black receiver", "Warm cream"],
    accent: "#ff8a24",
    accentHsl: "28 100% 57%",
    background: "#d45a16",
    cardImage: openAiRosterAsset("square-card-vince"),
    isolatedImage: openAiRosterAsset("isolated-vince"),
    tone: "danger",
    source: "close_the_deal"
  },
  {
    slug: "nico",
    coachMode: "negotiate",
    personaName: "Nico",
    modeLabel: "Negotiate",
    modeShortLabel: "Negotiate",
    badgeLabel: "Negotiate",
    headline: "Hold the line without losing the relationship.",
    body: "When price, terms, concessions, or timing get slippery, Sidetone helps you clarify tradeoffs and protect the deal.",
    emotionalJob: "I need a stronger position without sounding pushy.",
    audiences: ["Real estate", "Mortgage", "Insurance"],
    callMoment: "A buyer asks for concessions late and the other side is hardening.",
    caller: "Agent",
    recipient: "Buyer",
    privatePrompt: "Trade one concession for one clear commitment.",
    afterCallOutput: [
      "Requested concession and counteroffer logged",
      "Approval dependency named",
      "Next call framed around a specific trade"
    ],
    icon: "Scale",
    symbol: "Balanced signal bridge",
    visualRole: "Nico, a composed negotiator balancing terms with a counteroffer card and two phone lines.",
    cardPose: "measured three-quarter pose, counteroffer card visible, balanced hands",
    wardrobeNotes: "teal tailored vest, coral sleeve accents, cream shirt, simple gold detail",
    phoneProp: "counteroffer card, two receiver cords, tradeoff markers, split waveform",
    palette: ["Teal field", "Cream type", "Ink linework"],
    accent: "#16c6b7",
    accentHsl: "175 80% 43%",
    background: "#0b8d84",
    cardImage: "/profiles/nico.svg",
    isolatedImage: openAiRosterAsset("isolated-nico"),
    tone: "warning",
    source: "negotiate"
  },
  {
    slug: "sloane",
    coachMode: "sense_check",
    personaName: "Sloane",
    modeLabel: "Sense-check me",
    modeShortLabel: "Sense-check",
    badgeLabel: "Sense-check me",
    headline: "Turn the screen into a clear read.",
    body: "Sidetone keeps track of motivators, risks, open questions, and fit signals while the conversation stays human.",
    emotionalJob: "I need to judge fit clearly.",
    audiences: ["Recruiters", "Sourcers", "BD"],
    callMoment: "A candidate sounds interested, but the constraints do not fully match yet.",
    caller: "Recruiter",
    recipient: "Candidate",
    privatePrompt: "Ask what would make them say yes to the next round.",
    afterCallOutput: [
      "Motivators and constraints separated",
      "Compensation and travel notes ready for ATS",
      "Open fit questions listed for the hiring manager"
    ],
    icon: "Compass",
    symbol: "Compass wave",
    visualRole: "Sloane, a sharp signal reader with a compact scanner, screening notes, and alert call posture.",
    cardPose: "phone at ear, signal scanner tucked beside notes, eyes tracking the read",
    wardrobeNotes: "cobalt field jacket, acid-lime signal trim, charcoal base layers",
    phoneProp: "signal scanner, radio handset, screening notes, sweep beam",
    palette: ["Royal purple", "Lavender handset", "Warm cream"],
    accent: "#8f63c8",
    accentHsl: "266 48% 59%",
    background: "#5c3a8e",
    cardImage: openAiRosterAsset("square-card-sloane"),
    isolatedImage: openAiRosterAsset("isolated-sloane"),
    tone: "accent",
    source: "sense_check"
  },
  {
    slug: "alma",
    coachMode: "support",
    personaName: "Alma",
    modeLabel: "Support them",
    modeShortLabel: "Support",
    badgeLabel: "Support them",
    headline: "Stay helpful when the call is sensitive.",
    body: "Sidetone notices emotion, unresolved concerns, and missing reassurance so support feels attentive instead of scripted.",
    emotionalJob: "I need to support them well.",
    audiences: ["Customer success", "Support", "Healthcare-adjacent"],
    callMoment: "A customer is frustrated, but the real issue is trust after a missed handoff.",
    caller: "Success lead",
    recipient: "Customer",
    privatePrompt: "Reflect the concern before offering the fix.",
    afterCallOutput: [
      "Concern, fix, and reassurance separated",
      "Escalation owner named",
      "Customer-facing recap drafted in a calm tone"
    ],
    icon: "HeartHandshake",
    symbol: "Shielded waveform",
    visualRole: "Alma, a warm support advocate with a support card, reassurance note, and attentive phone-call presence.",
    cardPose: "soft focused posture, support card forward, phone visible but not dominant",
    wardrobeNotes: "aubergine jacket, mint signal lining, warm white shirt, understated pin",
    phoneProp: "support card, reassurance note, voice shield, soft waveform halo",
    palette: ["Golden yellow", "Cream florals", "Ink linework"],
    accent: "#f4b51f",
    accentHsl: "42 91% 54%",
    background: "#c98500",
    cardImage: openAiRosterAsset("square-card-alma"),
    isolatedImage: openAiRosterAsset("isolated-alma"),
    tone: "success",
    source: "support"
  },
  {
    slug: "val",
    coachMode: "charm",
    personaName: "Val",
    modeLabel: "Charm",
    modeShortLabel: "Charm",
    badgeLabel: "Charm",
    headline: "Keep the room warm without losing the point.",
    body: "Sidetone tracks the human thread of the call: names, preferences, callbacks, tone shifts, and moments worth remembering.",
    emotionalJob: "I need the relationship to stay warm.",
    audiences: ["Partnerships", "Fundraising", "High-touch accounts"],
    callMoment: "A partner call is going well, and relationship details matter as much as the next step.",
    caller: "Operator",
    recipient: "Partner",
    privatePrompt: "Reference the detail they cared about before asking for the intro.",
    afterCallOutput: [
      "Relationship notes captured separately",
      "Warm follow-up line drafted",
      "Intro ask and timing saved"
    ],
    icon: "Sparkles",
    symbol: "Callback book",
    visualRole: "Val, a polished relationship caller with callback notes, linked receivers, and calm social read.",
    cardPose: "graceful profile, callback book in hand, warm expression, phone detail visible",
    wardrobeNotes: "cobalt jacket, orchid scarf or collar, butter-yellow warmth accents",
    phoneProp: "callback book, interlinked receivers, warmline signal, relationship tag",
    palette: ["Signal red", "Black jacket", "Warm cream"],
    accent: "#e33322",
    accentHsl: "5 77% 51%",
    background: "#b61912",
    cardImage: openAiRosterAsset("square-card-val"),
    isolatedImage: openAiRosterAsset("isolated-val"),
    tone: "violet",
    source: "charm"
  }
];

export const industryPersonas: IndustryPersona[] = [
  {
    slug: "rowan",
    personaName: "Rowan",
    industry: "General",
    badgeLabel: "General",
    headline: "Keep the useful version of any call.",
    body: "For decisions, asks, owners, dates, next steps, and useful notes.",
    callMoment: "A call covers five small details and one follow-up that should not disappear.",
    visualRole: "Rowan, a composed generalist phone-call operator with a clean ledger, call notes, and calm professional focus.",
    wardrobeNotes: "ink blazer, black shirt, gold detail, small signal-green pin",
    phoneProp: "call notes ledger, decision checklist, owner/date tabs, handset",
    palette: ["Navy", "Cream", "Slate Blue"],
    accent: "#4C86A8",
    modeAffinity: "just_notes"
  },
  {
    slug: "maya",
    personaName: "Maya",
    industry: "Real Estate",
    badgeLabel: "Real Estate",
    headline: "Keep clients, offers, and concessions straight.",
    body: "For showings, counteroffers, inspections, and late-stage buyer calls.",
    callMoment: "A buyer asks for repairs while the seller is still deciding.",
    visualRole: "Maya, a real-estate caller with client cards, offer notes, and a polished field-ready jacket.",
    wardrobeNotes: "cream blazer, ink shirt, small house pin, practical clipboard",
    phoneProp: "client cards, offer note, keys, inspection checklist",
    palette: ["Coral", "Cream", "Navy"],
    accent: "#F26B5B",
    modeAffinity: "negotiate"
  },
  {
    slug: "reese",
    personaName: "Reese",
    industry: "Recruiting",
    badgeLabel: "Recruiting",
    headline: "Read fit without losing the candidate.",
    body: "For screens, offer calls, sourcing follow-ups, and hiring-manager recaps.",
    callMoment: "A candidate is warm, but compensation and timing need a clean read.",
    visualRole: "Reese, a focused recruiter with pipeline notes, candidate files, and a phone at the ear.",
    wardrobeNotes: "cobalt suit, slate tie, compact headset, precise notes",
    phoneProp: "pipeline sheet, candidate file, offer letter, sourcing checklist",
    palette: ["Slate Blue", "Cream", "Steel"],
    accent: "#4C86A8",
    modeAffinity: "sense_check"
  },
  {
    slug: "tessa",
    personaName: "Tessa",
    industry: "Oil and Gas",
    badgeLabel: "Oil and Gas",
    headline: "Keep mineral calls precise.",
    body: "For landowner calls, lease terms, royalties, acreage, title follow-up, and verbal offers.",
    callMoment: "A mineral owner names a royalty, acreage, and signing condition that need to survive the call.",
    visualRole: "Tessa, an oil-and-gas land professional with lease notes, tract maps, owner cards, and calm field-office focus.",
    wardrobeNotes: "deep green field blazer, cream shirt, brass detail, practical notebook",
    phoneProp: "lease notes, tract map, royalty card, classic handset",
    palette: ["Deep green", "Warm cream", "Brass"],
    accent: "#C58A2A",
    modeAffinity: "sense_check"
  },
  {
    slug: "miles",
    personaName: "Miles",
    industry: "Freight",
    badgeLabel: "Freight",
    headline: "Lock in rates, lanes, and commitments.",
    body: "For broker calls, carrier commitments, load specs, accessorials, exceptions, and check calls.",
    callMoment: "A carrier quotes a lane, rate, equipment type, pickup window, and detention terms in one breath.",
    visualRole: "Miles, a freight broker with load boards, rate notes, lane cards, and dispatch-call focus.",
    wardrobeNotes: "ink work jacket, signal-red detail, structured headset, practical desk setup",
    phoneProp: "load board, rate card, lane sheet, dispatch headset",
    palette: ["Signal red", "Steel", "Warm cream"],
    accent: "#D22B2B",
    modeAffinity: "close_the_deal"
  },
  {
    slug: "omar",
    personaName: "Omar",
    industry: "Sales",
    badgeLabel: "Sales",
    headline: "Move from interest to commitment.",
    body: "For discovery calls, follow-ups, pilot commits, and pricing conversations.",
    callMoment: "A prospect likes the product but has not named the approval path.",
    visualRole: "Omar, a sales operator with a signed pilot sheet, deal notes, and a confident hand gesture.",
    wardrobeNotes: "dark tailored jacket, red signal accent, cream shirt",
    phoneProp: "signed pilot sheet, forecast card, pricing note, desk phone",
    palette: ["Crimson", "Amber", "Navy"],
    accent: "#D22B2B",
    modeAffinity: "close_the_deal"
  },
  {
    slug: "imani",
    personaName: "Imani",
    industry: "Legal Services",
    badgeLabel: "Legal Services",
    headline: "Capture risk, terms, and next steps.",
    body: "For intake calls, client updates, negotiation prep, and matter handoffs.",
    callMoment: "A client explains a sensitive issue and several dates matter.",
    visualRole: "Imani, a legal-services caller with case notes, marked terms, and composed attention.",
    wardrobeNotes: "charcoal blazer, ivory blouse, small gold linework detail",
    phoneProp: "case notes, marked terms page, deadline tab, handset",
    palette: ["Navy", "Cream", "Amber"],
    accent: "#E3B23C",
    modeAffinity: "just_notes"
  },
  {
    slug: "zuri",
    personaName: "Zuri",
    industry: "Athletics",
    badgeLabel: "Athletics",
    headline: "Turn parent calls into clean logistics.",
    body: "For schedules, rosters, uniforms, field changes, and payment reminders.",
    callMoment: "A parent asks about schedule changes while uniform sizes are still due.",
    visualRole: "Zuri, an athletics coordinator with schedule cards, field notes, and a sideline headset.",
    wardrobeNotes: "navy polo, red trim, whistle tucked away, practical clipboard",
    phoneProp: "schedule card, field schedule, uniform size sheet, headset",
    palette: ["Red", "Navy", "Warm cream"],
    accent: "#D22B2B",
    modeAffinity: "just_notes"
  },
  {
    slug: "anya",
    personaName: "Anya",
    industry: "Insurance",
    badgeLabel: "Insurance",
    headline: "Keep coverage calls on the record.",
    body: "For quotes, renewals, exclusions, disclosures, and client follow-up.",
    callMoment: "A client asks about coverage while renewal timing and exclusions matter.",
    visualRole: "Anya, an insurance and financial-services caller with policy notes, coverage tabs, and composed client focus.",
    wardrobeNotes: "deep navy jacket, brass detail, clean shirt, small shield pin",
    phoneProp: "policy folder, coverage checklist, renewal tabs, classic handset",
    palette: ["Deep teal", "Navy", "Brass"],
    accent: "#4C86A8",
    modeAffinity: "support"
  },
  {
    slug: "elena",
    personaName: "Elena",
    industry: "Healthcare",
    badgeLabel: "Healthcare",
    headline: "Support sensitive calls with care.",
    body: "For patient follow-ups, scheduling, benefits questions, and care-team handoffs.",
    callMoment: "A patient is worried after a missed handoff and needs reassurance.",
    visualRole: "Elena, a healthcare caller with a care card, follow-up note, and calm support posture.",
    wardrobeNotes: "teal jacket, soft cream shirt, clean badge detail",
    phoneProp: "care card, follow-up note, appointment card, phone handset",
    palette: ["Teal", "Mint", "Warm white"],
    accent: "#C6C5B9",
    modeAffinity: "support"
  },
  {
    slug: "priya",
    personaName: "Priya",
    industry: "Event Planning",
    badgeLabel: "Event Planning",
    headline: "Keep vendors, clients, and timing aligned.",
    body: "For vendor calls, venue changes, guest details, and last-mile confirmations.",
    callMoment: "A vendor changes arrival timing while the client adds one more requirement.",
    visualRole: "Priya, an event planner with a callback book, vendor cards, and polished relationship energy.",
    wardrobeNotes: "emerald jacket, orchid accent, cream blouse",
    phoneProp: "callback book, vendor cards, venue timeline, handset",
    palette: ["Emerald", "Orchid", "Cream"],
    accent: "#829399",
    modeAffinity: "charm"
  }
];

const industryPersonaBySlug = Object.fromEntries(
  industryPersonas.map((persona) => [persona.slug, persona])
) as Record<IndustryPersonaSlug, IndustryPersona>;

export const dashboardIndustryProfiles: DashboardIndustryProfile[] = [
  {
    ...industryPersonaBySlug.rowan,
    id: "general",
    cardImage: openAiRosterAsset("industry-card-rowan"),
    compactLabel: "General",
    outcome: "Capture decisions, asks, owners, dates, next steps, and useful notes."
  },
  {
    ...industryPersonaBySlug.maya,
    id: "real_estate_mortgage",
    industry: "Real estate and mortgage",
    badgeLabel: "Real Estate",
    cardImage: openAiRosterAsset("industry-card-maya"),
    compactLabel: "Real estate",
    suggestedTuningMode: "negotiate",
    outcome: "Clarify concessions, timing, preferences, and tradeoffs before the deal hardens."
  },
  {
    ...industryPersonaBySlug.reese,
    id: "recruiting_sourcing",
    industry: "Recruiting and sourcing",
    badgeLabel: "Recruiting",
    cardImage: openAiRosterAsset("industry-card-reese"),
    compactLabel: "Recruiting",
    suggestedTuningMode: "sense_check",
    outcome: "Separate motivators, constraints, compensation, and open fit questions before the screen disappears."
  },
  {
    ...industryPersonaBySlug.tessa,
    id: "oil_and_gas_landmen",
    industry: "Oil and gas landmen",
    badgeLabel: "Oil and Gas",
    cardImage: openAiRosterAsset("industry-card-tessa"),
    compactLabel: "Oil and gas",
    suggestedTuningMode: "sense_check",
    outcome: "Capture royalty, acreage, lease terms, owner context, offers, and title follow-up before details get disputed."
  },
  {
    ...industryPersonaBySlug.miles,
    id: "freight_brokerage",
    industry: "Freight brokerage",
    badgeLabel: "Freight",
    cardImage: openAiRosterAsset("industry-card-miles"),
    compactLabel: "Freight",
    suggestedTuningMode: "close_the_deal",
    outcome: "Confirm rates, lanes, load specs, accessorials, carrier commitments, and exceptions while the call is live."
  },
  {
    ...industryPersonaBySlug.omar,
    id: "sales_founders_operators",
    industry: "Sales, founders, and operators",
    badgeLabel: "Sales",
    cardImage: openAiRosterAsset("industry-card-omar"),
    compactLabel: "Sales",
    suggestedTuningMode: "close_the_deal",
    outcome: "Turn readiness, friction, stakeholders, and next steps into a clear commitment."
  },
  {
    ...industryPersonaBySlug.imani,
    id: "legal_client_services",
    industry: "Legal and client services",
    badgeLabel: "Legal Services",
    cardImage: openAiRosterAsset("industry-card-imani"),
    compactLabel: "Legal",
    suggestedTuningMode: "sense_check",
    outcome: "Capture facts, dates, documents, risks, and promises without giving advice."
  },
  {
    ...industryPersonaBySlug.anya,
    id: "insurance_financial_services",
    industry: "Insurance",
    badgeLabel: "Insurance",
    cardImage: openAiRosterAsset("industry-card-anya"),
    compactLabel: "Insurance",
    suggestedTuningMode: "support",
    outcome: "Keep coverage details, exclusions, renewals, and follow-up promises in a defensible record."
  },
  {
    ...industryPersonaBySlug.zuri,
    id: "athletics_recruiting",
    industry: "Athletics and high-touch recruiting",
    badgeLabel: "Athletics",
    cardImage: openAiRosterAsset("industry-card-zuri"),
    compactLabel: "Athletics",
    suggestedTuningMode: "charm",
    outcome: "Remember parents, athletes, staff, schedules, expectations, and relationship context."
  }
];

const hiddenDashboardIndustryProfiles: DashboardIndustryProfile[] = [
  {
    ...industryPersonaBySlug.elena,
    id: "healthcare_sensitive",
    industry: "Healthcare and sensitive",
    badgeLabel: "Healthcare",
    cardImage: openAiRosterAsset("industry-card-elena"),
    compactLabel: "Healthcare",
    suggestedTuningMode: "support",
    outcome: "Keep sensitive calls grounded, human, and useful for handoffs."
  }
];

export const dashboardIndustryProfileById = Object.fromEntries(
  [...dashboardIndustryProfiles, ...hiddenDashboardIndustryProfiles].map((profile) => [profile.id, profile])
) as Partial<Record<IndustryProfileId, DashboardIndustryProfile>>;

export function dashboardIndustryProfileForId(profileId?: string): DashboardIndustryProfile {
  return dashboardIndustryProfileById[(profileId ?? "general") as IndustryProfileId] ?? dashboardIndustryProfiles[0];
}

export const modePersonaByMode = Object.fromEntries(
  modePersonas.map((persona) => [persona.coachMode, persona])
) as Record<CoachModeId, ModePersona>;

export const tuningModePersonas = modePersonas.filter((persona) => persona.coachMode !== "just_notes") as Array<
  ModePersona & { coachMode: TuningMode }
>;

export const tuningModeOptions = tuningModePersonas.map((persona) => ({
  value: persona.coachMode,
  label: persona.modeLabel,
  description: persona.body
}));

export const modePersonasBySlug = Object.fromEntries(
  modePersonas.map((persona) => [persona.slug, persona])
) as Record<ModePersonaSlug, ModePersona>;

export function modePersonaForMode(mode?: string): ModePersona {
  return modePersonaByMode[(mode ?? "just_notes") as CoachModeId] ?? modePersonaByMode.just_notes;
}

export function modeLabel(mode?: string): string {
  return modePersonaForMode(mode).modeLabel;
}

export function modeAccentStyle(persona: ModePersona | IndustryPersona) {
  return {
    "--mode-accent": persona.accent,
    "--mode-accent-hsl": "accentHsl" in persona ? persona.accentHsl : undefined
  } as Record<string, string | undefined>;
}

export const rosterAnchorPrompt = `Create a Sidetone Brand Anchor Sheet for the 2026 Sidetone Brand Style Guide.

Show the core product identity: lowercase italic serif wordmark, crimson live dot, navy on-air surfaces, cream archive surfaces, amber standby accents, slate information layer, and precise call controls.

Primary call profiles:
${dashboardIndustryProfiles.map((profile) => `${profile.personaName} / ${profile.industry}`).join(", ")}.

${sharedStyle}

Include: logo usage, palette strip, typography samples, button states, live-state component, call record surface, profile card examples, and secondary tuning chips.

${sharedAvoid}`;

export const visualDirections: VisualDirection[] = [
  {
    slug: "call-mode-roster-v1",
    name: "Studio Interface",
    role: "Navy on-air surfaces, cream archive surfaces, crimson live and CTA signals, amber standby accents, and slate information layers.",
    strength: "Keeps Sidetone feeling like broadcast equipment and an editorial call record instead of a generic SaaS dashboard.",
    risk: "Crimson loses meaning if it is used as decoration instead of a live or primary-action signal.",
    anchorPrompt: rosterAnchorPrompt
  }
];

export const visualGuardrails = [
  "Use Crimson for live state or the primary CTA, not decoration.",
  "Pair live and standby dots with text and a timer; color alone is not enough.",
  "Keep display type italic and editorial.",
  "Use plain product copy: joins, listens, writes down, notes, summary, transcript.",
  "Use industry persona cards as the primary controls with a clear call job.",
  "Use 8px spacing and avoid card-on-card nesting."
];

export const brandPalette = [
  { name: "Navy", value: "#0A192F" },
  { name: "Cream", value: "#F6EFE2" },
  { name: "Crimson", value: "#D22B2B" },
  { name: "Amber", value: "#E3B23C" },
  { name: "Slate Blue", value: "#4C86A8" },
  { name: "Coral", value: "#F26B5B" },
  { name: "Sage", value: "#C6C5B9" },
  { name: "Steel", value: "#829399" }
];

export function buildModePersonaPrompt(
  persona: ModePersona,
  composition = "square primary mode card"
) {
  return `Using the Sidetone Brand Style Guide as the style reference, create a product control tile for the "${persona.modeLabel}" mode.

Tile hierarchy: compact mode icon, mode label "${persona.modeLabel}", and one precise call benefit. Do not add character art, job titles, callsigns, department labels, or white pills.
Mode job: ${persona.emotionalJob}
Palette: ${persona.palette.join(", ")}
Sidetone mode: ${persona.modeLabel}
Composition: ${composition}.
${sharedStyle}
${sharedAvoid}`;
}

export function buildIndustryPersonaPrompt(
  persona: IndustryPersona,
  composition = "square industry persona card"
) {
  return `Using the Sidetone Brand Style Guide as the style reference, create an industry signal tile for ${persona.industry}.

Tile hierarchy: industry label "${persona.industry}", call moment, compact signal badge, and one outcome. Do not add character art or job-title pills.
Call moment: ${persona.callMoment}
Palette: ${persona.palette.join(", ")}
Composition: ${composition}.
${sharedStyle}
${sharedAvoid}`;
}

export function buildAssetPrompt(
  persona: ModePersona | IndustryPersona,
  composition = "square card"
) {
  return "modeLabel" in persona
    ? buildModePersonaPrompt(persona, composition)
    : buildIndustryPersonaPrompt(persona, composition);
}
