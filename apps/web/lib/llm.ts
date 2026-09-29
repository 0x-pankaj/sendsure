// Server only. Every model call goes through MeshAPI (OpenAI-compatible chat completions + tools).
// Docs: https://developers.meshapi.ai (Tool Calling, Structured Output).

export const MESH_BASE = "https://api.meshapi.ai/v1";
export const meshConfigured = (): boolean => Boolean(process.env.MESH_API_KEY);
/** Opus 5.5: in our test run it gave the plainest reasons and caught the burn address. Sonnet 5 is the fallback. */
export const meshModel = (): string => process.env.MESH_MODEL || "anthropic/claude-opus-5.5";
export const meshFallbackModel = (): string => process.env.MESH_FALLBACK_MODEL || "anthropic/claude-sonnet-5";

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

interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
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

async function chat(messages: Message[], tools: ToolSpec[]): Promise<Message> {
  try {
    return await chatWith(meshModel(), messages, tools);
  } catch (err) {
    if (meshFallbackModel() === meshModel()) throw err;
    return chatWith(meshFallbackModel(), messages, tools);
  }
}

async function chatWith(model: string, messages: Message[], tools: ToolSpec[]): Promise<Message> {
  lastModel = model;
  const res = await fetch(`${MESH_BASE}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.MESH_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      tools: tools.map((t) => ({ type: "function", function: t })),
      tool_choice: "auto",
      // No temperature: current Claude models reject it. The rules and the contract are the deterministic part.
      max_tokens: 2000,
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`MeshAPI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const out = (await res.json()) as { choices?: { message?: Message }[] };
  const message = out.choices?.[0]?.message;
  if (!message) throw new Error("MeshAPI returned no message");
  return message;
}

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

/** One content part: text, or an image as a data: URL (for photos and scans of invoices). */
export type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

/**
 * One call that must answer through `tool`; its arguments are the result. Current Claude models on
 * MeshAPI reject a forced tool_choice, so this asks with "auto" and an explicit instruction, nudges
 * once if the model answers in text, then tries the fallback model.
 */
export async function callTool<T>(opts: {
  system: string;
  content: string | Part[];
  tool: ToolSpec;
  maxTokens?: number;
}): Promise<T> {
  const attempt = async (model: string) => {
    lastModel = model;
    const messages: unknown[] = [
      { role: "system", content: `${opts.system}\nAnswer only by calling the ${opts.tool.name} tool.` },
      { role: "user", content: opts.content },
    ];
    for (let turn = 0; turn < 2; turn++) {
      const res = await fetch(`${MESH_BASE}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.MESH_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          tools: [{ type: "function", function: opts.tool }],
          tool_choice: "auto",
          max_tokens: opts.maxTokens ?? 2000,
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`MeshAPI ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const out = (await res.json()) as { choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[] };
      const message = out.choices?.[0]?.message;
      const call = message?.tool_calls?.find((c) => c.function.name === opts.tool.name);
      if (call) return JSON.parse(call.function.arguments) as T;
      messages.push(
        { role: "assistant", content: message?.content ?? "" },
        { role: "user", content: `Call ${opts.tool.name} now.` },
      );
    }
    throw new Error("the model did not answer with the tool");
  };
  try {
    return await attempt(meshModel());
  } catch (err) {
    if (meshFallbackModel() === meshModel()) throw err;
    return attempt(meshFallbackModel());
  }
}
