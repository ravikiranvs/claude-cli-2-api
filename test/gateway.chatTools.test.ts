import { describe, expect, it } from "vitest";
import { appendToolsToPrompt, isValidTools, resolveTools } from "../src/gateway/chatTools.js";

const weatherTool = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Get the current weather for a location",
    parameters: { type: "object", properties: { location: { type: "string" } }, required: ["location"] },
  },
};

const legacyFunction = {
  name: "get_weather",
  description: "Get the current weather for a location",
  parameters: { type: "object", properties: { location: { type: "string" } } },
};

describe("resolveTools", () => {
  it("returns undefined when neither `tools` nor `functions` is present", () => {
    expect(resolveTools({})).toBeUndefined();
  });

  it("returns `tools` when present", () => {
    expect(resolveTools({ tools: [weatherTool] })).toEqual([weatherTool]);
  });

  it("falls back to the deprecated `functions` field when `tools` is absent", () => {
    expect(resolveTools({ functions: [legacyFunction] })).toEqual([legacyFunction]);
  });

  it("prefers `tools` over `functions` when both are present", () => {
    expect(resolveTools({ tools: [weatherTool], functions: [legacyFunction] })).toEqual([weatherTool]);
  });
});

describe("isValidTools", () => {
  it("accepts undefined (the field is optional)", () => {
    expect(isValidTools(undefined)).toBe(true);
  });

  it("accepts an array", () => {
    expect(isValidTools([weatherTool])).toBe(true);
  });

  it("accepts an empty array", () => {
    expect(isValidTools([])).toBe(true);
  });

  it("rejects a non-array value", () => {
    expect(isValidTools("not an array")).toBe(false);
    expect(isValidTools({})).toBe(false);
    expect(isValidTools(42)).toBe(false);
  });
});

describe("appendToolsToPrompt", () => {
  it("returns the prompt unchanged when there are no tools", () => {
    expect(appendToolsToPrompt("user: hi", undefined)).toBe("user: hi");
    expect(appendToolsToPrompt("user: hi", [])).toBe("user: hi");
  });

  it("appends the tool definitions as an intact JSON block", () => {
    const prompt = appendToolsToPrompt("user: what's the weather?", [weatherTool]);

    expect(prompt).toContain("user: what's the weather?");
    const match = /\[tools available: (.+)\]$/.exec(prompt);
    expect(match).not.toBeNull();
    expect(JSON.parse(match![1])).toEqual([weatherTool]);
  });

  it("round-trips multiple tool definitions intact", () => {
    const tools = [weatherTool, { type: "function", function: { name: "get_time", parameters: {} } }];
    const prompt = appendToolsToPrompt("user: hi", tools);

    const match = /\[tools available: (.+)\]$/.exec(prompt);
    expect(JSON.parse(match![1])).toEqual(tools);
  });
});
