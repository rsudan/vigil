import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MAX_PASSAGES, boilerplate, fold, locatorOf, readRooms, type ReadChunk } from "./room-read.ts";

const MASTHEAD = "OFFICIAL GAZETTE OF THE REPUBLIC, PART I, No. 516 bis of June 3, 2024, printed by the state press.";

// A real page puts its running header on its own line, above the text.
function chunk(page: number, body: string, documentId = 1): ReadChunk {
  return { heading: `p. ${page} · ${MASTHEAD.slice(0, 40)}`, body: `${MASTHEAD}\n${body}`, documentId };
}

/** A short document that talks about money and delivery and nothing else. */
function moneyDoc(): ReadChunk[] {
  return [
    chunk(
      1,
      "The budget allocated to the ministry for youth programmes covers staff and infrastructure at the central level, and the financing of the action plan depends on that allocation continuing.",
    ),
    chunk(
      2,
      "The institutions responsible for implementation will prepare reports monitoring the evolution of each indicator against the targets and deadlines set out in the action plan.",
    ),
    chunk(
      3,
      "Absorption of external co-financing has been slow, and the expenditure recorded against the allocation for the period was far below the sum budgeted for it.",
    ),
    chunk(4, "Young people in rural areas report the least access to the services the plan promises to deliver to them."),
    // Three of room 8's words, spread so no single sentence carries two: enough
    // to prove the room's vocabulary reaches this text, not enough to quote.
    chunk(5, "A risk register for the youth sector will be published alongside the annual report of the ministry each year."),
    chunk(6, "Any incident affecting the delivery of services will be reported to the ministry within five working days."),
    chunk(7, "The threshold for reporting to the council is set out in the annual guidance issued to every county office."),
  ];
}

describe("locatorOf", () => {
  it("keeps the page and drops the running masthead", () => {
    assert.equal(locatorOf("p. 16 · 16OFFICIAL GAZETTE OF THE REPUBLIC, PART I"), "p. 16");
    assert.equal(locatorOf("p. 12–13 · 8.2 Monitoring"), "p. 12–13");
  });
  it("keeps a real heading when the document has no pages", () => {
    assert.equal(locatorOf("Chapter 6 Financing:"), "Chapter 6 Financing:");
  });
  it("falls back to a position rather than citing a masthead", () => {
    const masthead = "OFFICIAL GAZETTE OF THE REPUBLIC, PART I, No. 516 bis of June 3, 2024, printed by the state press.";
    assert.equal(locatorOf(masthead, { index: 33, total: 97 }), "part 34 of 97");
  });
});

describe("boilerplate", () => {
  it("finds a line repeated across the document, ignoring the page number welded to it", () => {
    const junk = boilerplate(moneyDoc());
    assert.equal(junk.size, 1, "the masthead is the only repeated line");
    assert.ok([...junk][0]!.includes("official gazette of the republic"));
  });
  it("never quotes the running header as what the document says", () => {
    for (const room of readRooms(moneyDoc())) {
      for (const p of room.passages) {
        assert.ok(!/OFFICIAL GAZETTE/i.test(p.quote), `room ${room.category} quoted the masthead: ${p.quote}`);
      }
    }
  });
});

describe("readRooms", () => {
  it("quotes the document verbatim, with the page it sits on", () => {
    const resources = readRooms(moneyDoc()).find((r) => r.category === 5)!;
    assert.ok(resources.passages.length >= 1, "the document plainly speaks about money");
    const first = resources.passages[0]!;
    assert.match(first.locator, /^p\. \d+$/);
    assert.ok(first.terms_hit >= 2);
    const body = moneyDoc()
      .map((c) => c.body)
      .join(" ");
    assert.ok(body.includes(first.quote), "the quote is verbatim from the stored text");
  });

  it("says nothing rather than reaching, when the document is silent on a room", () => {
    const risks = readRooms(moneyDoc()).find((r) => r.category === 8)!;
    assert.equal(risks.passages.length, 0, "no loss, threshold or damage language in this document");
    assert.equal(risks.terms_matched, true, "three of the room's words occur, so this is silence, not a failed search");
  });

  it("separates a failed search from a silent document", () => {
    const foreign: ReadChunk[] = [
      { heading: "p. 1", body: "Strategia are ca scop cresterea participarii tinerilor la viata publica si la deciziile care ii privesc." },
      { heading: "p. 2", body: "Documentul stabileste directii de actiune pentru perioada urmatoare si indicatori pentru fiecare directie." },
    ];
    const rooms = readRooms(foreign);
    const unmatched = rooms.filter((r) => !r.terms_matched);
    assert.ok(unmatched.length >= 5, "English room terms do not match a Romanian text; that is a failed search");
    for (const r of unmatched) assert.equal(r.passages.length, 0);
  });

  it("never returns more than the cap, and never the same sentence twice", () => {
    const repeated = Array.from({ length: 6 }, (_, i) =>
      chunk(i + 1, "The budget allocation and the financing of staff capacity determine whether the expenditure planned can be delivered."),
    );
    for (const room of readRooms(repeated)) {
      assert.ok(room.passages.length <= MAX_PASSAGES, `room ${room.category} exceeded the cap`);
      const quotes = room.passages.map((p) => p.quote);
      assert.equal(new Set(quotes).size, quotes.length, `room ${room.category} repeated a sentence`);
    }
  });

  it("drops a sentence that answers more than three rooms", () => {
    const everything: ReadChunk[] = [
      chunk(
        1,
        "The institutional framework, the budget allocation, the digital platform, the risk of exclusion, the action plan indicators and the evaluation report are all governed by this coordination committee.",
      ),
      chunk(2, "Young people in rural areas report the least access to the services the plan promises to deliver to them."),
    ];
    for (const room of readRooms(everything)) {
      for (const p of room.passages) {
        assert.ok(
          !p.quote.includes("are all governed by this coordination committee"),
          `room ${room.category} quoted the sentence that answers every room`,
        );
      }
    }
  });

  it("keeps a chapter that legitimately answers several rooms", () => {
    const chapter = [
      chunk(
        1,
        "Implementation draws on the youth fund, financed by the state budget and a partner loan, which closes at the end of 2029 with no successor envelope named in this strategy.",
      ),
      chunk(2, "The council keeps its mandate under the law and meets four times a year to approve the action plan."),
    ];
    const resources = readRooms(chapter).find((r) => r.category === 5)!;
    assert.ok(resources.passages.length >= 1, "the financing sentence must survive");
    assert.match(resources.passages[0]!.quote, /successor envelope/);
  });

  it("matches a room's term however the document inflected it", () => {
    assert.equal(fold("ministries"), fold("ministry"));
    assert.equal(fold("funding"), fold("fund"));
    assert.equal(fold("allocations"), fold("allocation"));
    assert.equal(fold("services"), fold("service"));
    const doc = [
      chunk(1, "The agency coordinates fourteen ministries and reports to the council on the funding of each programme."),
      chunk(2, "Young people in rural areas report the least access to the services the plan promises to deliver to them."),
    ];
    const mandate = readRooms(doc).find((r) => r.category === 6)!;
    assert.ok(mandate.passages.length >= 1, "ministries must meet the term ministry");
  });

  it("keeps the id of the document each sentence came from", () => {
    const two = [
      chunk(1, "The budget allocated to the ministry for youth programmes covers staff and infrastructure at the central level.", 7),
      chunk(2, "The council keeps its mandate under the law and meets four times a year to approve the action plan.", 9),
    ];
    const rooms = readRooms(two);
    const resources = rooms.find((r) => r.category === 5)!;
    assert.equal(resources.passages[0]?.documentId, 7);
    const mandate = rooms.find((r) => r.category === 6)!;
    assert.equal(mandate.passages[0]?.documentId, 9);
  });

  it("is deterministic", () => {
    assert.deepEqual(readRooms(moneyDoc()), readRooms(moneyDoc()));
  });

  it("always returns all ten rooms", () => {
    assert.deepEqual(
      readRooms(moneyDoc()).map((r) => r.category),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    );
  });
});

describe("what is quotable, and what is furniture", () => {
  it("never cuts a clause away from the negation that governs it", () => {
    const doc = [
      {
        heading: "p. 9 · Chapter 6",
        body:
          "Chapter 6 Financing\nThe strategy does not provide dedicated financing for the following: the budget allocation for youth programmes covering staff, capacity and infrastructure at the central level.",
        documentId: 1,
      },
      chunk(2, "The council keeps its mandate under the law and meets four times a year to approve the action plan."),
    ];
    for (const room of readRooms(doc)) {
      for (const p of room.passages) {
        assert.ok(
          !/^the budget allocation for youth programmes/i.test(p.quote),
          `a clause was cut from its negation: ${p.quote}`,
        );
      }
    }
  });

  it("does not weld a heading onto the sentence beneath it", () => {
    const doc = [
      {
        heading: "p. 21 · 4.5",
        body:
          "4.5. Poverty, Inclusion, and Social Cohesion\nPoverty affects the vulnerable segments of the population, and access to services for rural youth is uneven.\nIncome inequality has widened over recent decades.",
        documentId: 1,
      },
      chunk(2, "The budget allocated to the ministry covers staff and infrastructure at the central level of government."),
    ];
    const legitimacy = readRooms(doc).find((r) => r.category === 7)!;
    assert.ok(legitimacy.passages.length >= 1);
    for (const p of legitimacy.passages) {
      assert.ok(!/Poverty, Inclusion, and Social Cohesion Poverty/.test(p.quote), `heading welded on: ${p.quote}`);
    }
  });

  it("never quotes a flattened table row or a column-header strip", () => {
    const doc = [
      {
        heading: "p. 67 · Annex 1",
        body:
          "Entities Measures Responsible Parties Partners Implementation Period Expected Results Evaluation Stages Indicators Targets Funding Sources\nMFTES IIS DJFT DFTMB MDLPA AAPL ANOFM NGO DGASPC ANPDCA 2024 2027 Expansion and diversification of vocational guidance activities\nSTIMULATING THE PARTICIPATION OF YOUNG PEOPLE IN THE LABOUR MARKET AND IN PUBLIC LIFE",
        documentId: 1,
      },
      chunk(2, "The budget allocated to the ministry covers staff and infrastructure at the central level of government."),
    ];
    for (const room of readRooms(doc)) {
      for (const p of room.passages) {
        assert.ok(!/Entities Measures Responsible/.test(p.quote), `column headers quoted: ${p.quote}`);
        assert.ok(!/DGASPC/.test(p.quote), `an acronym table row was quoted: ${p.quote}`);
        assert.ok(!/^STIMULATING/.test(p.quote), `an all-caps title was quoted: ${p.quote}`);
      }
    }
  });

  it("keeps a list item that begins lowercase, and drops a fragment carved out of a table cell", () => {
    const listed = [
      {
        heading: "p. 58 · Measures",
        body:
          "Measures:\n- increasing funding and access to financing in the youth sector through more substantial budget allocations for local competitions;",
        documentId: 1,
      },
      chunk(2, "The council keeps its mandate under the law and meets four times a year to approve the action plan."),
    ];
    const resources = readRooms(listed).find((r) => r.category === 5)!;
    assert.ok(
      resources.passages.some((p) => p.quote.startsWith("increasing funding")),
      "a list item is a sentence even when it begins lowercase",
    );
    const cell = [
      {
        heading: "p. 98 · Annex",
        body: "for youth in rural areas At least 1 accelerator Inclusion of the participation of rural youth in funding programs",
        documentId: 1,
      },
      chunk(2, "The council keeps its mandate under the law and meets four times a year to approve the action plan."),
    ];
    for (const room of readRooms(cell)) {
      for (const p of room.passages) {
        assert.ok(!/^for youth in rural areas/.test(p.quote), `a table-cell fragment was quoted: ${p.quote}`);
      }
    }
  });

  it("meets the words a strategy uses to state a bet", () => {
    assert.equal(fold("assumes"), fold("assumption"));
    assert.equal(fold("assumed"), fold("assumption"));
    assert.equal(fold("vulnerable"), fold("vulnerability"));
    assert.equal(fold("financial"), fold("financing"));
    assert.equal(fold("institutions"), fold("institutional"));
  });
});
