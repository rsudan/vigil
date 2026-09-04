// @ts-check
/**
 * A synthetic national strategy long enough to force multi-pass extraction,
 * and a minimal PDF writer so the upload path is exercised with a real PDF.
 * ASCII only: the PDF text uses the standard Helvetica encoding.
 */

const COUNTIES = ["Northmarch", "Eastvale", "Southreach", "Westholm", "Central", "Lakeside", "Highland", "Coastal"];

function wrap(text, width = 92) {
  const out = [];
  for (const para of text.split("\n")) {
    if (!para.trim()) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of para.split(/\s+/)) {
      if ((line + " " + word).trim().length > width) {
        out.push(line.trim());
        line = word;
      } else {
        line = `${line} ${word}`;
      }
    }
    if (line.trim()) out.push(line.trim());
  }
  return out;
}

/** Page texts for the fixture strategy. Each page is roughly 4,000 characters. */
export function strategyPages(annexPages = 36) {
  const pages = [];
  pages.push(`NATIONAL DIGITAL TRANSFORMATION STRATEGY 2026-2032
Republic of Meridia

Chapter 1 Vision
By 2032 every resident of Meridia can reach every public service online within three clicks, and the state runs on shared data platforms that ministries trust. The strategy aims for a digital economy worth 12 percent of GDP by 2032, up from 6.5 percent in 2025. This vision depends on a national data exchange that will be in production by the end of 2028. It also assumes that the Digital Council will keep sitting every quarter and that the Digital Fund will continue to finance the action plan until 2029.

Chapter 2 Objectives
Objective 1: Universal connectivity. Every settlement above 200 residents will have fibre or fixed wireless access of at least 100 Mbps by 2029. Counties will deliver the last-mile programme on the published timetable, provided that counterpart funding of 15 percent is appropriated each year.
Objective 2: Digital public services. The 60 most used services will be redesigned as end-to-end digital journeys by 2028. Uptake is expected to reach 70 percent of transactions by 2030.
Objective 3: Data as infrastructure. The national data exchange, the population register and the address register will be production systems with published service levels.
Objective 4: Skills. Two million residents will complete a basic digital skills course by 2030; 40,000 specialists will graduate from accredited programmes.
Objective 5: Trust and security. The national cyber incident response team will reach every ministry and county within 30 minutes of a reported incident.`);

  pages.push(`Chapter 3 Theory of change
The strategy rests on a simple chain. If connectivity reaches every settlement, then residents can use digital services. If the 60 priority services are redesigned, then uptake will follow. If the data exchange is in production, then ministries will stop building their own registers. Each link in the chain is a bet. The authors expect that once a service is digital, residents will prefer it, and that counties will maintain the networks after the construction phase ends. The strategy relies on the Digital Agency to coordinate 14 ministries without a change to the machinery of government.
The theory of change does not state what happens if the data exchange slips past 2028, or if the Digital Fund is not renewed. It assumes that a three-year action plan cycle with annual reporting is sufficient to keep the document current.

Chapter 4 Pillars
Pillar A Connectivity. The programme finances backbone extensions in ${COUNTIES.join(", ")} counties. The regulator will publish coverage maps every quarter. The baseline in 2025 is 61 percent of settlements above 200 residents with 100 Mbps access.
Pillar B Services. The Digital Agency will operate a single service design team. Service redesign will follow the published journey standard. The baseline is 22 redesigned services in 2025.
Pillar C Data. The national data exchange will connect 40 base registers by 2028. The exchange was specified in 2024 and is in pilot with three registers. Completeness of the address register is not baselined.
Pillar D Skills. The basic skills course will be delivered through libraries and schools. The baseline is 320,000 completions in 2025.
Pillar E Security. The incident response team will grow from 18 to 60 staff. Mean time to reach a reported incident is not currently measured.`);

  pages.push(`Chapter 5 Governance
The Digital Council, chaired by the Prime Minister, sits quarterly and approves the annual action plan. The Digital Agency is the secretariat and coordinates 14 line ministries. County digital officers report to the Agency twice a year. The Council has met three times in 2025. The strategy assumes the Council keeps its mandate and meets at least four times a year; if the Council does not sit for six months, the action plan has no owner.
The legal frame is Law 214/2023 on digital government and Government Decision 88/2024 on data sharing. The Decision does not yet allow the address register to be corrected by counties, which the strategy treats as a legal barrier to be removed by 2027.

Chapter 6 Financing
Implementation draws on the Digital Fund, financed by the state budget and a development partner loan of 400 million, which closes on 31 December 2029. The action plan runs to 2032. No successor envelope is named for the period after the Digital Fund closes. Counties contribute 15 percent counterpart funding. The financing chapter expects the loan to be fully disbursed by 2029 and does not describe what happens to Pillar A packages that are unfinished at that date.
Annual financing needs: 2026 120 million, 2027 140 million, 2028 150 million, 2029 110 million, 2030 90 million, 2031 80 million, 2032 60 million.`);

  pages.push(`Chapter 7 Monitoring and evaluation
The strategy is monitored through annual reporting to the Digital Council and a revision of the action plan every three years, in 2029 and 2032. Progress is assessed against the 24 indicators in Annex 2. The evaluation calendar follows the government planning cycle. The document does not provide a procedure for reopening the strategy itself after a major platform outage, a legal change, or a funding cliff. A mid-term evaluation is scheduled for 30 June 2029.
Indicators are reported by the Statistics Office and the regulator. Several indicators, including address register completeness and incident response time, have no baseline and no data owner.

Chapter 8 Risks
The strategy names five risks: delayed procurement of the data exchange; county absorption capacity below plan; a cyber incident that corrupts a base register; withdrawal of the development partner loan; and low uptake of digital services among older residents. Each risk has a mitigation but no threshold at which the strategy itself would be revised. A loss of the population register for more than 14 days is treated as an operational incident, not as a reason to reopen the strategy.`);

  for (let p = 0; p < annexPages; p += 1) {
    const county = COUNTIES[p % COUNTIES.length];
    const lines = [`Annex 1 Action plan, page ${p + 1} of ${annexPages}`, ""];
    for (let a = 1; a <= 9; a += 1) {
      const n = p * 9 + a;
      const year = 2026 + ((n + p) % 6);
      lines.push(
        `Action ${p + 1}.${a}: Extend the ${county} county backbone segment ${n} to ${12 + ((n * 7) % 60)} settlements, ` +
          `procure through the framework contract, and hand over to the county operator by ${year}. Lead: ${county} county council. ` +
          `Indicative cost ${1 + ((n * 3) % 9)} million. Output indicator: settlements connected, reported quarterly. ` +
          `Dependency: counterpart funding appropriated; data exchange connector ${n % 40} available.`,
      );
    }
    lines.push("");
    lines.push(
      `Notes for page ${p + 1}: packages on this page depend on the Digital Fund and will stall if the loan is not disbursed on schedule. ` +
        `County ${county} reported ${40 + ((p * 13) % 55)} percent absorption of its 2025 allocation.`,
    );
    pages.push(lines.join("\n"));
  }

  pages.push(`Annex 2 Indicators
1. Settlements with 100 Mbps access, percent. Baseline 61 (2025). Target 100 (2029). Source: regulator.
2. Redesigned priority services, count. Baseline 22 (2025). Target 60 (2028). Source: Digital Agency.
3. Registers connected to the data exchange, count. Baseline 3 (2025). Target 40 (2028).
4. Address register completeness, percent. No baseline. Target 98 (2028).
5. Basic skills completions, cumulative. Baseline 320,000 (2025). Target 2,000,000 (2030).
6. Incident response reach time, minutes. No baseline. Target 30 (2027).
7. Digital economy share of GDP, percent. Baseline 6.5 (2025). Target 12 (2032).
8. Share of transactions completed digitally, percent. Baseline 31 (2025). Target 70 (2030).`);

  return pages;
}

function pdfEscape(s) {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/[^\x20-\x7e]/g, "?");
}

/** Build a simple multi-page PDF (Helvetica, one text block per page). */
export function makePdf(pages) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };
  const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds = [];
  const contentIds = [];
  for (const page of pages) {
    const lines = wrap(page).slice(0, 62);
    const ops = ["BT", "/F1 10 Tf", "12 TL", "40 800 Td"];
    for (const line of lines) ops.push(`(${pdfEscape(line)}) Tj T*`);
    ops.push("ET");
    const stream = ops.join("\n");
    contentIds.push(add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`));
    pageIds.push(0);
  }
  const pagesId = objects.length + pages.length + 1;
  pages.forEach((_, i) => {
    pageIds[i] = add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`,
    );
  });
  const kids = pageIds.map((id) => `${id} 0 R`).join(" ");
  const realPagesId = add(`<< /Type /Pages /Kids [${kids}] /Count ${pageIds.length} >>`);
  if (realPagesId !== pagesId) throw new Error("page tree id mismatch");
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** Plain-text companion file, for the multi-file upload path. */
export function companionMarkdown() {
  return `# Meridia digital strategy: implementation note 2026

The Digital Council met twice in 2025 instead of four times. The address register completeness has not been measured. County absorption of the 2025 allocation averaged 58 percent. The development partner has signalled that the loan will not be extended beyond 2029.
`;
}

/** Short pasted text for the paste path. */
export function pastedText() {
  return `National Climate Adaptation Roadmap 2027-2035 of the Republic of Meridia.
Vision: settlements and farms withstand a 1-in-50-year drought and flood without loss of life.
The roadmap depends on a national early-warning platform that will reach every county by 2028, and assumes that the Adaptation Fund will finance the action plan until 2031. Counties will deliver the river basin works on the published timetable. Monitoring is annual, with a revision in 2031. The roadmap does not describe what happens if the Fund is not renewed or if the warning platform is unavailable for more than 14 days. Annex 1 lists 48 actions; Annex 2 lists 16 indicators, of which 5 have no baseline.`;
}
