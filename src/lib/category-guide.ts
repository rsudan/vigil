/**
 * The ten rooms every strategy is read through, the same for a youth plan, a
 * digital plan or a disaster plan. Nothing here assumes a sector, a country or
 * a funding instrument.
 *
 * `terms` is the retrieval vocabulary used to find what the uploaded document
 * says in each room and to build the query a room asks the world.
 * `researchLenses` names the sources a research run for the room must have
 * read, so "nothing found" can be judged against what was looked at.
 * `example` is generic and is shown on the public methodology page.
 *
 * Three tie-breakers decide the hard cases, and are printed on the Categories
 * page so a person can check any filing:
 *   1 vs 6 vs 8: where a change comes from. Outside the owner's control and
 *     structural: 1. Inside its legal or institutional control: 6. A dated
 *     event that crosses a line, whatever its origin: 8. The test is who can
 *     change the rule.
 *   3 vs 9: mechanism versus practice. Evidence about whether this plan's
 *     causal chain works: 3, even from abroad. What another jurisdiction did,
 *     or a review of this strategy: 9.
 *   2 vs 10: capability versus window. A technology development is 2. It is
 *     10 only when it arrives with a dated application or closing window.
 */
export const CATEGORY_GUIDE = [
  {
    id: 1,
    short: "External",
    name: "The world outside the plan",
    question: "Has the world this plan was written for moved, including rules set by bodies its owner cannot change?",
    why: "A plan written for one economy, one demography, one hazard mix and one legal order can become the wrong plan without anyone missing a deadline. Rules the owner does not make, from a regulator, a treaty body or a court above it, arrive from outside and bind all the same.",
    looksFor: "The context the strategy rests on (demographic and economic projections, the situation analysis) and its commitments to comply with or align to binding rules its owner does not control: supranational regulation and directives, treaty obligations, international standards it must meet. Money and the strings on it are room 5; rules the owner can change are room 6.",
    ifEmpty: "You are not watching the outside world or the rule-makers above you. A binding change will arrive as a letter, not as a watchpoint.",
    example: "A directive adopted above the jurisdiction after the strategy imposes a duty the plan never mentions, with a transposition deadline inside the plan's horizon; the population projection the diagnosis rests on is revised downward by the statistics office.",
    terms: "context environment external trend demographic population migration economy inflation recession employment climate geopolitical conflict directive treaty transposition obligation binding compliance international",
    researchLenses: "Statistical releases, revisions and forecasts from the national statistics office, the central bank and international bodies; legislation and regulation adopted above the jurisdiction in the sector (official journals, legislative trackers) with their application and transposition dates; treaties and standards adopted since the strategy. Prefer official statistics, official journals and IGO publications; treat commentary as a lead only. A slow trend belongs here; a dated event is room 8; a rule the owner can change is room 6; a non-binding framework is room 9; a funding decision is room 5.",
  },
  {
    id: 2,
    short: "Technology",
    name: "The tools, data and capabilities the plan depends on, or ignores",
    question: "Do the systems and data this plan relies on still work, and has a new capability changed what is possible?",
    why: "Modern strategies rest on named platforms, registries and data flows; if those rot the text is theatre. And a capability that did not exist at adoption (automation, general-purpose AI, a new standard) can make a planned action obsolete, create a risk the drafters could not see, or make a whole chapter too timid.",
    looksFor: "Named platforms, registries, portals and data sources and whether they are live and complete; outages and cyber incidents; data availability for the plan's indicators; new technical capabilities that change how an action could be done, make it unnecessary, or create an in-scope risk.",
    ifEmpty: "The plan names systems and nobody is checking whether they are alive, and nobody is asking whether the way the plan proposes to do things is still the sensible way.",
    example: "A capability that did not exist at adoption makes a planned manual service obsolete; the register the plan's indicators depend on stops publishing.",
    terms: "platform system digital data registry database portal information technology infrastructure interoperability cyber security software artificial intelligence automation algorithm capability tool online model standard obsolete",
    researchLenses: "Releases, audits and status notices of the named systems; digital-government and IT-agency announcements; security-incident disclosures; statistics-office notes on discontinued or changed series; capability assessments from standards bodies and agency technology reviews, and from major providers only when tied to the sector. Prefer official IT agencies, audit reports and vendor-independent assessments; rank vendor marketing lowest. A development from another jurisdiction counts here when it bears on a named commitment. A new capability is this room's business whether or not the plan yet depends on it; it goes to room 10 only when it comes with a dated application or closing window.",
  },
  {
    id: 3,
    short: "Assumptions",
    name: "The story of how change happens",
    question: "Is the plan's own causal story still true?",
    why: "Every strategy assumes a chain: if we do X, Y will follow. When that chain is false, more activity will not save the document. This room holds the plan's bets and its stated preconditions and asks whether the mechanism holds, not what others did (that is room 9).",
    looksFor: "The explicit and implicit bets, the stated preconditions (provided that, on condition that), the theory of change, the review and revision clauses that say when the plan will reconsider itself, and evidence about the mechanism itself: does this kind of intervention produce this kind of result, here or in comparable settings.",
    ifEmpty: "You have not named the bets. The document is being treated as a to-do list.",
    example: "The plan bets that a new service will be used once it exists; an impact evaluation of the same model in a comparable setting finds uptake below a fifth.",
    terms: "assumption premise precondition depends condition provided expected result theory logic causal contribute leads intervention rationale effect mechanism because therefore review clause revision cycle",
    researchLenses: "Impact evaluations, systematic reviews and evidence syntheses that test the same intervention type; national evaluations in the jurisdiction; evaluation-office and IGO evidence reports; audit findings on the logic of similar programmes. Queries are built from the bets' claims, not the room's name. Prefer evaluation offices, peer-reviewed reviews and IGO evidence portals. An evaluation showing the intervention type fails belongs here even when it comes from abroad; what another jurisdiction did is room 9.",
  },
  {
    id: 4,
    short: "Delivery",
    name: "Whether the work is getting done",
    question: "Is the plan being done as written, on time?",
    why: "This is ordinary monitoring. It matters. It is not the same as asking whether the plan is still the right plan, and this room must never be allowed to answer that second question. It also holds the commitments whose only stated dependence is that someone does them.",
    looksFor: "Progress and annual implementation reports, audit findings, procurement notices for planned actions, milestones missed, parliamentary answers, slipped studies and trainings; the monitoring and reporting machinery itself.",
    ifEmpty: "Nobody is scoring the published plan. Delivery is not rated, not green.",
    example: "The first annual implementation report says four of twelve measures have started; the audit office finds the coordinating body never met.",
    terms: "action plan implementation implementing milestone deadline responsible expected result evaluation stage indicator target output progress report monitoring achieved completed delayed procurement contract tender timetable",
    researchLenses: "Only material about this strategy's own implementation: the responsible institutions' progress and annual reports, audit-office reports, procurement portals for the named actions, parliamentary questions and answers, budget-execution reports naming the strategy or its programmes. Prefer official reports; a press report of a delay is a lead, not a reading, and is labelled as press. Only this jurisdiction counts. Nothing about the world at large.",
  },
  {
    id: 5,
    short: "Resources",
    name: "Money and people",
    question: "Are the money, staff and capacity still there?",
    why: "A plan that outlives its budget is a wish. Staff, absorption capacity, counterpart funds and the conditions a funder attaches to its money are as real as appropriations, and funding windows close on a date whether or not the plan named it.",
    looksFor: "Budget laws and amendments, allocations to the named programmes, funding windows closing and successor programmes, co-financing and counterpart commitments, funders' conditions and programming decisions, staffing and vacancy, absorption and disbursement rates.",
    ifEmpty: "The fiscal cliff will arrive whether or not you named it.",
    example: "The external programme the plan counts on for a third of its cost closes a year before the plan ends, and no successor window is named.",
    terms: "budget funding financing allocation allocated cost expenditure resource capacity staff personnel vacancy absorption cofinancing sustainability appropriation grant loan disbursement envelope conditionality",
    researchLenses: "Budget laws, rectifications and ministry budget notes; funders' programme documents, programming decisions and disbursement data; staffing and vacancy reports; audit-office findings on absorption. Prefer the finance ministry, funder portals, the audit office and the official gazette. Tag a funder by mechanism: its money and the conditions on it land here, its binding rules in room 1 or 6, its non-binding strategies in room 9.",
  },
  {
    id: 6,
    short: "Mandate",
    name: "Who is allowed to act",
    question: "Does the body responsible still have the mandate, the domestic legal frame and the political backing to act, and is it using them?",
    why: "A strategy without a sitting coordinating body, or whose own legal frame forbids or now requires something the text never foresaw, cannot be delivered by effort alone. Elections and reorganisations change owners without changing the text. This room holds the rules the owner can change; rules set above it sit in room 1.",
    looksFor: "The legal basis and adopting instrument, the coordinating body and its composition, responsibilities assigned to named institutions, laws, ordinances and decisions the plan promises to pass or depends on; machinery-of-government changes; elections, coalition programmes and ministerial changes; court rulings in the sector.",
    ifEmpty: "The organogram and the rulebook are unwatched. That is how a strategy dies quietly, or becomes unlawful without anyone noticing.",
    example: "The ministry named as coordinator is merged into another after an election, and the decision that founded the strategy's committee is not carried over.",
    terms: "institutional mandate coordination coordinating committee council ministry legal law decision regulation ordinance government responsibility competence governance framework minister election parliament court adopted amended reorganisation",
    researchLenses: "The jurisdiction's official gazette and legislative trackers for domestic instruments, including the law that transposes a rule set above it; government reorganisation decisions; election results and government programmes; court decisions in the sector; minutes or notices of the coordinating body. Prefer official journals, parliament and government portals. Only this jurisdiction counts. The rule from above is room 1; the domestic law that transposes it is here.",
  },
  {
    id: 7,
    short: "Legitimacy",
    name: "Who actually benefits",
    question: "Do the people the plan names receive what it promises, and do they still back it?",
    why: "Coverage averages hide exclusion. A measure that reaches the capital and not the named group is a failed measure, not a communications issue, and a plan its beneficiaries have never heard of has no constituency when it needs one.",
    looksFor: "Target groups and beneficiaries by name, equity and inclusion commitments, participation and consultation mechanisms, reach and uptake targets; uptake and reach by group, trust and awareness, complaints, civil-society position, distributional effects, sustained public-opinion movement on the sector.",
    ifEmpty: "The plan claims equity and nobody is measuring who is missed.",
    example: "A national survey finds the group the plan is written for has never heard of its flagship service; an equality body opens an inquiry into a named measure.",
    terms: "vulnerable disadvantaged rural inclusion participation access equity beneficiary trust consultation excluded reach uptake disability minority poverty gender survey opinion complaint ombudsman civil society stakeholder",
    researchLenses: "Official and reputable surveys; ombudsman and equality-body reports; civil-society shadow reports from organisations with a track record; uptake statistics by group; official consultation records. Prefer the statistics office, the ombudsman and established civil-society organisations; media sentiment is a lead to confirm through a survey or a report, not a finding.",
  },
  {
    id: 8,
    short: "Risks",
    name: "Events that should reopen the document",
    question: "Has an event happened, or a threshold been crossed, that the plan itself cannot absorb?",
    why: "Some events are not more of the same. They are reasons to rewrite, not to file an after-action report, and the plan should have agreed the line in advance. The plan's own risk list says what it feared; the red lines say what was agreed.",
    looksFor: "The strategy's own risk list and risk chapter, contingencies, scenario assumptions, stated tolerances; declared emergencies and shocks in the sector, incidents and losses above a stated threshold, compound crises, court rulings that stop a named instrument, red lines agreed in advance.",
    ifEmpty: "There is no agreed red line. A shock will be treated as weather.",
    example: "A declared national emergency in the sector halfway through the horizon, or a loss that exceeds the plan's own contingency.",
    terms: "risk threat vulnerability threshold exposure crisis emergency loss damage adverse scenario mitigation severity incident shock disruption contingency escalation tolerance ruling litigation scandal strike collapse breach suspension",
    researchLenses: "Declared emergencies and shocks in the sector; incident and loss reports; court rulings and regulator sanctions that stop or suspend a named institution, instrument or programme; market or price collapses; industrial action; data breaches in the sector; official risk assessments and situation reports. Prefer official sources for any figure: statistics offices, courts and regulators, and IGO situation reports; for the event itself, major press with an official source. A finding here carries a date and a size; a slow trend belongs in room 1. Only this jurisdiction counts.",
  },
  {
    id: 9,
    short: "Evidence",
    name: "What others have learned",
    question: "Has new evidence, a peer's strategy, a framework we align to or an adjacent plan made our text outdated?",
    why: "A strategy does not live alone. Other jurisdictions adopt instruments ours lacks, evaluations of ours and theirs are published, frameworks the text aligns to are revised, and adjacent domestic strategies change what ours must fit with. Non-binding guidance belongs here; binding rules belong in room 1 or 6.",
    looksFor: "Commitments to align with named non-binding frameworks, to benchmark, to evaluate and to learn; other jurisdictions' strategies adopted since ours and their evaluations, reviews of this strategy, adjacent domestic strategies, benchmarks, IGO guidance and comparative reviews.",
    ifEmpty: "You will learn what others tried from a conference, not from a watchpoint.",
    example: "A neighbouring jurisdiction's strategy adopted since ours introduces an instrument ours lacks; the framework the plan aligns to publishes a successor with a different indicator set.",
    terms: "study evaluation report review recommendation guidance comparison benchmark practice peer international regional lesson learned adjacent strategy roadmap framework alignment evidence research",
    researchLenses: "Peer national or organisational strategies in the same domain adopted since the strategy, and their evaluations; evaluations and mid-term reviews of this strategy; the secretariats of the frameworks the text names; IGO comparative reviews and guidance; adjacent domestic strategies; academic syntheses. Skip the strategy under review itself. This room's peer query deliberately omits the jurisdiction, and it is the only room where a source about another jurisdiction is a finding rather than a re-file. A binding successor instrument is room 1 or 6, not here.",
  },
  {
    id: 10,
    short: "Opportunity",
    name: "Windows you would regret missing",
    question: "Is there a new window, fund, instrument or partnership that would change what this plan should do?",
    why: "Living documents are not only about threat. A new fund, a new instrument, a partnership window can justify an amendment without anything having failed, and windows close on a date.",
    looksFor: "Pilots, new instruments the plan intends to introduce, partnerships it intends to seek, funding it intends to apply for, options it names but defers; new funds and calls open to this jurisdiction, new instruments and facilities, partnerships and coalitions, technology options presented as options rather than dependencies.",
    ifEmpty: "The plan can only say no. It has no way to say yes to a new window.",
    example: "A funding call opens for exactly the measure the plan could not finance, closing in four months.",
    terms: "opportunity instrument window programme call grant partnership innovation emerging potential initiative facility new option pilot launch announce eligible closing apply",
    researchLenses: "Funders' calls and programme launches; new instruments and partnerships open to the jurisdiction; IGO initiatives with an application window; pilots and instruments elsewhere that a named commitment could adopt. Prefer funder portals and official announcements; every finding here should carry a closing date where one exists. A capability the plan already relies on is room 2; a general trend is room 1. A development from elsewhere counts when it bears on a named commitment.",
  },
] as const;

export type CategoryGuide = (typeof CATEGORY_GUIDE)[number];

export function categoryGuide(id: number): CategoryGuide {
  return CATEGORY_GUIDE.find((c) => c.id === id) ?? CATEGORY_GUIDE[0]!;
}
