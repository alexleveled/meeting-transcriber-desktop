"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { ProviderSelect } from "@/components/ProviderSelect";
import { ApiKeyField } from "@/components/ApiKeyField";
import { ModelDownloadCard } from "@/components/ModelDownloadCard";
import { UpdatePanel } from "@/components/UpdatePanel";
import { CHAT_PROVIDERS, CHAT_PROVIDER_LABEL, type ChatProvider, type ClientSettings, type Provider } from "@/lib/types";

// Providers whose model runs free/locally and needs no API key (Local Whisper). While one of these
// is selected we hide the API-key field and show a hint that a paid provider is faster/more accurate.
const FREE_PROVIDERS: Provider[] = ["local"];

export default function SettingsPage() {
  const [settings, setSettings] = useState<ClientSettings | null>(null);
  const [provider, setProvider] = useState<Provider>("openai");
  const [model, setModel] = useState<string>("");
  // Per-provider pending key edits (local needs no key, but keep the record total over Provider).
  const [drafts, setDrafts] = useState<Record<Provider, string>>({
    openai: "",
    deepgram: "",
    local: "",
  });
  const [cleared, setCleared] = useState<Record<Provider, boolean>>({
    openai: false,
    deepgram: false,
    local: false,
  });
  // Per-provider pending key edits for the AI Chat card, mirroring `drafts`/`cleared` above.
  const [chatDrafts, setChatDrafts] = useState<Record<ChatProvider, string>>({
    openai: "",
    anthropic: "",
  });
  const [chatCleared, setChatCleared] = useState<Record<ChatProvider, boolean>>({
    openai: false,
    anthropic: false,
  });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function load() {
    const res = await fetch("/api/settings");
    const data = (await res.json()) as ClientSettings;
    setSettings(data);
    setProvider(data.provider);
    setModel(data.modelByProvider[data.provider]);
  }

  useEffect(() => {
    load();
  }, []);

  // When switching provider, snap the model select to that provider's stored model.
  function pickProvider(p: Provider) {
    setProvider(p);
    if (settings) setModel(settings.modelByProvider[p]);
    setSaveState("idle");
  }

  async function save() {
    setSaveState("saving");
    const keys: Partial<Record<Provider, string | null>> = {};
    (["openai", "deepgram"] as Provider[]).forEach((p) => {
      if (cleared[p]) keys[p] = null;
      else if (drafts[p].trim()) keys[p] = drafts[p].trim();
    });
    const chatKeys: Partial<Record<ChatProvider, string | null>> = {};
    CHAT_PROVIDERS.forEach((p) => {
      if (chatCleared[p]) chatKeys[p] = null;
      else if (chatDrafts[p].trim()) chatKeys[p] = chatDrafts[p].trim();
    });
    const chatKeyChanged = Object.keys(chatKeys).length > 0;
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, model, keys, chatKeys }),
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as ClientSettings;
      setSettings(data);
      setDrafts({ openai: "", deepgram: "", local: "" });
      setCleared({ openai: false, deepgram: false, local: false });
      setChatDrafts({ openai: "", anthropic: "" });
      setChatCleared({ openai: false, anthropic: false });
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2000);
      // A changed chat key can make previously-unavailable chat models available (or vice
      // versa); refresh the cached model list in the background so the chat picker picks it up.
      if (chatKeyChanged) {
        fetch("/api/chat/models?refresh=1").catch(() => {});
      }
    } catch {
      setSaveState("error");
    }
  }

  if (!settings) {
    return (
      <div className="mx-auto flex h-full min-h-0 w-full max-w-2xl flex-col px-8 py-8">
        <div className="shrink-0">
          <PageHeader title="Settings" />
        </div>
        <div className="card p-6 text-sm" style={{ color: "var(--text-muted)" }}>
          Loading…
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-2xl flex-col px-8 py-8">
      <div className="shrink-0">
        <PageHeader
          title="Settings"
          subtitle="Pick a transcription engine and add the API keys for transcription and chat. Keys are stored locally and never re-entered."
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-slim">

      <div className="card p-6">
        <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          Transcription
        </h2>
        <p className="hint mt-1">Which engine turns your meeting audio into text.</p>

        <div className="mt-4">
          <label className="label">Provider</label>
          <ProviderSelect value={provider} onChange={pickProvider} />
        </div>

        <div className="mt-5">
          <label className="label">Model</label>
          {FREE_PROVIDERS.includes(provider) ? (
            <ModelDownloadCard files={settings.models[provider]} value={model} onChange={setModel} />
          ) : (
            <select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
              {settings.models[provider].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}
        </div>

        {FREE_PROVIDERS.includes(provider) && (
          <div
            className="mt-4 flex items-start gap-2.5 rounded-lg border px-3 py-2.5"
            style={{ background: "var(--accent-soft)", borderColor: "var(--border)" }}
          >
            <span className="mt-0.5 shrink-0" style={{ color: "var(--accent)" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />
              </svg>
            </span>
            <p className="text-xs" style={{ color: "var(--text)" }}>
              Want faster, live transcription? Pick OpenAI or Deepgram above and add an API key — the
              free local Whisper model trades some speed (text appears after each pause) for running
              on your machine at no cost.
            </p>
          </div>
        )}

        {!FREE_PROVIDERS.includes(provider) && (
          <div className="mt-5">
            <ApiKeyField
              provider={provider}
              saved={settings.keys[provider]}
              draft={drafts[provider]}
              cleared={cleared[provider]}
              onDraftChange={(v) => setDrafts((d) => ({ ...d, [provider]: v }))}
              onClear={() => setCleared((c) => ({ ...c, [provider]: true }))}
              onUndoClear={() => setCleared((c) => ({ ...c, [provider]: false }))}
            />
          </div>
        )}
      </div>

      <p className="hint mt-4">
        Cost estimate: OpenAI gpt-4o-transcribe ≈ $0.72/meeting-hour (both streams),
        gpt-4o-mini-transcribe ≈ $0.36/hr, Deepgram nova-3 ≈ $0.92/hr.
      </p>

      <div className="card mt-6 p-6">
        <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          AI Chat
        </h2>
        <p className="hint mt-1">Keys used for chatting with your transcripts.</p>

        <div className="mt-4 space-y-5">
          {CHAT_PROVIDERS.map((p) => (
            <ApiKeyField
              key={p}
              provider={p}
              label={`${CHAT_PROVIDER_LABEL[p]} API key`}
              placeholder={p === "openai" ? "sk-…" : "sk-ant-…"}
              testEndpoint="/api/chat/test-key"
              saved={settings.chatKeys[p]}
              draft={chatDrafts[p]}
              cleared={chatCleared[p]}
              onDraftChange={(v) => setChatDrafts((d) => ({ ...d, [p]: v }))}
              onClear={() => setChatCleared((c) => ({ ...c, [p]: true }))}
              onUndoClear={() => setChatCleared((c) => ({ ...c, [p]: false }))}
              note={
                p === "openai" && settings.chatKeys.openai.fromTranscription
                  ? "Using your Transcription OpenAI key. Enter one here to use a different key for chat."
                  : undefined
              }
            />
          ))}
        </div>
      </div>

      <UpdatePanel />

      <div className="mt-6 flex items-center gap-3">
        <button className="btn btn-primary" onClick={save} disabled={saveState === "saving"}>
          {saveState === "saving" ? "Saving…" : "Save settings"}
        </button>
        {saveState === "saved" && (
          <span className="text-sm" style={{ color: "var(--success)" }}>
            ✓ Saved
          </span>
        )}
        {saveState === "error" && (
          <span className="text-sm" style={{ color: "var(--danger)" }}>
            Failed to save
          </span>
        )}
      </div>
      </div>
    </div>
  );
}
