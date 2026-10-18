"use client";

import type { BubbleRender } from "@toony/render";
import {
  type LetteringOverlay,
  letteringGraphemeBoundaries,
  reconcileLetteringText,
  replaceLetteringText,
  styleLetteringRange,
} from "@toony/schema";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";

export interface TextSelection {
  start: number;
  end: number;
}
export interface InlineTextHandle {
  focusSelection: (selection?: TextSelection) => void;
}

/** Canonical soft lines carry their original intervening whitespace, not new author text. */
function readText(root: Node): string {
  if (root.nodeType === Node.TEXT_NODE) return root.textContent ?? "";
  if (!(root instanceof HTMLElement)) return [...root.childNodes].map(readText).join("");
  if (root.dataset.caretMarker !== undefined || root.dataset.placeholder !== undefined) return "";
  if (root.tagName === "BR") return "\n";
  const before = root.dataset.before;
  const blockBreak =
    before === undefined && ["DIV", "P"].includes(root.tagName) && root.previousSibling ? "\n" : "";
  return (before ?? blockBreak) + [...root.childNodes].map(readText).join("");
}

function selectedOffsets(root: HTMLElement): TextSelection | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const prefix = range.cloneRange();
  prefix.selectNodeContents(root);
  prefix.setEnd(range.startContainer, range.startOffset);
  const through = range.cloneRange();
  through.selectNodeContents(root);
  through.setEnd(range.endContainer, range.endOffset);
  return {
    start: readText(prefix.cloneContents()).length,
    end: readText(through.cloneContents()).length,
  };
}

function restoreOffsets(root: HTMLElement, selection: TextSelection) {
  let offset = 0;
  const points: { node: Node; start: number; end: number }[] = [];
  const visit = (node: Node) => {
    if (node instanceof HTMLElement) {
      if (node.dataset.caretMarker !== undefined || node.dataset.placeholder !== undefined) return;
      offset += (node.dataset.before ?? "").length;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      points.push({ node, start: offset, end: offset + (node.textContent?.length ?? 0) });
      offset += node.textContent?.length ?? 0;
    } else for (const child of node.childNodes) visit(child);
  };
  visit(root);
  const at = (n: number) => {
    const p = points.find((p) => n <= p.end) ?? points.at(-1);
    return p
      ? { node: p.node, offset: Math.max(0, Math.min(p.end - p.start, n - p.start)) }
      : { node: root as Node, offset: 0 };
  };
  const a = at(selection.start),
    b = at(selection.end),
    range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  const native = window.getSelection();
  native?.removeAllRanges();
  native?.addRange(range);
}

/** Native selection and IME on shared, explicitly positioned lines. No HTML is persisted. */
export function InlineLetteringText({
  overlay,
  plan,
  width,
  height,
  onChange,
  onSelection,
  onFinish,
  onUndo,
  onRedo,
  ref,
}: {
  overlay: LetteringOverlay;
  plan: BubbleRender;
  width: number;
  height: number;
  onChange: (patch: Partial<LetteringOverlay>) => void;
  onSelection: (selection: TextSelection) => void;
  onFinish: () => void;
  onUndo: () => void;
  onRedo: () => void;
  ref?: React.Ref<InlineTextHandle>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const composing = useRef(false),
    pendingFinish = useRef(false);
  const firstRender = useRef(true);
  const lastSelection = useRef<TextSelection>({ start: 0, end: overlay.text.length });
  const latest = useRef({ overlay, onChange, onSelection, onFinish, onUndo, onRedo });
  latest.current = { overlay, onChange, onSelection, onFinish, onUndo, onRedo };
  const readSelection = useCallback(() => {
    if (!root.current) return lastSelection.current;
    const raw = selectedOffsets(root.current) ?? lastSelection.current;
    const boundaries = letteringGraphemeBoundaries(latest.current.overlay.text);
    const selection = {
      start: boundaries.filter((b) => b <= raw.start).at(-1) ?? 0,
      end: boundaries.find((b) => b >= raw.end) ?? latest.current.overlay.text.length,
    };
    lastSelection.current = selection;
    latest.current.onSelection(selection);
    return selection;
  }, []);
  const focus = useCallback((selection = lastSelection.current) => {
    if (!root.current || composing.current) return;
    root.current.focus({ preventScroll: true });
    restoreOffsets(root.current, selection);
    lastSelection.current = selection;
  }, []);
  useImperativeHandle(ref, () => ({ focusSelection: focus }), [focus]);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element || composing.current) return;
    const selection = lastSelection.current;
    const keepFocus =
      firstRender.current ||
      element === document.activeElement ||
      element.contains(document.activeElement);
    firstRender.current = false;
    const nodes: HTMLElement[] = [];
    let previousEnd = 0;
    for (const [lineIndex, line] of plan.lines.entries()) {
      const div = document.createElement("div");
      const start = line.sourceStart ?? 0,
        end = line.sourceEnd ?? start;
      div.dataset.before = overlay.text.slice(previousEnd, start);
      previousEnd = end;
      Object.assign(div.style, {
        position: "absolute",
        left: "0",
        top: `${line.y}px`,
        width: "100%",
        height: `${Math.max(plan.text.fontSize, (plan.lines[lineIndex + 1]?.baselineY ?? (line.baselineY ?? line.y) + plan.text.lineHeight) - (line.baselineY ?? line.y))}px`,
      });
      for (const segment of line.segments ?? []) {
        const span = document.createElement("span"),
          marker = document.createElement("span");
        span.append(document.createTextNode(segment.text));
        marker.dataset.caretMarker = "";
        marker.contentEditable = "false";
        Object.assign(marker.style, {
          display: "inline-block",
          width: "0",
          height: "0",
          padding: "0",
          border: "0",
        });
        span.append(marker);
        Object.assign(span.style, {
          position: "absolute",
          left: `${segment.x + segment.textOffsetX}px`,
          top: `${segment.baselineY - line.y}px`,
          fontFamily: segment.fontStack,
          fontSize: `${segment.fontSize}px`,
          fontWeight: String(segment.fontWeight),
          fontStyle: "normal",
          color: segment.textColor,
          lineHeight: "1",
          letterSpacing: `${plan.letterSpacing * plan.text.fontSize}px`,
          whiteSpace: "pre",
        });
        div.append(span);
        span.dataset.baseline = String(segment.baselineY - line.y);
        span.dataset.skew = String(segment.skew);
      }
      if (!div.childNodes.length) {
        const span = document.createElement("span"),
          br = document.createElement("br");
        br.dataset.placeholder = "";
        span.append(document.createTextNode(""), br);
        const marker = document.createElement("span");
        marker.dataset.caretMarker = "";
        marker.contentEditable = "false";
        Object.assign(marker.style, { display: "inline-block", width: "0", height: "0" });
        span.insertBefore(marker, br);
        span.dataset.baseline = String((line.baselineY ?? plan.textOrigin.y) - line.y);
        span.dataset.skew = "0";
        Object.assign(span.style, {
          position: "absolute",
          left: `${line.anchorX}px`,
          top: `${(line.baselineY ?? plan.textOrigin.y) - line.y}px`,
          fontSize: `${plan.text.fontSize}px`,
          lineHeight: "1",
        });
        div.append(span);
      }
      nodes.push(div);
    }
    // Retain trailing hard breaks/whitespace that a wrapped line does not paint.
    if (previousEnd < overlay.text.length) {
      const tail = document.createElement("span");
      tail.dataset.before = overlay.text.slice(previousEnd);
      nodes.push(tail);
    }
    element.replaceChildren(...nodes);
    const bounds = element.getBoundingClientRect(),
      scale = bounds.width / width;
    if (scale > 0)
      for (const div of nodes)
        for (const span of div.children) {
          if (!(span instanceof HTMLElement) || span.dataset.baseline === undefined) continue;
          const marker = span.querySelector<HTMLElement>("[data-caret-marker]");
          if (!marker) continue;
          const baseline = Number(span.dataset.baseline),
            baselineOffset =
              (marker.getBoundingClientRect().top - span.getBoundingClientRect().top) / scale;
          span.style.top = `${baseline - baselineOffset}px`;
          span.style.transformOrigin = `0 ${baselineOffset}px`;
          span.style.transform = `skewX(${(-Math.atan(Number(span.dataset.skew)) * 180) / Math.PI}deg)`;
          marker.remove();
        }
    if (keepFocus)
      focus({
        start: Math.min(selection.start, overlay.text.length),
        end: Math.min(selection.end, overlay.text.length),
      });
  }, [overlay.text, plan, width, focus]);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const commit = (text: string, start: number, end: number) => {
      const doc = replaceLetteringText(latest.current.overlay, start, end, text);
      lastSelection.current = { start: start + text.length, end: start + text.length };
      latest.current.onSelection(lastSelection.current);
      latest.current.onChange(doc);
    };
    const before = (event: InputEvent) => {
      if (composing.current || event.isComposing || event.inputType.includes("Composition")) return;
      const selection = readSelection(),
        doc = latest.current.overlay;
      let { start, end } = selection;
      if (event.inputType.startsWith("delete")) {
        if (start === end) {
          const boundaries = letteringGraphemeBoundaries(doc.text);
          if (event.inputType.includes("Backward"))
            start = event.inputType.includes("Word")
              ? start - (doc.text.slice(0, start).match(/(?:\s+|\S+)$/u)?.[0].length ?? 0)
              : (boundaries.filter((b) => b < start).at(-1) ?? 0);
          else
            end = event.inputType.includes("Word")
              ? end + (doc.text.slice(end).match(/^(?:\s+|\S+)/u)?.[0].length ?? 0)
              : (boundaries.find((b) => b > end) ?? doc.text.length);
        }
        event.preventDefault();
        if (start !== end) commit("", start, end);
      } else if (
        ["insertText", "insertReplacementText", "insertLineBreak", "insertParagraph"].includes(
          event.inputType,
        )
      ) {
        if (event.inputType === "insertText" && event.data === null) return;
        event.preventDefault();
        commit(
          event.inputType === "insertLineBreak" || event.inputType === "insertParagraph"
            ? "\n"
            : (event.data ?? ""),
          start,
          end,
        );
      }
    };
    const change = () => {
      if (!composing.current) {
        const selection = selectedOffsets(element);
        if (selection) lastSelection.current = selection;
        latest.current.onChange(reconcileLetteringText(latest.current.overlay, readText(element)));
      }
    };
    const start = () => {
      composing.current = true;
    };
    const end = () => {
      composing.current = false;
      change();
      if (pendingFinish.current) {
        pendingFinish.current = false;
        latest.current.onFinish();
      }
    };
    const selection = () => {
      if (!composing.current && selectedOffsets(element)) readSelection();
    };
    const paste = (event: ClipboardEvent) => {
      event.preventDefault();
      if (composing.current) return;
      const s = readSelection();
      commit(event.clipboardData?.getData("text/plain") ?? "", s.start, s.end);
    };
    const copy = (event: ClipboardEvent) => {
      const s = readSelection();
      event.preventDefault();
      event.clipboardData?.setData("text/plain", latest.current.overlay.text.slice(s.start, s.end));
    };
    const cut = (event: ClipboardEvent) => {
      if (composing.current) return;
      const s = readSelection();
      copy(event);
      commit("", s.start, s.end);
    };
    element.addEventListener("beforeinput", before);
    element.addEventListener("input", change);
    element.addEventListener("compositionstart", start);
    element.addEventListener("compositionend", end);
    element.addEventListener("paste", paste);
    document.addEventListener("selectionchange", selection);
    element.addEventListener("copy", copy);
    element.addEventListener("cut", cut);
    return () => {
      element.removeEventListener("beforeinput", before);
      element.removeEventListener("input", change);
      element.removeEventListener("compositionstart", start);
      element.removeEventListener("compositionend", end);
      element.removeEventListener("paste", paste);
      element.removeEventListener("copy", copy);
      element.removeEventListener("cut", cut);
      document.removeEventListener("selectionchange", selection);
    };
  }, [readSelection]);

  const style: CSSProperties = {
    position: "absolute",
    inset: 0,
    width: `${width}px`,
    height: `${height}px`,
    zIndex: 4,
    outline: "none",
    cursor: "text",
    userSelect: "text",
    caretColor: "var(--color-accent)",
    whiteSpace: "pre",
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: native rich selection uses canonical positioned lines that a textarea cannot represent.
    <div
      style={style}
      data-testid="inline-lettering-text"
      ref={root}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      tabIndex={0}
      aria-label="Bubble text on artwork"
      aria-multiline="true"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || composing.current) return;
        const mod = event.metaKey || event.ctrlKey;
        if (
          (event.metaKey && ["ArrowUp", "ArrowDown"].includes(event.key)) ||
          (event.ctrlKey && ["Home", "End"].includes(event.key))
        ) {
          event.preventDefault();
          const s = readSelection(),
            end = event.key === "ArrowDown" || event.key === "End" ? overlay.text.length : 0;
          focus(
            event.shiftKey
              ? { start: Math.min(s.start, end), end: Math.max(s.end, end) }
              : { start: end, end },
          );
          return;
        }
        if (mod && event.key.toLowerCase() === "z") {
          event.preventDefault();
          event.shiftKey ? onRedo() : onUndo();
        } else if (mod && ["b", "i"].includes(event.key.toLowerCase())) {
          event.preventDefault();
          const s = readSelection();
          const range = overlay.textRanges?.find(
            (r) => r.start <= s.start && s.start < r.end,
          )?.style;
          const patch =
            event.key.toLowerCase() === "b"
              ? {
                  fontWeight: ((range?.fontWeight ?? plan.fontWeight) === 700 ? 400 : 700) as
                    | 400
                    | 700,
                }
              : {
                  fontStyle: ((range?.fontStyle ?? overlay.fontStyle) === "italic"
                    ? "normal"
                    : "italic") as "normal" | "italic",
                };
          onChange(s.start !== s.end ? styleLetteringRange(overlay, s.start, s.end, patch) : patch);
        } else if (mod && event.key.toLowerCase() === "y") {
          event.preventDefault();
          onRedo();
        } else if (event.key === "Escape") {
          event.preventDefault();
          if (composing.current) pendingFinish.current = true;
          else onFinish();
        }
      }}
    />
  );
}
