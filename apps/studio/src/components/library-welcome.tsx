"use client";

// First run: no webtoons yet. One clear path (connect your own agent, start the
// artwork engine it draws with, describe a story) and a manual escape hatch
// (a blank webtoon).

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { openAgentPanel } from "@/lib/agent/focus-store";
import type { ArtEngineStatus } from "@/lib/art/engine";
import { getConnectionState, subscribeConnectionState } from "@/lib/connection-store";
import { NewWorkButton } from "./new-work-button";

const STEPS = [
  {
    title: "Connect your agent",
    text: "Claude Code or Codex on this computer, with your own subscription.",
  },
  {
    title: "Start the artwork engine",
    text: "ComfyUI on this computer draws the cuts. Add its address in Settings.",
  },
  {
    title: "Describe your story",
    text: "Tell the agent your idea. It writes the story, the cast and the episodes, and draws the cuts.",
  },
  {
    title: "Letter and export",
    text: "Place the balloons, tune the pauses between cuts, then export.",
  },
];

export function useConnection() {
  return useSyncExternalStore(subscribeConnectionState, getConnectionState, () => null);
}

export function LibraryWelcome({ engine }: { engine?: ArtEngineStatus }) {
  const connection = useConnection();
  const connected = connection?.status === "connected";
  return (
    <section className="welcome" data-testid="library-empty" aria-labelledby="welcome-title">
      {/* biome-ignore lint/performance/noImgElement: static local brand asset. */}
      <img className="welcome-mark" src="/brand/toony-icon.png" alt="" />
      <h1 id="welcome-title" className="welcome-title">
        Make webtoons with your own AI agent
      </h1>
      <p className="page-lede">
        You talk with your agent in the chat. It writes and draws your webtoon here, and you do the
        lettering.
      </p>
      <ol className="welcome-steps">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <span className="welcome-step-number" aria-hidden="true">
              {index + 1}
            </span>
            <div>
              <h2>{step.title}</h2>
              <p>{step.text}</p>
              {step.title === "Start the artwork engine" && engine && (
                <p className="welcome-engine" data-testid="welcome-engine">
                  <span className={`chip ${engine.ready ? "chip-ok" : "chip"}`}>
                    {engine.ready ? "Ready" : "Not ready"}
                  </span>{" "}
                  {!engine.ready && <Link href="/settings">Open Settings</Link>}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
      <div className="welcome-actions">
        <button
          type="button"
          className="btn btn-primary btn-large"
          onClick={() => openAgentPanel({ view: connected ? "chat" : "setup" })}
          data-testid="welcome-connect"
        >
          {connected ? "Describe your story" : "Connect your agent"}
        </button>
        <NewWorkButton label="Start without an agent" variant="quiet" />
      </div>
    </section>
  );
}
