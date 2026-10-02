/** Anonymous usage count (browser): the event name only. Never blocks or throws. */
export function ping(event: "check_run" | "invite_open" | "try_start" | "books_download"): void {
  try {
    void fetch("/api/ping", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // counting is best effort
  }
}
