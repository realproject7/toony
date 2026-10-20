"use client";

// The message box: a context chip for what the person is looking at (they can
// remove it for the next message), an auto-growing text area where Enter sends
// and Shift+Enter starts a new line (never while an input method is composing),
// and one Send/Stop button.

import { type RefObject, useLayoutEffect, useRef } from "react";
import { PanelIcon } from "./panel-icon";

export interface ComposerProps {
  draft: string;
  onDraft: (text: string) => void;
  chip: string | null;
  chipRemoved: boolean;
  onToggleChip: () => void;
  disabled: boolean;
  running: boolean;
  sending: boolean;
  /** Shown in the empty text area. */
  hint: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onSend: () => void;
  onStop: () => void;
}

const MAX_HEIGHT = 200;

export function Composer(props: ComposerProps) {
  const {
    draft,
    onDraft,
    chip,
    chipRemoved,
    onToggleChip,
    disabled,
    running,
    sending,
    hint,
    textareaRef,
    onSend,
    onStop,
  } = props;
  const composing = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: resize whenever the text changes.
  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT)}px`;
  }, [draft, textareaRef]);

  const canSend = !disabled && !running && !sending && draft.trim().length > 0;

  return (
    <form
      className="agent-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) onSend();
      }}
    >
      {chip && (
        <div className="agent-chip-row">
          {chipRemoved ? (
            <button type="button" className="agent-chip agent-chip-off" onClick={onToggleChip}>
              <PanelIcon name="plus" />
              <span>Add context: {chip}</span>
            </button>
          ) : (
            <span className="agent-chip" title="Sent with your next message">
              <span className="agent-chip-dot" aria-hidden="true" />
              <span className="agent-chip-label">{chip}</span>
              <button
                type="button"
                className="agent-chip-remove"
                aria-label={`Do not send ${chip} as context`}
                onClick={onToggleChip}
              >
                <PanelIcon name="close" />
              </button>
            </span>
          )}
        </div>
      )}
      <div className="agent-input" data-disabled={disabled ? "true" : undefined}>
        <textarea
          ref={textareaRef}
          aria-label="Message your agent"
          rows={1}
          maxLength={12_000}
          value={draft}
          disabled={disabled}
          placeholder={hint}
          onChange={(event) => onDraft(event.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            const native = event.nativeEvent;
            if (native.isComposing || native.keyCode === 229 || composing.current) return;
            event.preventDefault();
            if (canSend) onSend();
          }}
        />
        {running ? (
          <button
            type="button"
            className="agent-send"
            data-kind="stop"
            aria-label="Stop the agent"
            title="Stop"
            onClick={onStop}
          >
            <PanelIcon name="stop" />
          </button>
        ) : (
          <button
            type="submit"
            className="agent-send"
            aria-label="Send message"
            title="Send"
            disabled={!canSend}
          >
            <PanelIcon name="send" />
          </button>
        )}
      </div>
    </form>
  );
}
