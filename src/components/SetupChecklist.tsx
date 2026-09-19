"use client";

import { useEffect, useState } from "react";
import { isElectron } from "@/lib/window-adapter";
import type { InputMode } from "@/lib/types";

// Browser (Chrome/Edge): the user drives the screen-share picker, so the checklist coaches them
// through it. Electron: capture is silent (loopback system audio, auto-granted mic) — no picker to
// coach, so we only surface the couple of things the OS still gates.
const BROWSER_ITEMS = [
  {
    title: "Share the Entire screen",
    body: "Windows only offers “Also share system audio” when you pick Entire screen — not a window or tab.",
  },
  {
    title: "Tick “Also share system audio”",
    body: "This checkbox in the screen-share dialog is what captures the participants' voices.",
  },
  {
    title: "Use headphones",
    body: "On speakers, your mic hears the participants and mislabels them as “Me”. Headphones keep the two streams clean.",
  },
];

const ELECTRON_ITEMS = [
  {
    title: "Just click Start",
    body: "No screen-share picker and no permission prompts — system audio is captured automatically.",
  },
  {
    title: "Allow microphone for desktop apps",
    body: "If the mic meter stays dark, enable Settings → Privacy & security → Microphone → “Let desktop apps access your microphone”.",
  },
  {
    title: "Use headphones",
    body: "On speakers, your mic hears the participants and mislabels them as “Me”. Headphones keep the two streams clean.",
  },
];

// Phone mode captures the room, not the computer — so the coaching is about the room. No screen
// share to explain and (crucially) no headphones: the mic has to hear the speakerphone.
const PHONE_ITEMS = [
  {
    title: "Put the phone on speaker",
    body: "Both voices have to reach this computer's microphone — the app never touches the phone itself.",
  },
  {
    title: "Keep the phone near the PC",
    body: "A metre or so away is ideal. Too far and the customer's voice gets thin and hard to separate.",
  },
  {
    title: "Quiet room, no headphones",
    body: "Noise suppression is off so the speakerphone isn't filtered out, so background chatter lands in the transcript. Headphones would hide the customer entirely.",
  },
];

export function SetupChecklist({ mode = "pc" }: { mode?: InputMode }) {
  // isElectron() reads `window`, so resolve after mount to avoid a hydration mismatch.
  const [electron, setElectron] = useState(false);
  useEffect(() => setElectron(isElectron()), []);
  const items = mode === "phone" ? PHONE_ITEMS : electron ? ELECTRON_ITEMS : BROWSER_ITEMS;

  return (
    <ul className="flex flex-col gap-3">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3">
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
          >
            {i + 1}
          </span>
          <div>
            <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
              {it.title}
            </div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              {it.body}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
