// Server only. Every model call goes to Claude through the Anthropic Messages API, with tools.
// Docs: https://docs.anthropic.com/en/api/messages
//
// Until Oct 10, 2026 the calls went through MeshAPI (OpenAI-compatible chat completions). That code is
// kept below, commented out; the rest of the app still speaks the same OpenAI-style messages, and
// toAnthropic()/fromAnthropic() translate them.

export const ANTHROPIC_BASE = "https://api.anthropic.com/v1";
export const PROVIDER = "Anthropic API";
export const modelConfigured = (): boolean => Boolean(process.env.ANTHROPIC_API_KEY);
/** Opus 5.5: in our test runs it gave the plainest reasons and caught the burn address. Sonnet 5.5 is the fallback. */
export const primaryModel = (): string => process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
export const fallbackModel = (): string => process.env.ANTHROPIC_FALLBACK_MODEL || "claude-sonnet-5-5";

// MeshAPI (kept, not used):
// export const MESH_BASE = "https://api.meshapi.ai/v1";
// export const meshConfigured = (): boolean => Boolean(process.env.MESH_API_KEY);
// export const meshModel = (): string => process.env.MESH_MODEL || "anthropic/claude-opus-5.5";
// export const meshFallbackModel = (): string => process.env.MESH_FALLBACK_MODEL || "anthropic/claude-sonnet-5";

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** One content part: text, or an image as a data: URL (for photos and scans of invoices). */
export type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Part[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

/** One step of the transcript kept for the decision log (tool names and arguments, no prompts). */
export interface ToolStep {
  tool: string;
  args: unknown;
}

/** Which model answered the last call (the fallback, if the primary failed). */
export let lastModel = "";

// ------------------------------------------------------------------ OpenAI-style messages <-> Anthropic

type Block =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

function partsToBlocks(content: string | Part[] | null): Block[] {
  if (content == null) return [];
  if (typeof content === "string") return content.trim() ? [{ type: "text", text: content }] : [];
  return content.flatMap((p): Block[] => {
    if (p.type === "text") return p.text.trim() ? [{ type: "text", text: p.text }] : [];
    const m = /^data:([^;,]+);base64,(.*)$/s.exec(p.image_url.url);
    if (!m) throw new Error("images must be data: URLs");
    return [{ type: "image", source: { type: "base64", media_type: m[1]!, data: m[2]! } }];
  });
}

/** The system prompt apart; tool results become user turns; turns of the same role are merged, as Anthropic requires. */
export function toAnthropic(messages: Message[]): { system: string; messages: { role: "user" | "assistant"; content: Block[] }[] } {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join("\n\n");
  const out: { role: "user" | "assistant"; content: Block[] }[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    let role: "user" | "assistant";
    let blocks: Block[];
    if (m.role === "tool") {
      role = "user";
      blocks = [{ type: "tool_result", tool_use_id: m.tool_call_id ?? "", content: typeof m.content === "string" ? m.content : "" }];
    } else if (m.role === "assistant") {
      role = "assistant";
      blocks = partsToBlocks(m.content);
      for (const c of m.tool_calls ?? []) {
        let input: unknown = {};
        try {
          input = JSON.parse(c.function.arguments || "{}");
        } catch {
          // Sent back as {} so the conversation stays valid; the tool already answered with an error.
        }
        blocks.push({ type: "tool_use", id: c.id, name: c.function.name, input });
      }
      if (!blocks.length) blocks = [{ type: "text", text: "(no answer)" }];
    } else {
      role = "user";
      blocks = partsToBlocks(m.content);
      if (!blocks.length) continue;
    }
    const last = out[out.length - 1];
    if (last && last.role === role) {
      // Tool results must come first in a user turn.
      last.content = role === "user" ? [...last.content.filter((b) => b.type === "tool_result"), ...blocks.filter((b) => b.type === "tool_result"), ...last.content.filter((b) => b.type !== "tool_result"), ...blocks.filter((b) => b.type !== "tool_result")] : [...last.content, ...blocks];
    } else out.push({ role, content: blocks });
  }
  return { system, messages: out };
}

/** Claude's answer as an OpenAI-style assistant message: text, and tool_use blocks as tool_calls. */
export function fromAnthropic(res: { content?: { type: string; text?: string; id?: string; name?: string; input?: unknown }[] }): Message {
  const blocks = res.content ?? [];
  const text = blocks.filter((b) => b.type === "text" && b.text).map((b) => b.text).join("\n");
  const calls: ToolCall[] = blocks
    .filter((b) => b.type === "tool_use")
    .map((b) => ({ id: b.id ?? "", type: "function", function: { name: b.name ?? "", arguments: JSON.stringify(b.input ?? {}) } }));
  return { role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) };
}

async function claude(
  model: string,
  messages: Message[],
  tools: ToolSpec[],
  opts: { maxTokens: number; timeoutMs: number },
): Promise<Message> {
  lastModel = model;
  const body = toAnthropic(messages);
  const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      system: body.system,
      messages: body.messages,
      tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
      // "auto" only: current Claude models reject a forced tool_choice ("tool" or "any").
      tool_choice: { type: "auto" },
      // No temperature: the rules and the contract are the deterministic part.
      max_tokens: opts.maxTokens,
    }),
    signal: AbortSignal.timeout(opts.timeoutMs),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return fromAnthropic((await res.json()) as Parameters<typeof fromAnthropic>[0]);
}

async function chat(messages: Message[], tools: ToolSpec[]): Promise<Message> {
  try {
    return await claude(primaryModel(), messages, tools, { maxTokens: 2000, timeoutMs: 90_000 });
  } catch (err) {
    if (fallbackModel() === primaryModel()) throw err;
    return claude(fallbackModel(), messages, tools, { maxTokens: 2000, timeoutMs: 90_000 });
  }
}

// MeshAPI (kept, not used):
// async function chatWith(model: string, messages: Message[], tools: ToolSpec[]): Promise<Message> {
//   lastModel = model;
//   const res = await fetch(`${MESH_BASE}/chat/completions`, {
//     method: "POST",
//     headers: { authorization: `Bearer ${process.env.MESH_API_KEY}`, "content-type": "application/json" },
//     body: JSON.stringify({
//       model,
//       messages,
//       tools: tools.map((t) => ({ type: "function", function: t })),
//       tool_choice: "auto",
//       // No temperature: current Claude models reject it. The rules and the contract are the deterministic part.
//       max_tokens: 2000,
//     }),
//     signal: AbortSignal.timeout(90_000),
//   });
//   if (!res.ok) throw new Error(`MeshAPI ${res.status}: ${(await res.text()).slice(0, 300)}`);
//   const out = (await res.json()) as { choices?: { message?: Message }[] };
//   const message = out.choices?.[0]?.message;
//   if (!message) throw new Error("MeshAPI returned no message");
//   return message;
// }

/**
 * A bounded tool loop. The model may call the read-only tools in `handlers`; calling `finish` ends
 * the loop and returns its arguments. Returns null if the model never finishes within `maxSteps`.
 */
export async function toolLoop<T>(opts: {
  system: string;
  user: string;
  tools: ToolSpec[];
  handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>>;
  finish: ToolSpec;
  maxSteps?: number;
}): Promise<{ result: T | null; steps: ToolStep[] }> {
  const messages: Message[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user },
  ];
  const steps: ToolStep[] = [];
  for (let i = 0; i < (opts.maxSteps ?? 6); i++) {
    const msg = await chat(messages, [...opts.tools, opts.finish]);
    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });
    const calls = msg.tool_calls ?? [];
    if (!calls.length) {
      messages.push({ role: "user", content: `Call ${opts.finish.name} now with one decision per claim.` });
      continue;
    }
    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        // Malformed arguments are answered with an error below.
      }
      steps.push({ tool: call.function.name, args });
      if (call.function.name === opts.finish.name) return { result: args as T, steps };
      const handler = opts.handlers[call.function.name];
      const output = handler ? await handler(args).catch((e: unknown) => ({ error: String(e) })) : { error: "unknown tool" };
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(output) });
    }
  }
  return { result: null, steps };
}

/**
 * One call that must answer through `tool`; its arguments are the result. Current Claude models reject a
 * forced tool_choice, so this asks with "auto" and an explicit instruction, nudges once if the model
 * answers in text, then tries the fallback model.
 */
export async function callTool<T>(opts: {
  system: string;
  content: string | Part[];
  tool: ToolSpec;
  maxTokens?: number;
}): Promise<T> {
  const attempt = async (model: string) => {
    const messages: Message[] = [
      { role: "system", content: `${opts.system}\nAnswer only by calling the ${opts.tool.name} tool.` },
      { role: "user", content: opts.content },
    ];
    for (let turn = 0; turn < 2; turn++) {
      const message = await claude(model, messages, [opts.tool], { maxTokens: opts.maxTokens ?? 2000, timeoutMs: 120_000 });
      const call = message.tool_calls?.find((c) => c.function.name === opts.tool.name);
      if (call) return JSON.parse(call.function.arguments) as T;
      messages.push({ role: "assistant", content: message.content ?? "" }, { role: "user", content: `Call ${opts.tool.name} now.` });
    }
    throw new Error("the model did not answer with the tool");
  };
  try {
    return await attempt(primaryModel());
  } catch (err) {
    if (fallbackModel() === primaryModel()) throw err;
    return attempt(fallbackModel());
  }
}

// MeshAPI (kept, not used): the same asking, through MeshAPI's OpenAI-compatible endpoint.
// const attempt = async (model: string) => {
//   lastModel = model;
//   const messages: unknown[] = [
//     { role: "system", content: `${opts.system}\nAnswer only by calling the ${opts.tool.name} tool.` },
//     { role: "user", content: opts.content },
//   ];
//   for (let turn = 0; turn < 2; turn++) {
//     const res = await fetch(`${MESH_BASE}/chat/completions`, {
//       method: "POST",
//       headers: { authorization: `Bearer ${process.env.MESH_API_KEY}`, "content-type": "application/json" },
//       body: JSON.stringify({
//         model,
//         messages,
//         tools: [{ type: "function", function: opts.tool }],
//         tool_choice: "auto",
//         max_tokens: opts.maxTokens ?? 2000,
//       }),
//       signal: AbortSignal.timeout(120_000),
//     });
//     if (!res.ok) throw new Error(`MeshAPI ${res.status}: ${(await res.text()).slice(0, 300)}`);
//     const out = (await res.json()) as { choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[] };
//     const message = out.choices?.[0]?.message;
//     const call = message?.tool_calls?.find((c) => c.function.name === opts.tool.name);
//     if (call) return JSON.parse(call.function.arguments) as T;
//     messages.push(
//       { role: "assistant", content: message?.content ?? "" },
//       { role: "user", content: `Call ${opts.tool.name} now.` },
//     );
//   }
//   throw new Error("the model did not answer with the tool");
// };
