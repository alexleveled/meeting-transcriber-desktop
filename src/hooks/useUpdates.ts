"use client";

import { useEffect, useState } from "react";
import { getUpdateClient, type UpdateClient, type UpdateState } from "@/lib/updates";

/**
 * Subscribe to update state from the main process.
 *
 * Two places render this now — the sidebar badge and the Settings panel — and both must agree, so
 * neither owns the state: the main process does, and each mount just reads it and listens. That
 * also means a badge and an open Settings page move together while a download runs.
 *
 * `client` is null outside the packaged app (a browser tab has no installer to replace, and builds
 * predating this feature expose no `updates` bridge). Callers render nothing in that case.
 */
export function useUpdates(): {
  client: UpdateClient | null;
  version: string | null;
  state: UpdateState;
} {
  const [client] = useState(() => getUpdateClient());
  const [version, setVersion] = useState<string | null>(null);
  const [state, setState] = useState<UpdateState>({ status: "idle" });

  useEffect(() => {
    if (!client) return;
    void client.version().then(setVersion);
    void client.state().then(setState);
    return client.onState(setState);
  }, [client]);

  return { client, version, state };
}
