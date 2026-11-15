(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.WeeklyReport = api;
  }
})(typeof self !== "undefined" ? self : globalThis, function () {
  const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

  const DATE_PATTERNS = [
    {
      re: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/,
      parts: (m) => [m[1], Number(m[2]) - 1, m[3]],
    },
    {
      re: new RegExp("\\b" + MONTH_RE + "\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?", "i"),
      parts: (m) => [m[3], monthIndex(m[1]), m[2]],
    },
    {
      re: new RegExp("\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+" + MONTH_RE + "\\.?\\b(?:,?\\s+(\\d{4}))?", "i"),
      parts: (m) => [m[3], monthIndex(m[2]), m[1]],
    },
    {
      re: /\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/,
      parts: (m) => [m[3], Number(m[1]) - 1, m[2]],
    },
    {
      re: /\b(\d{1,2})\/(\d{1,2})\b/,
      parts: (m) => [undefined, Number(m[1]) - 1, m[2]],
      bareSlash: true,
    },
  ];

  const HEADER_RE = /^\s*(from|sent|to|cc|bcc|subject|date|importance)\s*:/i;
  const SENT_RE = /^\s*(sent|date)\s*:/i;
  const SEPARATOR_RE = /^\s*(?:[-_=*~]{3,}|(?:[-_=*~]+\s*)?original message(?:\s*[-_=*~]+)?)\s*$/i;
  const SUBJECT_RE = /^\s*subject\s*:\s*/i;
  const WEEKDAY_RE = /\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?,?/gi;
  const TIME_RE = /\b\d{1,2}:\d{2}(\s*[ap]\.?m\.?)?/gi;

  const CLASSIFY_RULES = [
    ["blockers", /\b(blocked|blocker|blocking|waiting (?:on|for)|stuck|at risk|risks?|delayed?|slipp(?:ed|ing)|failing|failed|failures?|broken|regression (?:failures?|issues?|bugs?)|outage|escalat\w*|overdue|past due|cannot|can't|unable)\b/i],
    ["decisions", /\b(decided|decision|agreed|approved|signed off)\b/i],
    ["done", /\b(completed|done|finished|shipped|merged|resolved|closed|released|deployed|delivered|landed|fixed|passed|validated|unblocked)\b/i],
    ["next", /\b(next steps?|next|will|plan(?:ned|ning)?|todo|to-do|action items?|follow[- ]?up|tomorrow|upcoming|scheduled|due|by (?:mon|tue|wed|thu|fri|sat|sun)\w*|needs? to)\b/i],
  ];
  const RESOLVED_BLOCKER_RE = /\b(resolved|unblocked|fixed|cleared)\b/i;
  const SPEAKER_RE = /^([A-Z][\w.'-]*(?:\s[A-Z][\w.'-]*){0,2}):\s+(?=\S)/;
  const CRITICAL_RE = /\b(outage|sev ?-?1|p1|critical|customer[- ]impacting|production down|service down)\b/i;

  const SECTIONS = [
    ["done", "Accomplishments"],
    ["progress", "In progress and updates"],
    ["blockers", "Blockers and risks"],
    ["decisions", "Decisions"],
    ["next", "Next steps"],
  ];
  const CATEGORY_TO_GROUP = {
    done: "done",
    progress: "progress",
    blockers: "blockers",
    decisions: "decisions",
    next: "next",
  };

  function monthIndex(name) {
    return MONTH_NAMES.indexOf(name.slice(0, 3).toLowerCase());
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function dayKey(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function dayDistance(a, b) {
    const [ay, am, ad] = a.split("-").map(Number);
    const [by, bm, bd] = b.split("-").map(Number);
    return Math.abs(Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000;
  }

  function resolveYear(month, day, rawYear, fallbackYear, range) {
    if (rawYear !== undefined && rawYear !== "") {
      return String(rawYear).length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
    }
    if (!range || !range.start || !range.end) return fallbackYear;

    const startYear = Number(range.start.slice(0, 4));
    const endYear = Number(range.end.slice(0, 4));
    let inRange = null;
    let closest = null;
    for (let y = startYear - 1; y <= endYear + 1; y++) {
      const date = new Date(y, month, day);
      if (date.getMonth() !== month || date.getDate() !== day) continue;
      const key = dayKey(date);
      if (key >= range.start && key <= range.end) {
        inRange = y;
        continue;
      }
      const distance = dayDistance(key, key < range.start ? range.start : range.end);
      if (!closest || distance < closest.distance) closest = { y, distance };
    }
    if (inRange !== null) return inRange;
    return closest ? closest.y : fallbackYear;
  }

  function bareSlashIsDate(text, match) {
    const lineStart = text.lastIndexOf("\n", match.index - 1) + 1;
    const lineEnd = text.indexOf("\n", match.index);
    const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
    const rest = line
      .replace(match[0], " ")
      .replace(WEEKDAY_RE, " ")
      .replace(TIME_RE, " ")
      .replace(/\b(sent|date)\b/gi, " ")
      .replace(/[^a-z]/gi, "");
    return rest.length < 3;
  }

  function findDate(text, defaultYear, range) {
    const year = defaultYear ?? new Date().getFullYear();
    let best = null;
    for (const pattern of DATE_PATTERNS) {
      const m = pattern.re.exec(text);
      if (!m) continue;
      if (pattern.bareSlash && !bareSlashIsDate(text, m)) continue;
      const [rawYear, month, rawDay] = pattern.parts(m);
      const day = Number(rawDay);
      const fullYear = resolveYear(month, day, rawYear, year, range);
      const date = new Date(fullYear, month, day);
      if (Number.isNaN(date.getTime()) || date.getMonth() !== month || date.getDate() !== day) continue;
      if (!best || m.index < best.index) {
        best = { day: dayKey(date), index: m.index, length: m[0].length, raw: m[0] };
      }
    }
    return best;
  }

  function splitBlocks(text) {
    const blocks = [];
    let current = [];
    const flush = () => {
      if (current.some((line) => line.trim())) blocks.push(current);
      current = [];
    };
    for (const line of String(text || "").replace(/\r\n?/g, "\n").split("\n")) {
      if (!line.trim() || SEPARATOR_RE.test(line)) {
        flush();
        continue;
      }
      current.push(line);
    }
    flush();

    const merged = [];
    let carry = [];
    for (const block of blocks) {
      if (block.every((line) => HEADER_RE.test(line))) {
        carry = carry.concat(block);
        continue;
      }
      merged.push(carry.concat(block));
      carry = [];
    }
    if (carry.length) merged.push(carry);
    return merged;
  }

  function isDateOnlyBlock(block, found) {
    if (!found || block.length !== 1) return false;
    const rest = block[0]
      .replace(found.raw, " ")
      .replace(WEEKDAY_RE, " ")
      .replace(TIME_RE, " ")
      .replace(/[^a-z]/gi, "");
    return rest.length < 3;
  }

  function headerDate(block, defaultYear, range) {
    const lines = block.filter((line) => SENT_RE.test(line));
    return lines.length ? findDate(lines.join("\n"), defaultYear, range) : null;
  }

  function isTimestampLine(line, found) {
    const rest = line
      .replace(found.raw, " ")
      .replace(TIME_RE, " ")
      .replace(WEEKDAY_RE, " ")
      .replace(/[\s:,|()\-–—]+/g, " ")
      .trim();
    if (!rest) return true;
    const words = rest.split(" ");
    return words.length <= 3 && words.every((word) => /^[A-Z][\w.'-]*$/.test(word));
  }

  function parseItems(text, source, defaultYear, range) {
    const items = [];
    let dayHeader = null;
    for (const block of splitBlocks(text)) {
      const found = findDate(block[0] || "", defaultYear, range);
      if (isDateOnlyBlock(block, found)) {
        dayHeader = found.day;
        continue;
      }
      const stamp = found && isTimestampLine(block[0], found) ? found : null;
      const dated = headerDate(block, defaultYear, range) || stamp;
      const subjectLine = block.find((line) => SUBJECT_RE.test(line));
      const contentLines = stamp ? block.slice(1) : block;
      const body = contentLines.filter((line) => !HEADER_RE.test(line)).join("\n").trim();
      if (!body) continue;
      items.push({
        source,
        day: dated ? dated.day : dayHeader,
        subject: subjectLine ? subjectLine.replace(SUBJECT_RE, "").trim() : "",
        section: "",
        text: body,
      });
    }
    return items;
  }

  function parseConfluence(text, source, defaultYear, range) {
    const items = [];
    let section = "";
    for (const raw of String(text || "").replace(/\r\n?/g, "\n").split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const heading =
        line.match(/^#{1,6}\s+(.+)$/) ||
        line.match(/^\*\*(.+?)\*\*:?$/) ||
        line.match(/^([A-Za-z][\w /&()-]{2,60}):$/);
      if (heading) {
        section = heading[1].trim();
        continue;
      }
      const stripped = line.replace(/^(?:[-*•]|\d+[.)])\s+/, "");
      const found = findDate(stripped, defaultYear, range);
      const leading = found && found.index === 0 ? found : null;
      items.push({ source, day: leading ? leading.day : null, subject: "", section, text: line });
    }
    return items;
  }

  function splitSentences(text) {
    return String(text || "")
      .split(/\n+/)
      .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z0-9])/))
      .map((s) =>
        s
          .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")
          .replace(/\*\*/g, "")
          .replace(/^(hi|hello|hey)( all| team| everyone)?[,!]\s*/i, "")
          .trim()
      )
      .filter((s) => s.split(/\s+/).length > 3 && !HEADER_RE.test(s) && !/^sent from my/i.test(s));
  }

  function classify(sentence) {
    for (const [category, re] of CLASSIFY_RULES) {
      if (!re.test(sentence)) continue;
      if (category === "blockers" && RESOLVED_BLOCKER_RE.test(sentence)) return "done";
      return category;
    }
    return "progress";
  }

  function normalizeKey(sentence) {
    return sentence.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 120);
  }

  function byDayDesc(a, b) {
    return (b.day || "").localeCompare(a.day || "");
  }

  function computeStatus(groups, hasContent) {
    if (!hasContent) {
      return { level: "UNKNOWN", reasons: ["No content found in the selected date range."] };
    }
    const blockers = groups.blockers;
    const critical = blockers.some((entry) => CRITICAL_RE.test(entry.text));
    if (critical || blockers.length >= 3) {
      return {
        level: "RED",
        reasons: [
          critical ? "A critical item is flagged in blockers and risks." : `${blockers.length} blockers and risks need attention.`,
        ],
      };
    }
    if (blockers.length >= 1) {
      return { level: "AMBER", reasons: [`${blockers.length} blocker or risk item(s) need follow-up.`] };
    }
    return { level: "GREEN", reasons: ["No blockers or risks found in the selected sources."] };
  }

  function buildReport({ start, end, sources, defaultYear }) {
    const year = defaultYear ?? Number(start.slice(0, 4));
    const range = { start, end };
    const entries = new Map();
    const sourceStats = [];
    let excluded = 0;
    let undated = 0;

    for (const src of sources) {
      const text = String(src.text || "").trim();
      if (!text) continue;
      const items =
        src.kind === "page"
          ? parseConfluence(text, src.name, year, range)
          : parseItems(text, src.name, year, range);
      const stat = { name: src.name, items: items.length, used: 0, excluded: 0 };

      for (const item of items) {
        if (item.day && (item.day < start || item.day > end)) {
          stat.excluded++;
          excluded++;
          continue;
        }
        stat.used++;
        if (!item.day) undated++;

        for (const raw of splitSentences(item.text)) {
          let sentence = raw;
          let speaker = "";
          const speakerMatch = src.kind === "chat" ? sentence.match(SPEAKER_RE) : null;
          if (speakerMatch) {
            speaker = speakerMatch[1];
            sentence = sentence.slice(speakerMatch[0].length);
          }
          if (sentence.split(/\s+/).length <= 3) continue;

          const key = normalizeKey(sentence);
          const context = item.subject || item.section || speaker;
          let entry = entries.get(key);
          if (!entry) {
            entry = { text: sentence, category: classify(sentence), day: item.day, context, sources: [] };
            entries.set(key, entry);
          }
          if (!entry.sources.includes(src.name)) entry.sources.push(src.name);
          if (item.day && (!entry.day || item.day > entry.day)) entry.day = item.day;
          if (!entry.context && context) entry.context = context;
        }
      }
      sourceStats.push(stat);
    }

    const groups = { done: [], progress: [], blockers: [], decisions: [], next: [] };
    for (const entry of entries.values()) {
      groups[CATEGORY_TO_GROUP[entry.category]].push(entry);
    }
    for (const group of Object.values(groups)) group.sort(byDayDesc);

    return {
      period: { start, end },
      status: computeStatus(groups, entries.size > 0),
      groups,
      sourceStats,
      excluded,
      undated,
    };
  }

  function formatEntry(entry) {
    const meta = [entry.sources.join(", "), entry.day || "no date"].join(", ");
    const context = entry.context ? ` [${entry.context}]` : "";
    return `- ${entry.text}${context} _(${meta})_`;
  }

  function toMarkdown(report) {
    const lines = [
      "# Weekly Status Report",
      "",
      `**Period:** ${report.period.start} to ${report.period.end}`,
      `**Overall status:** ${report.status.level}`,
      "",
      ...report.status.reasons.map((reason) => `- ${reason}`),
      "",
    ];

    for (const [key, title] of SECTIONS) {
      lines.push(`## ${title}`);
      const entries = report.groups[key];
      if (entries.length === 0) {
        lines.push("- None found in the provided sources.");
      } else {
        lines.push(...entries.map(formatEntry));
      }
      lines.push("");
    }

    lines.push("## Source coverage");
    for (const stat of report.sourceStats) {
      lines.push(`- ${stat.name}: ${stat.used} item(s) used, ${stat.excluded} outside the date range`);
    }
    if (report.undated) {
      lines.push(`- ${report.undated} item(s) had no date and were included`);
    }
    return lines.join("\n") + "\n";
  }

  return {
    SECTIONS,
    dayKey,
    findDate,
    splitBlocks,
    parseItems,
    parseConfluence,
    splitSentences,
    classify,
    buildReport,
    toMarkdown,
  };
});
