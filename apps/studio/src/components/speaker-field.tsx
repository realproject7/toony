"use client";

// Who says a bubble: the cast as choices, or any other name typed in. The
// stored value is the speaker's name.

import { useEffect, useId, useState } from "react";

const OTHER = "toony:other-speaker";

export function SpeakerField({
  value,
  choices,
  onChange,
}: {
  value: string;
  choices: readonly string[];
  onChange: (speaker: string) => void;
}) {
  const id = useId();
  const known = choices.includes(value.trim());
  const [typing, setTyping] = useState(!known && value.trim() !== "");
  useEffect(() => {
    if (choices.includes(value.trim())) setTyping(false);
    else if (value.trim() !== "") setTyping(true);
  }, [value, choices]);
  const missing = value.trim() === "";
  return (
    <div className="field speaker-field" data-testid="field-speaker-group">
      <label htmlFor={id}>Who says this</label>
      {choices.length > 0 && (
        <select
          id={typing ? undefined : id}
          value={typing ? OTHER : known ? value.trim() : ""}
          aria-invalid={missing}
          onChange={(event) => {
            if (event.target.value === OTHER) {
              setTyping(true);
              return;
            }
            setTyping(false);
            onChange(event.target.value);
          }}
          data-testid="field-speaker-choice"
        >
          <option value="" disabled>
            Choose a speaker
          </option>
          {choices.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
          <option value={OTHER}>Someone else…</option>
        </select>
      )}
      {(typing || choices.length === 0) && (
        <input
          id={id}
          type="text"
          value={value}
          placeholder="Speaker name"
          aria-invalid={missing}
          onChange={(event) => onChange(event.target.value)}
          data-testid="field-speaker"
        />
      )}
      {missing && <span className="field-hint field-warn">A dialogue bubble needs a speaker.</span>}
    </div>
  );
}
