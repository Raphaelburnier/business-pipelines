import { describe, expect, it } from "vitest";

globalThis.window = {
  location: { pathname: "/", search: "" },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {},
  removeEventListener() {},
} as never;

import { lireRoute } from "./App";

function route(pathname: string) {
  window.location.pathname = pathname;
  window.location.search = "";
  return lireRoute();
}

describe("lireRoute", () => {
  it("lit la page Run et conserve les autres routes", () => {
    expect(route("/run")).toEqual({ type: "run", runId: null });
    expect(route("/run/")).toEqual({ type: "run", runId: null });
    expect(route("/run/run-2026-10-20")).toEqual({ type: "run", runId: "run-2026-10-20" });
    expect(route("/run/metier%3Adev")).toEqual({ type: "run", runId: "metier:dev" });
    expect(route("/runs/run-2026-10-20")).toEqual({ type: "detail", selection: { type: "run", id: "run-2026-10-20" } });
    expect(route("/run/a/b")).toEqual({ type: "inconnue" });
    expect(() => route("/run/%E0%A4%A")).not.toThrow();
    expect(route("/run/%E0%A4%A")).toEqual({ type: "run", runId: "%E0%A4%A" });
    expect(route("/pipelines/improve-app")).toEqual({ type: "pipelines", pipelineId: "improve-app" });
  });
});
