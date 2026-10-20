// Renders the agent's Markdown subset (lib/agent/markdown.ts) with React
// elements. Text always goes through React text nodes, so nothing in a reply
// can become HTML. Internal links use next/link; http(s) links show their
// address and open in a new tab without access to this page.

import Link from "next/link";
import { Fragment, type ReactNode, useMemo } from "react";
import { type MdBlock, type MdInline, type MdList, parseMarkdown } from "@/lib/agent/markdown";

function Inline({ nodes, onNavigate }: { nodes: MdInline[]; onNavigate?: () => void }) {
  return (
    <>
      {nodes.map((node, index) => {
        const key = `${node.type}-${index}`;
        switch (node.type) {
          case "text":
            return <Fragment key={key}>{node.text}</Fragment>;
          case "break":
            return <br key={key} />;
          case "code":
            return <code key={key}>{node.text}</code>;
          case "strong":
            return (
              <strong key={key}>
                <Inline nodes={node.children} onNavigate={onNavigate} />
              </strong>
            );
          case "em":
            return (
              <em key={key}>
                <Inline nodes={node.children} onNavigate={onNavigate} />
              </em>
            );
          case "strike":
            return (
              <s key={key}>
                <Inline nodes={node.children} onNavigate={onNavigate} />
              </s>
            );
          case "link":
            return (
              <Link key={key} href={node.href} onClick={onNavigate}>
                <Inline nodes={node.children} />
              </Link>
            );
          case "external": {
            const showLabel = node.label && node.label !== node.href;
            return (
              <Fragment key={key}>
                {showLabel ? `${node.label} (` : ""}
                <a
                  href={node.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="md-external"
                >
                  {node.href}
                </a>
                {showLabel ? ")" : ""}
              </Fragment>
            );
          }
        }
        return null;
      })}
    </>
  );
}

function ListView({ list, onNavigate }: { list: MdList; onNavigate?: () => void }) {
  const items = list.items.map((item, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: list items have no identity beyond their position.
    <li key={index}>
      <Inline nodes={item.children} onNavigate={onNavigate} />
      {item.list && <ListView list={item.list} onNavigate={onNavigate} />}
    </li>
  ));
  return list.ordered ? (
    <ol start={list.start === 1 ? undefined : list.start}>{items}</ol>
  ) : (
    <ul>{items}</ul>
  );
}

function Block({ block, onNavigate }: { block: MdBlock; onNavigate?: () => void }): ReactNode {
  switch (block.type) {
    case "paragraph":
      return (
        <p>
          <Inline nodes={block.children} onNavigate={onNavigate} />
        </p>
      );
    case "heading": {
      const content = <Inline nodes={block.children} onNavigate={onNavigate} />;
      return block.level === 1 ? (
        <h3 className="md-heading">{content}</h3>
      ) : (
        <h4 className="md-heading">{content}</h4>
      );
    }
    case "list":
      return <ListView list={block} onNavigate={onNavigate} />;
    case "code":
      return (
        <pre className="md-code">
          <code>{block.text}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote>
          {block.children.map((child, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: parsed blocks have no identity beyond their position.
            <Block key={index} block={child} onNavigate={onNavigate} />
          ))}
        </blockquote>
      );
    case "rule":
      return <hr />;
    case "table":
      return (
        <div className="md-table">
          <table>
            <thead>
              <tr>
                {block.head.map((cell, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: table cells are positional.
                  <th key={index}>
                    <Inline nodes={cell} onNavigate={onNavigate} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: table rows are positional.
                <tr key={rowIndex}>
                  {row.map((cell, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: table cells are positional.
                    <td key={index}>
                      <Inline nodes={cell} onNavigate={onNavigate} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function MarkdownView({ text, onNavigate }: { text: string; onNavigate?: () => void }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className="agent-markdown">
      {blocks.map((block, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: parsed blocks have no identity beyond their position.
        <Block key={index} block={block} onNavigate={onNavigate} />
      ))}
    </div>
  );
}
