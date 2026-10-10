import { describe, expect, it } from "vitest";
import { fromAnthropic, toAnthropic, type Message } from "../lib/llm";
import { modelLabel } from "../lib/modelLabel";

describe("messages for the Anthropic API", () => {
  it("keeps the system prompt apart and turns a tool round trip into tool_use and tool_result blocks", () => {
    const messages: Message[] = [
      { role: "system", content: "You are SendSure's payables agent." },
      { role: "user", content: "Two claims to review." },
      {
        role: "assistant",
        content: "Looking at the history first.",
        tool_calls: [
          { id: "toolu_1", type: "function", function: { name: "payee_history", arguments: '{"payeeRef":"0xab"}' } },
          { id: "toolu_2", type: "function", function: { name: "treasury", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "toolu_1", content: '{"paid":1}' },
      { role: "tool", tool_call_id: "toolu_2", content: '{"balance":"2"}' },
    ];
    const out = toAnthropic(messages);
    expect(out.system).toBe("You are SendSure's payables agent.");
    expect(out.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(out.messages[1]!.content).toEqual([
      { type: "text", text: "Looking at the history first." },
      { type: "tool_use", id: "toolu_1", name: "payee_history", input: { payeeRef: "0xab" } },
      { type: "tool_use", id: "toolu_2", name: "treasury", input: {} },
    ]);
    // Both results in one user turn, as the API requires.
    expect(out.messages[2]!.content).toEqual([
      { type: "tool_result", tool_use_id: "toolu_1", content: '{"paid":1}' },
      { type: "tool_result", tool_use_id: "toolu_2", content: '{"balance":"2"}' },
    ]);
  });

  it("merges a nudge after tool results into the same user turn, results first", () => {
    const out = toAnthropic([
      { role: "user", content: "Review." },
      { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "x", arguments: "not json" } }] },
      { role: "tool", tool_call_id: "t1", content: "{}" },
      { role: "user", content: "Call finish now." },
    ]);
    expect(out.messages).toHaveLength(3);
    expect(out.messages[1]!.content).toEqual([{ type: "tool_use", id: "t1", name: "x", input: {} }]);
    expect(out.messages[2]!.content.map((b) => b.type)).toEqual(["tool_result", "text"]);
  });

  it("never sends an empty assistant turn", () => {
    const out = toAnthropic([
      { role: "user", content: "Review." },
      { role: "assistant", content: null },
      { role: "user", content: "Call finish now." },
    ]);
    expect(out.messages[1]).toEqual({ role: "assistant", content: [{ type: "text", text: "(no answer)" }] });
  });

  it("sends an invoice photo as a base64 image block", () => {
    const out = toAnthropic([
      {
        role: "user",
        content: [
          { type: "text", text: "Transcribe this invoice." },
          { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
        ],
      },
    ]);
    expect(out.messages[0]!.content).toEqual([
      { type: "text", text: "Transcribe this invoice." },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
    ]);
  });

  it("reads Claude's answer back as text and tool calls", () => {
    const msg = fromAnthropic({
      content: [
        { type: "text", text: "Holding one claim." },
        { type: "tool_use", id: "toolu_9", name: "finish", input: { decisions: [{ claimId: "0x1", action: "hold" }] } },
      ],
    });
    expect(msg.content).toBe("Holding one claim.");
    expect(msg.tool_calls).toEqual([
      { id: "toolu_9", type: "function", function: { name: "finish", arguments: '{"decisions":[{"claimId":"0x1","action":"hold"}]}' } },
    ]);
    expect(fromAnthropic({ content: [{ type: "text", text: "Only text." }] }).tool_calls).toBeUndefined();
  });

  it("names models the way people read them", () => {
    expect(modelLabel("claude-opus-5-5")).toBe("Claude Opus 5.5");
    expect(modelLabel("anthropic/claude-opus-5.5")).toBe("Claude Opus 5.5");
    expect(modelLabel("claude-sonnet-5")).toBe("Claude Sonnet 5");
    expect(modelLabel(undefined)).toBe("Claude");
  });
});
