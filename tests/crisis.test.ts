import { describe, expect, it } from "vitest";
import { isCrisisIntent } from "../src/crisis";

describe("isCrisisIntent (Phase 3B)", () => {
  it("matches hotline-intent phrases", () => {
    expect(isCrisisIntent("I want to kill myself")).toBe(true);
    expect(isCrisisIntent("thinking about suicide tonight")).toBe(true);
    expect(isCrisisIntent("I am suicidal")).toBe(true);
    expect(isCrisisIntent("self-harm urges")).toBe(true);
    expect(isCrisisIntent("self harm")).toBe(true);
    expect(isCrisisIntent("I want to die")).toBe(true);
    expect(isCrisisIntent("going to end my life")).toBe(true);
    expect(isCrisisIntent("better off dead")).toBe(true);
    expect(isCrisisIntent("take my own life")).toBe(true);
  });

  it("does not match catalog topics", () => {
    expect(isCrisisIntent("trauma worksheets")).toBe(false);
    expect(isCrisisIntent("bpd skills")).toBe(false);
    expect(isCrisisIntent("suicidality papers")).toBe(false);
    expect(isCrisisIntent("crisis intervention research")).toBe(false);
    expect(isCrisisIntent("")).toBe(false);
    expect(isCrisisIntent("  ")).toBe(false);
  });
});
