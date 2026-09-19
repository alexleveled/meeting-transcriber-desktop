"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessageRow, ChatModel, ChatProvider, SpecialtyRow, TranscriptSegment } from "@/lib/types";

const SPECIALTY_STORAGE_KEY = "chat.specialtyId";

let nextTempId = -1;

interface ModelsResponse {
  models: Record<ChatProvider, ChatModel[]>;
  selected: { provider: ChatProvider; id: string } | null;
  fetchedAt: Record<ChatProvider, number | null>;
}

interface SseFrame {
  type: "delta" | "done" | "error";
  text?: string;
  message?: ChatMessageRow;
  error?: string;
}

/**
 * Owns the chat conversation for one session: history, streaming, model/specialty selection,
 * and overlay open/unread state. Lives above <ChatOverlay> so collapsing/reopening the panel
 * doesn't lose the thread.
 */
export function useChat({
  sessionId,
  getSegments,
  swapped,
  initialMessages,
}: {
  sessionId: string | null;
  /** Live snapshot from the recorder; omit to have the server read from the DB. */
  getSegments?: () => TranscriptSegment[];
  swapped?: boolean;
  initialMessages?: ChatMessageRow[];
}) {
  const [messages, setMessages] = useState<ChatMessageRow[]>(initialMessages ?? []);
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [unread, setUnread] = useState(false);

  const [model, setModelState] = useState<{ provider: ChatProvider; id: string } | null>(null);
  const [models, setModels] = useState<Record<ChatProvider, ChatModel[]> | null>(null);
  const [modelsLoading, setModelsLoading] = useState(true);
  // Whether every provider came back with no API key (all fetchedAt null) — drives the
  // "add an API key" hint in the input bar. Not part of the spec'd return shape but needed
  // for it, since a keyless provider still returns a non-empty curated fallback model list.
  const [hasAnyKey, setHasAnyKey] = useState(true);

  const [specialty, setSpecialtyState] = useState<SpecialtyRow | null>(null);
  const [specialties, setSpecialties] = useState<SpecialtyRow[]>([]);
  const pendingSpecialtyIdRef = useRef<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // ---- initial load: history, models, specialties -------------------------------

  useEffect(() => {
    setMessages(initialMessages ?? []);
    setError(null);
    setStreamingText("");
    setIsStreaming(false);

    if (!sessionId) return;

    if (!initialMessages) {
      (async () => {
        try {
          const res = await fetch(`/api/sessions/${sessionId}/chat`);
          if (!res.ok) return;
          const data = (await res.json()) as { messages: ChatMessageRow[] };
          setMessages(data.messages ?? []);
        } catch {
          // Non-fatal — the bar still works, just starts with an empty thread.
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    (async () => {
      setModelsLoading(true);
      try {
        const res = await fetch("/api/chat/models");
        if (!res.ok) return;
        const data = (await res.json()) as ModelsResponse;
        setModels(data.models);
        setHasAnyKey(Object.values(data.fetchedAt).some((v) => v !== null));
        if (data.selected) {
          setModelState(data.selected);
        } else {
          const first = Object.values(data.models).find((list) => list.length > 0)?.[0];
          if (first) setModelState({ provider: first.provider, id: first.id });
        }
      } catch {
        // Leave models null — the bar disables gracefully.
      } finally {
        setModelsLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SPECIALTY_STORAGE_KEY);
      pendingSpecialtyIdRef.current = stored ? Number(stored) : null;
    } catch {
      pendingSpecialtyIdRef.current = null;
    }

    (async () => {
      try {
        const res = await fetch("/api/specialties");
        if (!res.ok) return;
        const data = (await res.json()) as { specialties: SpecialtyRow[] };
        setSpecialties(data.specialties ?? []);
        const wantedId = pendingSpecialtyIdRef.current;
        if (wantedId != null) {
          const found = (data.specialties ?? []).find((s) => s.id === wantedId);
          if (found) setSpecialtyState(found);
        }
      } catch {
        // No saved specialties — fine, "None" stays selected.
      }
    })();
  }, []);

  // Abort any in-flight stream on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const setModel = useCallback((next: { provider: ChatProvider; id: string }) => {
    setModelState(next);
    void fetch("/api/chat/models", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    }).catch(() => {});
  }, []);

  const setSpecialty = useCallback((next: SpecialtyRow | null) => {
    setSpecialtyState(next);
    try {
      if (next) localStorage.setItem(SPECIALTY_STORAGE_KEY, String(next.id));
      else localStorage.removeItem(SPECIALTY_STORAGE_KEY);
    } catch {
      // localStorage unavailable — selection just won't persist across reloads.
    }
  }, []);

  const addSpecialty = useCallback(async (name: string, prompt: string): Promise<SpecialtyRow> => {
    const res = await fetch("/api/specialties", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, prompt }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as { error?: string });
      throw new Error(body.error ?? "Failed to save specialty");
    }
    const data = (await res.json()) as { specialty: SpecialtyRow };
    setSpecialties((prev) => [...prev, data.specialty]);
    setSpecialty(data.specialty);
    return data.specialty;
  }, [setSpecialty]);

  const updateSpecialty = useCallback(
    async (id: number, patch: { name: string; prompt: string }): Promise<SpecialtyRow> => {
      const res = await fetch(`/api/specialties/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error ?? "Failed to update specialty");
      }
      const data = (await res.json()) as { specialty: SpecialtyRow };
      setSpecialties((prev) => prev.map((s) => (s.id === id ? data.specialty : s)));
      setSpecialtyState((prev) => (prev?.id === id ? data.specialty : prev));
      return data.specialty;
    },
    [],
  );

  const removeSpecialty = useCallback(
    async (id: number): Promise<void> => {
      const res = await fetch(`/api/specialties/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error ?? "Failed to delete specialty");
      }
      setSpecialties((prev) => prev.filter((s) => s.id !== id));
      setSpecialtyState((prev) => {
        if (prev?.id !== id) return prev;
        try {
          localStorage.removeItem(SPECIALTY_STORAGE_KEY);
        } catch {
          // localStorage unavailable — selection just won't persist across reloads.
        }
        return null;
      });
    },
    [],
  );

  const clearUnread = useCallback(() => setUnread(false), []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming || !sessionId || !model) return;

      setError(null);
      const userMessage: ChatMessageRow = {
        id: nextTempId--,
        session_id: sessionId,
        role: "user",
        content: trimmed,
        provider: null,
        model: null,
        specialty_id: specialty?.id ?? null,
        citations: null,
        created_at: Date.now(),
      };
      setMessages((prev) => [...prev, userMessage]);
      setIsStreaming(true);
      setStreamingText("");
      setOverlayOpen(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const payload: Record<string, unknown> = {
          message: trimmed,
          provider: model.provider,
          model: model.id,
          specialtyId: specialty?.id ?? null,
          swapped,
        };
        if (getSegments) payload.segments = getSegments().map((s) => ({
          source: s.source,
          text: s.text,
          speaker: s.speaker,
          startedAtMs: s.startedAtMs,
          seq: s.seq,
        }));

        const res = await fetch(`/api/sessions/${sessionId}/chat/stream`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        const contentType = res.headers.get("content-type") ?? "";
        if (!res.ok || !contentType.includes("text/event-stream")) {
          const body = await res.json().catch(() => ({}) as { error?: string });
          setError(body.error ?? "Chat request failed.");
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) {
          setError("No response stream.");
          return;
        }
        const decoder = new TextDecoder();
        let buffer = "";
        let done = false;

        while (!done) {
          const { value, done: readerDone } = await reader.read();
          if (readerDone) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const rawFrame of frames) {
            const line = rawFrame.startsWith("data: ") ? rawFrame.slice(6) : rawFrame;
            if (!line.trim()) continue;
            let frame: SseFrame;
            try {
              frame = JSON.parse(line) as SseFrame;
            } catch {
              continue;
            }

            if (frame.type === "delta") {
              setStreamingText((prev) => prev + (frame.text ?? ""));
            } else if (frame.type === "done") {
              if (frame.message) {
                setMessages((prev) => [...prev, frame.message as ChatMessageRow]);
              }
              done = true;
            } else if (frame.type === "error") {
              setError(frame.error ?? "Something went wrong.");
              done = true;
            }
          }
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof Error ? err.message : "Chat request failed.");
        }
      } finally {
        setIsStreaming(false);
        setStreamingText("");
        abortRef.current = null;
        setOverlayOpen((open) => {
          if (!open) setUnread(true);
          return open;
        });
      }
    },
    [isStreaming, sessionId, model, specialty, swapped, getSegments],
  );

  return {
    messages,
    streamingText,
    isStreaming,
    error,
    send,
    stop,
    overlayOpen,
    setOverlayOpen,
    unread,
    clearUnread,
    model,
    setModel,
    models,
    modelsLoading,
    hasAnyKey,
    specialty,
    setSpecialty,
    specialties,
    addSpecialty,
    updateSpecialty,
    removeSpecialty,
    ready: sessionId !== null,
  };
}
