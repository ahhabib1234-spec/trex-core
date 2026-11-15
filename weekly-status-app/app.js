(function () {
  const WR = window.WeeklyReport;
  const $ = (id) => document.getElementById(id);

  const els = {
    form: $("form"),
    start: $("start"),
    end: $("end"),
    error: $("error"),
    placeholder: $("placeholder"),
    report: $("report"),
    pill: $("status-pill"),
    period: $("period"),
    reasons: $("reasons"),
    sections: $("sections"),
    coverage: $("coverage"),
    copy: $("copy"),
    download: $("download"),
    clear: $("clear"),
  };

  let lastReport = null;
  let lastMarkdown = "";

  function shiftDays(date, days) {
    const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
    return copy;
  }

  function setDefaultDates() {
    const today = new Date();
    els.end.value = WR.dayKey(today);
    els.start.value = WR.dayKey(shiftDays(today, -6));
  }

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === "className") node.className = value;
      else node.textContent = value;
    }
    for (const child of children) node.append(child);
    return node;
  }

  function showError(message) {
    els.error.textContent = message;
    els.error.hidden = false;
  }

  function clearError() {
    els.error.textContent = "";
    els.error.hidden = true;
  }

  function readSources() {
    return [
      { name: "Teams", kind: "chat", text: $("teams").value },
      { name: "Outlook", kind: "email", text: $("outlook").value },
      { name: "Atlassian", kind: "page", text: $("page").value },
      { name: "Notes", kind: "chat", text: $("notes").value },
    ];
  }

  function formatPeriod(start, end) {
    const fmt = (key) => {
      const [y, m, d] = key.split("-").map(Number);
      return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    };
    return `${fmt(start)} to ${fmt(end)}`;
  }

  function renderEntry(entry) {
    const meta = [entry.sources.join(", "), entry.day || "no date"].join(", ");
    const text = entry.context ? `${entry.text} [${entry.context}]` : entry.text;
    return el("li", {}, [el("span", { textContent: text }), el("span", { className: "meta", textContent: `(${meta})` })]);
  }

  function renderReport(report) {
    lastReport = report;
    lastMarkdown = WR.toMarkdown(report);

    els.placeholder.hidden = true;
    els.report.hidden = false;
    els.pill.textContent = report.status.level;
    els.pill.className = `pill ${report.status.level}`;
    els.period.textContent = formatPeriod(report.period.start, report.period.end);

    els.reasons.replaceChildren(...report.status.reasons.map((reason) => el("li", { textContent: reason })));

    const sections = WR.SECTIONS.map(([key, title]) => {
      const entries = report.groups[key];
      const body = entries.length
        ? el("ul", { className: "items" }, entries.map(renderEntry))
        : el("p", { className: "empty", textContent: "None found in the provided sources." });
      return [el("h3", { textContent: title }), body];
    }).flat();
    els.sections.replaceChildren(...sections);

    const coverage = report.sourceStats.map((stat) =>
      el("li", { textContent: `${stat.name}: ${stat.used} item(s) used, ${stat.excluded} outside the date range` })
    );
    if (report.undated) {
      coverage.push(el("li", { textContent: `${report.undated} item(s) had no date and were included` }));
    }
    els.coverage.replaceChildren(...coverage);
  }

  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    clearError();

    const start = els.start.value;
    const end = els.end.value;
    if (!start || !end) {
      showError("Choose both a week start and a week end date.");
      return;
    }
    if (start > end) {
      showError("The week start must be on or before the week end.");
      return;
    }

    const sources = readSources();
    if (sources.every((src) => !src.text.trim())) {
      showError("Paste at least one of the Teams, Outlook, Atlassian, or notes inputs.");
      return;
    }

    renderReport(WR.buildReport({ start, end, sources }));
  });

  els.copy.addEventListener("click", async () => {
    if (!lastMarkdown) return;
    try {
      await navigator.clipboard.writeText(lastMarkdown);
      els.copy.textContent = "Copied";
      setTimeout(() => (els.copy.textContent = "Copy Markdown"), 1500);
    } catch (_err) {
      showError("Copy failed. Use Download .md instead.");
    }
  });

  els.download.addEventListener("click", () => {
    if (!lastReport) return;
    const blob = new Blob([lastMarkdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `weekly-status_${lastReport.period.start}_to_${lastReport.period.end}.md`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });

  els.clear.addEventListener("click", () => {
    for (const id of ["teams", "outlook", "page", "notes"]) $(id).value = "";
    clearError();
  });

  setDefaultDates();
})();
