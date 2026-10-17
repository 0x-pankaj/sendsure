import { afterEach, describe, expect, it } from "vitest";
import { arcRpcUrls, arcTransport } from "../lib/rpc";

const saved = process.env.ARC_RPC_URL;
afterEach(() => {
  if (saved === undefined) delete process.env.ARC_RPC_URL;
  else process.env.ARC_RPC_URL = saved;
});

describe("Arc RPCs", () => {
  it("reads one URL, or several in order, comma-separated", () => {
    process.env.ARC_RPC_URL = " https://a.example , https://b.example,,";
    expect(arcRpcUrls()).toEqual(["https://a.example", "https://b.example"]);
    expect(arcTransport()({}).config.type).toBe("fallback");
    process.env.ARC_RPC_URL = "https://a.example";
    expect(arcTransport()({}).config.type).toBe("http");
    delete process.env.ARC_RPC_URL;
    expect(arcRpcUrls()).toEqual([]);
  });
});
