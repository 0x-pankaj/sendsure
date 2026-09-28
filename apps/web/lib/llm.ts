// Server only. Every model call goes through MeshAPI (OpenAI-compatible chat completions + tools).
// Docs: https://developers.meshapi.ai (Tool Calling, Structured Output).

export const MESH_BASE = "https://api.meshapi.ai/v1";
export const meshConfigured = (): boolean => Boolean(process.env.MESH_API_KEY);
export const meshModel = (): string => process.env.MESH_MODEL || "anthropic/claude-sonnet-4.6";

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

async function chat(messages: Message[], tools: ToolSpec[]): Promise<Message> {
  const res = await fetch(`${MESH_BASE}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.MESH_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: meshModel(),
      messages,
      tools: tools.map((t) => ({ type: "function", function: t })),
      tool_choice: "auto",
      temperature: 0,
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
