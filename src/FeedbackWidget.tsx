import { useEffect, useRef, useState } from "react";
import { submitFeedback } from "./api";

const ACCEPT = "image/png,image/jpeg,image/gif,image/webp,application/pdf";
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 5;

function sizeLabel(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1048576).toFixed(1)} MB`;
}

/** The floating "Feedback" button and its submission modal.
 *
 * Self-contained: it owns its own state and talks only to /api/feedback, so it
 * sits in the app shell without touching any plotting flow. `onSubmitted` lets
 * the shell refresh the All feedback list if it happens to be open. */
export default function FeedbackWidget({
  onSubmitted,
  onViewAll,
}: {
  onSubmitted?: () => void;
  onViewAll?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const closeTimer = useRef<number | null>(null);

  // Escape closes the modal, matching the rest of the console's keyboarding.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) closeAndReset();
    }
    window.addEventListener("keydown", onKey);
    nameRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy]);

  /** Every field back to its initial value, the native file input included.
   *
   * Clearing `files` alone is not enough: the browser keeps its own selection
   * on the <input type="file">, which both shows a stale "2 files" label and
   * suppresses the change event if the same file is picked again. */
  function resetForm() {
    setName("");
    setMessage("");
    setFiles([]);
    setError(null);
    setDone(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  /** The single dismissal path: Cancel, the X, the backdrop, Escape, and the
   * post-submit timer all land here, so no route out leaves state behind. */
  function closeAndReset() {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(false);
    resetForm();
  }

  function pickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    setError(null);
    // The input is cleared either way: the component's own list is the source
    // of truth, so a second pick adds to the selection instead of replacing it.
    if (fileRef.current) fileRef.current.value = "";
    if (picked.length === 0) return;

    const tooBig = picked.find((f) => f.size > MAX_BYTES);
    if (tooBig) {
      setError(
        `“${tooBig.name}” is ${sizeLabel(tooBig.size)}. The limit is 10 MB per file.`,
      );
      return;
    }

    // Same name and size twice over is a double-pick, not two files.
    const merged = [...files];
    for (const f of picked) {
      if (!merged.some((m) => m.name === f.name && m.size === f.size)) merged.push(f);
    }
    if (merged.length > MAX_FILES) {
      setError(
        `That would be ${merged.length} files; you can attach at most ${MAX_FILES}. ` +
          `Remove one before adding another.`,
      );
      return;
    }
    setFiles(merged);
  }

  function removeFile(index: number) {
    setError(null);
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function send() {
    setError(null);
    if (!name.trim()) {
      setError("Please enter your name.");
      return;
    }
    if (!message.trim()) {
      setError("Please enter a message.");
      return;
    }
    setBusy(true);
    try {
      await submitFeedback(name.trim(), message.trim(), files);
      // Still remembered for the vote box on the All feedback page, even
      // though this form no longer pre-fills from it.
      localStorage.setItem("deedplot.feedbackName", name.trim());
      setDone(true);
      onSubmitted?.();
      // Leave the confirmation on screen briefly rather than snapping shut,
      // then close down the same path as every other dismissal.
      closeTimer.current = window.setTimeout(closeAndReset, 1600);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="fb-dock">
        {onViewAll && (
          <button className="fb-dock-link" onClick={onViewAll}>
            All feedback
          </button>
        )}
        <button
          className="fb-fab"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          Feedback
        </button>
      </div>

      {open && (
        <div className="fb-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && closeAndReset()}>
          <div className="fb-modal panel" role="dialog" aria-modal="true" aria-label="Send feedback">
            <div className="panel-head">
              <h2>Send feedback</h2>
              <span className="spacer" />
              <button className="fb-close" onClick={closeAndReset} disabled={busy} aria-label="Close">
                ×
              </button>
            </div>

            <div className="panel-body">
              {done ? (
                <div className="fb-done">
                  <strong>Thank you — your feedback was recorded.</strong>
                  <p className="muted">It is now visible on the All feedback page.</p>
                </div>
              ) : (
                <>
                  <p className="lede fb-lede">
                    Tell us what you saw. Everything submitted is visible to every tester on the
                    All feedback page, so check there first to avoid filing a duplicate.
                  </p>

                  <label className="fb-field">
                    <span className="section-label">Your name</span>
                    <input
                      ref={nameRef}
                      className="fb-input"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. J. Rivera"
                      maxLength={120}
                      disabled={busy}
                    />
                  </label>

                  <label className="fb-field">
                    <span className="section-label">Message</span>
                    <textarea
                      className="fb-textarea"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="What did you expect, and what happened instead? Include the deed or sample you were plotting if it is relevant."
                      maxLength={5000}
                      disabled={busy}
                    />
                  </label>

                  <div className="fb-field">
                    <span className="section-label">
                      Attachments <span className="muted">— optional</span>
                    </span>
                    <input
                      ref={fileRef}
                      className="fb-file"
                      type="file"
                      accept={ACCEPT}
                      multiple
                      onChange={pickFiles}
                      disabled={busy || files.length >= MAX_FILES}
                      aria-label="Attachments"
                    />
                    <span className="fb-hint">
                      Screenshots and the deed PDF. PNG, JPEG, GIF, WebP or PDF, up to{" "}
                      {MAX_FILES} files, 10 MB each.
                    </span>

                    {files.length > 0 && (
                      <ul className="fb-picked">
                        {files.map((f, i) => (
                          <li key={`${f.name}-${f.size}-${i}`}>
                            <span className="fb-picked-name">{f.name}</span>
                            <span className="fb-picked-size">{sizeLabel(f.size)}</span>
                            <button
                              type="button"
                              className="fb-picked-x"
                              onClick={() => removeFile(i)}
                              disabled={busy}
                              aria-label={`Remove ${f.name}`}
                              title={`Remove ${f.name}`}
                            >
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {error && (
                    <div className="error-box">
                      <strong>Could not send this feedback</strong>
                      <p>{error}</p>
                    </div>
                  )}

                  <div className="field-row">
                    <button className="btn" onClick={send} disabled={busy}>
                      {busy ? "Sending…" : "Send feedback"}
                    </button>
                    <button className="btn-secondary" onClick={closeAndReset} disabled={busy}>
                      Cancel
                    </button>
                    {busy && <span className="spinner" />}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
