import { session, desktopCapturer } from "electron";

/**
 * Zero-permission-dialog capture. Applied to the default session BEFORE any window loads.
 *
 * The renderer's getDisplayMedia() call (SystemAudioCaptureSource) still requests `video: true`
 * and keeps the unused video track alive exactly as in the browser. Here we intercept the request
 * and answer it silently with the primary screen's video PLUS Windows WASAPI loopback system audio
 * (`audio: 'loopback'`, Electron ≥ 31) — no picker, no prompt. getUserMedia() for the mic is
 * auto-granted by the permission handlers. Result: click Start → recording, zero dialogs.
 *
 * If loopback ever misbehaves the handler can fall back to video-only, which surfaces the
 * renderer's existing NoAudioTrackError retry banner — degraded, never broken.
 */
export function installCaptureHandlers(): void {
  const defaultSession = session.defaultSession;

  defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ["screen"] });
        if (sources.length === 0) {
          // No screen to grant — deny; renderer treats it as a cancelled share.
          callback({});
          return;
        }
        // 'loopback' = true system-audio mix (not 'loopbackWithMute', which silences the speakers).
        callback({ video: sources[0], audio: "loopback" });
      } catch {
        callback({});
      }
    },
    // Use our silent handler, never the OS picker.
    { useSystemPicker: false },
  );

  // Auto-grant mic + display-capture; deny anything else we didn't ask for.
  defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === "media" || permission === "display-capture");
  });
  defaultSession.setPermissionCheckHandler(() => true);
}
