import type { TimelineItemDto, TurnDto } from "@codex-remote/shared";
import {
  Bot,
  Brain,
  CheckSquare,
  ChevronDown,
  CircleDot,
  FileDiff,
  Image,
  PencilLine,
  Search,
  Terminal,
  UserRound,
} from "lucide-react";
import type { ReactNode } from "react";
import { MarkdownContent } from "./MarkdownContent";

interface TimelineProps {
  turns: TurnDto[];
  loading: boolean;
  onEditUserMessage: (text: string) => void;
}

function Diff({ diff }: { diff: string }) {
  return (
    <pre className="diff-view">
      {diff.split("\n").map((line, index) => (
        <span
          key={`${index}-${line.slice(0, 12)}`}
          className={
            line.startsWith("+")
              ? "diff-add"
              : line.startsWith("-")
                ? "diff-remove"
                : ""
          }
        >
          {line || " "}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

function OutputDisclosure({
  label,
  value,
  children,
  className = "",
}: {
  label: string;
  value: string;
  children: ReactNode;
  className?: string;
}) {
  const lineCount = value.split("\n").length;
  return (
    <details className={`output-disclosure ${className}`.trim()}>
      <summary>
        <Terminal size={15} aria-hidden="true" />
        <span>{label}</span>
        <span className="output-meta">{lineCount} 行</span>
        <ChevronDown size={15} className="summary-chevron" aria-hidden="true" />
      </summary>
      {children}
    </details>
  );
}

function iconFor(item: TimelineItemDto) {
  if (item.type === "user") return <UserRound size={17} />;
  if (item.type === "assistant") return <Bot size={17} />;
  if (item.type === "reasoning") return <Brain size={17} />;
  if (item.type === "plan") return <CheckSquare size={17} />;
  if (item.type === "command") return <Terminal size={17} />;
  if (item.type === "fileChange") return <FileDiff size={17} />;
  if (item.title === "网页搜索") return <Search size={17} />;
  return <CircleDot size={17} />;
}

function TimelineItem({
  item,
  onEditUserMessage,
}: {
  item: TimelineItemDto;
  onEditUserMessage: (text: string) => void;
}) {
  if (item.type === "user") {
    return (
      <article className="timeline-entry user-entry" data-item-id={item.id}>
        <div className="user-message-wrap">
          <div className="user-message">
            {item.images.length ? (
              <div className="message-images">
                {item.images.map((image, index) =>
                  image.url ? (
                    <a
                      href={image.url}
                      target="_blank"
                      rel="noreferrer"
                      key={`${image.url}-${index}`}
                    >
                      <img src={image.url} alt={image.alt} loading="lazy" />
                    </a>
                  ) : (
                    <span className="image-placeholder" key={index}>
                      <Image size={18} />
                      {image.alt}
                    </span>
                  ),
                )}
              </div>
            ) : null}
            {item.text ? <MarkdownContent>{item.text}</MarkdownContent> : null}
          </div>
          {item.text ? (
            <button
              type="button"
              className="edit-message-button"
              onClick={() => onEditUserMessage(item.text ?? "")}
              title="重新编辑"
              aria-label="重新编辑这条指令"
            >
              <PencilLine size={15} />
            </button>
          ) : null}
        </div>
      </article>
    );
  }

  if (item.type === "reasoning") {
    return (
      <details
        className="timeline-entry reasoning-entry"
        data-item-id={item.id}
      >
        <summary>
          {iconFor(item)}
          <span>{item.title}</span>
          <ChevronDown size={16} className="summary-chevron" />
        </summary>
        {item.text ? (
          <MarkdownContent className="entry-text">{item.text}</MarkdownContent>
        ) : null}
      </details>
    );
  }

  return (
    <article
      className={`timeline-entry entry-${item.type}`}
      data-item-id={item.id}
    >
      <header className="entry-header">
        <span className="entry-icon">{iconFor(item)}</span>
        <strong>
          {item.title || (item.type === "assistant" ? "Codex" : "事件")}
        </strong>
        {item.status ? (
          <span className="entry-status">{item.status}</span>
        ) : null}
      </header>
      {item.text ? (
        <MarkdownContent className="entry-text">{item.text}</MarkdownContent>
      ) : null}
      {item.command ? (
        <div className="command-block">
          <div className="command-line">$ {item.command}</div>
          {item.cwd ? <div className="command-cwd">{item.cwd}</div> : null}
          {item.output ? (
            <OutputDisclosure label="查看输出" value={item.output}>
              <pre>{item.output}</pre>
            </OutputDisclosure>
          ) : null}
          {item.exitCode !== null ? (
            <div
              className={`exit-code ${item.exitCode === 0 ? "success" : "failed"}`}
            >
              exit {item.exitCode}
            </div>
          ) : null}
        </div>
      ) : null}
      {item.output && !item.command ? (
        <OutputDisclosure label="查看输出" value={item.output}>
          <pre>{item.output}</pre>
        </OutputDisclosure>
      ) : null}
      {item.fileChanges.map((change) => (
        <section className="file-change" key={`${item.id}-${change.path}`}>
          <header>
            <span>{change.path}</span>
            <span>{change.kind}</span>
          </header>
          {change.diff ? (
            <OutputDisclosure
              className="diff-disclosure"
              label="查看 diff"
              value={change.diff}
            >
              <Diff diff={change.diff} />
            </OutputDisclosure>
          ) : null}
        </section>
      ))}
    </article>
  );
}

export function Timeline({ turns, loading, onEditUserMessage }: TimelineProps) {
  if (loading) {
    return (
      <div className="timeline-loading">
        <span className="pulse-line" />
        <span className="pulse-line short" />
      </div>
    );
  }
  if (turns.length === 0) {
    return <div className="timeline-empty">暂无消息</div>;
  }
  return (
    <div className="timeline" aria-live="polite">
      {turns.map((turn) => (
        <section className="turn" key={turn.id} data-turn-id={turn.id}>
          {turn.items.map((item) => (
            <TimelineItem
              item={item}
              onEditUserMessage={onEditUserMessage}
              key={item.id}
            />
          ))}
          {turn.status === "inProgress" ? (
            <div className="turn-progress">
              <span />
              <span />
              <span />
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}
