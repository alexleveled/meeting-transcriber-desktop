"use client";

import { formatTranscript, type FormattableSegment } from "@/lib/format-transcript";

/** Downloads the current in-memory transcript as .txt (live export, no server round-trip). */
export function ExportButton({
  segments,
  filename = "meeting.txt",
  disabled,
  swapped = false,
}: {
  segments: FormattableSegment[];
  filename?: string;
  disabled?: boolean;
  /** Phone-call sessions whose two diarized voices were swapped by the user. */
  swapped?: boolean;
}) {
  function download() {
    const text = formatTranscript(segments, swapped);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <button className="btn btn-secondary" onClick={download} disabled={disabled || segments.length === 0}>
      Export .txt
    </button>
  );
}
