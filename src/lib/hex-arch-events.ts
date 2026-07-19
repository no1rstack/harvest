type RequestEventPayload = {
  appSlug: string;
  method: string;
  path: string;
  statusCode: number;
  responseTimeMs: number;
  ipHash?: string;
  botScore?: number;
  traceId?: string;
  timestamp: string;
};

export function emitHexArchRequestEvent(
  payload: Omit<RequestEventPayload, "timestamp"> & { timestamp?: string },
) {
  const url = (process.env.HEX_ARCH_EVENTS_URL ?? "").trim();
  const token = (process.env.HEX_ARCH_EVENTS_TOKEN ?? "").trim();
  if (!url || !token || !payload.ipHash) return;

  const body: RequestEventPayload = {
    ...payload,
    timestamp: payload.timestamp ?? new Date().toISOString(),
  };

  void fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  }).catch((error) => {
    if (process.env.HEX_ARCH_EVENTS_DEBUG === "true") {
      console.warn(
        "[hex-arch:events] emit failed:",
        error instanceof Error ? error.message : String(error),
      );
    }
  });
}
