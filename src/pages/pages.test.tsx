// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ThemeProvider } from "next-themes";

import { LandingPage } from "@/pages/LandingPage";
import { ErrorDirectoryPage } from "@/pages/ErrorDirectoryPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { ERROR_CATALOG } from "@/lib/error-catalog";
import { analyzeLog } from "@/lib/analyzer";
import { clearAnalyses, listAnalyses, saveAnalysis } from "@/lib/history";

/**
 * Page-level smoke tests. The app has no backend, so these render the real
 * components directly, which catches provider wiring mistakes and JSX errors in
 * the app shell.
 */
function renderApp(ui: React.ReactNode, initialEntries = ["/"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ThemeProvider attribute="class" defaultTheme="dark">
        {ui}
      </ThemeProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  clearAnalyses();
});

describe("LandingPage", () => {
  it("renders the hero, formats, features and the error directory section", () => {
    const { container } = renderApp(<LandingPage />);

    expect(screen.getByText(/Read your logs like the person/)).toBeTruthy();
    expect(screen.getAllByText(/Analyze a log file/).length).toBeGreaterThan(0);
    expect(screen.getByText("JSON / JSON Lines")).toBeTruthy();
    expect(screen.getByText("Nginx / Apache access")).toBeTruthy();
    expect(screen.getByText("Automatic format detection")).toBeTruthy();
    expect(screen.getByText("Error directory built in")).toBeTruthy();
    expect(container.textContent).toContain("macOS, Windows, Linux");
    // The landing page must not ask anyone to sign up.
    expect(container.textContent).not.toContain("Sign up");
    expect(container.textContent).not.toContain("Create an account");
  });

  it("shows real catalogue entries in the directory preview", () => {
    const first = ERROR_CATALOG[0];
    const { container } = renderApp(<LandingPage />);
    expect(container.textContent).toContain(first.title);
    expect(container.textContent).toContain("Why:");
    expect(container.textContent).toContain("Fix:");
  });
});

describe("ErrorDirectoryPage", () => {
  it("lists every catalogued error with its reasons and fixes", () => {
    renderApp(<ErrorDirectoryPage />);

    expect(
      screen.getByText(/Every error, why it happens, what fixes it/),
    ).toBeTruthy();
    for (const entry of ERROR_CATALOG) {
      expect(screen.getByText(entry.title)).toBeTruthy();
    }
    expect(
      screen.getByText(
        `Showing ${ERROR_CATALOG.length} of ${ERROR_CATALOG.length} entries`,
      ),
    ).toBeTruthy();
  });

  it("expands an entry to reveal why it happens and how to fix it", () => {
    const entry = ERROR_CATALOG.find((item) => item.id === "timeout")!;
    renderApp(<ErrorDirectoryPage />);

    // Expand the entry by clicking its row.
    fireEvent.click(screen.getByText(entry.title));

    expect(screen.getByText("Why it happens")).toBeTruthy();
    expect(screen.getByText("How to fix it")).toBeTruthy();
    // Reasons are also used as the collapsed preview, so match on the panel.
    const expanded = screen.getByText("Why it happens").closest("div")!;
    for (const reason of entry.reasons) {
      expect(
        within(expanded.parentElement as HTMLElement).getAllByText(reason).length,
      ).toBeGreaterThan(0);
    }
    for (const fix of entry.fixes) {
      expect(screen.getByText(fix)).toBeTruthy();
    }
  });

  it("filters by category", () => {
    renderApp(<ErrorDirectoryPage />);
    // The first match is the category filter chip, the rest are entry badges.
    fireEvent.click(screen.getAllByText("Memory & resources")[0]);

    const memoryTitle = ERROR_CATALOG.find((item) => item.id === "out-of-memory")!.title;
    const databaseTitle = ERROR_CATALOG.find((item) => item.id === "db-constraint")!.title;

    const listed = screen
      .getAllByRole("button")
      .map((button) => button.textContent ?? "");
    expect(listed.some((text) => text.includes(memoryTitle))).toBe(true);
    expect(listed.some((text) => text.includes(databaseTitle))).toBe(false);
  });
});

describe("local history", () => {
  it("keeps an analysed report in this browser without any account", async () => {
    const report = await analyzeLog(
      [
        "2024-05-01 10:00:00 ERROR [main] c.f.App - Failed to process order",
        "java.lang.NullPointerException: order is null",
        "\tat c.f.App.run(App.java:12)",
      ].join("\n"),
      { fileName: "app.log" },
    );

    const entry = saveAnalysis(report);
    expect(entry.id).toBeTruthy();
    expect(listAnalyses()).toHaveLength(1);

    const saved = listAnalyses()[0];
    expect(saved.report.fileName).toBe("app.log");
    expect(saved.report.knownProblems.length).toBeGreaterThan(0);
    expect(saved.errorCount).toBeGreaterThan(0);
  });
});

describe("DashboardPage", () => {
  it("shows the upload area, the samples and the saved reports", () => {
    renderApp(<DashboardPage />, ["/app"]);

    expect(screen.getByText("Log analyzer")).toBeTruthy();
    expect(screen.getByText(/Drop log files here/)).toBeTruthy();
    expect(screen.getByText("orders-service.log")).toBeTruthy();
    expect(screen.getByText(/Nothing yet/)).toBeTruthy();
    expect(screen.getByText(/nothing is uploaded/i)).toBeTruthy();
  });

  it("lists a saved report", async () => {
    const report = await analyzeLog(
      [
        "2024-05-01 10:00:00 ERROR [main] c.f.App - Failed to process order",
        "java.lang.NullPointerException: order is null",
      ].join("\n"),
      { fileName: "orders-service.log" },
    );
    const saved = saveAnalysis(report);

    renderApp(<DashboardPage />, ["/app"]);
    const list = within(
      screen.getByText("Saved reports").closest("section") as HTMLElement,
    );
    expect(list.getByText("orders-service.log")).toBeTruthy();
    expect(list.getByText(new RegExp(`${saved.errorCount} errors`))).toBeTruthy();
  });

  it("is reachable without signing in", () => {
    renderApp(
      <Routes>
        <Route path="/app" element={<DashboardPage />} />
      </Routes>,
      ["/app"],
    );
    expect(screen.getByText("Log analyzer")).toBeTruthy();
  });
});
