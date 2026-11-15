const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("./report.js");

test("findDate understands common date formats", () => {
  assert.equal(R.findDate("Sent: Tuesday, November 10, 2026 9:14 AM", 2026).day, "2026-11-10");
  assert.equal(R.findDate("ship it on 11/12", 2026).day, "2026-11-12");
  assert.equal(R.findDate("review 2026-11-09 agenda", 2026).day, "2026-11-09");
  assert.equal(R.findDate("Nov 9 sync", 2026).day, "2026-11-09");
  assert.equal(R.findDate("due 12th November", 2026).day, "2026-11-12");
});

test("findDate ignores text that is not a date", () => {
  assert.equal(R.findDate("the decimal 5 value", 2026), null);
  assert.equal(R.findDate("version 3.0.7 is out", 2026), null);
  assert.equal(R.findDate("may 2026 roadmap", 2026), null);
  assert.equal(R.findDate("we may be late", 2026), null);
});

test("findDate rejects impossible dates", () => {
  assert.equal(R.findDate("2026-02-31", 2026), null);
});

test("splitBlocks keeps Outlook headers attached to the body", () => {
  const text = [
    "From: Dana Lee",
    "Sent: Wednesday, November 11, 2026 8:00 AM",
    "Subject: Controller upgrade",
    "",
    "The lab upgrade is blocked on switch firmware.",
  ].join("\n");
  const blocks = R.splitBlocks(text);
  assert.equal(blocks.length, 1);
  assert.ok(blocks[0].some((line) => line.startsWith("Subject:")));
});

test("parseItems extracts email subject and date from Outlook headers", () => {
  const text = [
    "From: Dana Lee",
    "Sent: Wednesday, November 11, 2026 8:00 AM",
    "Subject: Controller upgrade",
    "",
    "The lab upgrade is blocked on switch firmware.",
  ].join("\n");
  const [item] = R.parseItems(text, "Outlook", 2026);
  assert.equal(item.day, "2026-11-11");
  assert.equal(item.subject, "Controller upgrade");
  assert.match(item.text, /blocked on switch firmware/);
});

test("parseItems inherits the day from a standalone date header", () => {
  const text = [
    "Monday, November 9, 2026",
    "",
    "Priya: Finished the API migration tests today.",
    "",
    "Tuesday, November 10, 2026",
    "",
    "Sam: Will send the rollout plan tomorrow.",
    "",
    "Sam: Build farm is still down for the nightly run.",
  ].join("\n");
  const items = R.parseItems(text, "Teams", 2026);
  assert.deepEqual(
    items.map((item) => item.day),
    ["2026-11-09", "2026-11-10", "2026-11-10"]
  );
});

test("classify sorts sentences into status categories", () => {
  assert.equal(R.classify("The 17.1 build is blocked waiting on lab access."), "blockers");
  assert.equal(R.classify("Fixed the upgrade script and merged the PR."), "done");
  assert.equal(R.classify("Decided to ship the controller update on Friday."), "decisions");
  assert.equal(R.classify("We will send the rollout deck tomorrow."), "next");
  assert.equal(R.classify("Investigating the timeout in the controller."), "progress");
});

test("classify treats a resolved blocker as done", () => {
  assert.equal(R.classify("The license blocker was resolved by the vendor."), "done");
});

test("buildReport strips chat speaker prefixes and keeps them as context", () => {
  const report = R.buildReport({
    ...WEEK,
    defaultYear: 2026,
    sources: [{ name: "Teams", kind: "chat", text: "Tuesday, November 10, 2026\n\nSam Patel: The lab switch firmware was validated on all nodes." }],
  });
  assert.equal(report.groups.done[0].text, "The lab switch firmware was validated on all nodes.");
  assert.equal(report.groups.done[0].context, "Sam Patel");
});

test("splitSentences drops greetings, signatures and very short lines", () => {
  const sentences = R.splitSentences(
    "Hi team, the firmware image passed regression. Thanks!\nSent from my iPhone\nOK"
  );
  assert.deepEqual(sentences, ["the firmware image passed regression."]);
});

const WEEK = { start: "2026-11-09", end: "2026-11-15" };

test("buildReport filters by date range and counts excluded items", () => {
  const report = R.buildReport({
    ...WEEK,
    defaultYear: 2026,
    sources: [
      {
        name: "Teams",
        kind: "chat",
        text: [
          "Tuesday, November 10, 2026",
          "",
          "Priya: The API migration was completed and merged.",
          "",
          "Monday, November 2, 2026",
          "",
          "Priya: Old update that should not appear anywhere in the report.",
        ].join("\n"),
      },
    ],
  });
  assert.equal(report.sourceStats[0].excluded, 1);
  assert.equal(report.groups.done.length, 1);
  assert.equal(report.groups.done[0].day, "2026-11-10");
  assert.equal(report.excluded, 1);
});

test("buildReport merges duplicate sentences across sources", () => {
  const report = R.buildReport({
    ...WEEK,
    defaultYear: 2026,
    sources: [
      { name: "Teams", kind: "chat", text: "Tuesday, November 10, 2026\n\nSam: The firmware image passed regression testing." },
      { name: "Outlook", kind: "email", text: "Sent: Wednesday, November 11, 2026\nSubject: Firmware\n\nThe firmware image passed regression testing." },
    ],
  });
  assert.equal(report.groups.done.length, 1);
  assert.deepEqual(report.groups.done[0].sources.sort(), ["Outlook", "Teams"]);
});

test("buildReport keeps undated items and flags them", () => {
  const report = R.buildReport({
    ...WEEK,
    defaultYear: 2026,
    sources: [{ name: "Notes", kind: "chat", text: "The vendor will confirm the lab schedule next week." }],
  });
  assert.equal(report.groups.next.length, 1);
  assert.equal(report.groups.next[0].day, null);
  assert.equal(report.undated, 1);
});

test("buildReport reads Atlassian page sections as context", () => {
  const report = R.buildReport({
    ...WEEK,
    defaultYear: 2026,
    sources: [
      {
        name: "Atlassian",
        kind: "page",
        text: [
          "## Risks",
          "- The controller certificate rollout is blocked by the customer change window.",
          "## Progress",
          "Working on the On-Prem Controller upgrade path for 17.1 and testing the migration.",
        ].join("\n"),
      },
    ],
  });
  assert.equal(report.groups.blockers.length, 1);
  assert.equal(report.groups.blockers[0].context, "Risks");
  assert.equal(report.groups.progress.length, 1);
});

test("status is RED for a critical blocker, AMBER for one blocker, GREEN otherwise", () => {
  const build = (text) =>
    R.buildReport({
      ...WEEK,
      defaultYear: 2026,
      sources: [{ name: "Teams", kind: "chat", text: `Tuesday, November 10, 2026\n\n${text}` }],
    });

  assert.equal(build("Sam: Production outage on the lab controller cluster is still open.").status.level, "RED");
  assert.equal(build("Sam: The rollout is blocked on a vendor signature.").status.level, "AMBER");
  assert.equal(build("Sam: The rollout was completed and merged yesterday.").status.level, "GREEN");
  assert.equal(build("").status.level, "UNKNOWN");
});

test("status is RED when three blockers are present", () => {
  const report = R.buildReport({
    ...WEEK,
    defaultYear: 2026,
    sources: [
      {
        name: "Teams",
        kind: "chat",
        text: [
          "Tuesday, November 10, 2026",
          "",
          "Sam: The license server is blocked by procurement.",
          "",
          "Sam: The lab switch firmware is failing the upgrade test.",
          "",
          "Sam: The docs review is overdue by two days.",
        ].join("\n"),
      },
    ],
  });
  assert.equal(report.status.level, "RED");
});

test("toMarkdown renders every section and source coverage", () => {
  const report = R.buildReport({
    ...WEEK,
    defaultYear: 2026,
    sources: [
      {
        name: "Teams",
        kind: "chat",
        text: "Tuesday, November 10, 2026\n\nSam: The controller upgrade was completed on the lab cluster.",
      },
    ],
  });
  const md = R.toMarkdown(report);
  assert.match(md, /^# Weekly Status Report/);
  assert.match(md, /\*\*Period:\*\* 2026-11-09 to 2026-11-15/);
  assert.match(md, /## Accomplishments\n- The controller upgrade was completed on the lab cluster\. \[Sam\] _\(Teams, 2026-11-10\)_/);
  assert.match(md, /## Blockers and risks\n- None found in the provided sources\./);
  assert.match(md, /## Source coverage\n- Teams: 1 item\(s\) used, 0 outside the date range/);
});
