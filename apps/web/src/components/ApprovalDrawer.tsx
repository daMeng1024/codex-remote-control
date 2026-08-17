import type {
  ApprovalResponseInput,
  PendingRequestDto,
} from "@codex-remote/shared";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

interface ApprovalDrawerProps {
  requests: PendingRequestDto[];
  disabled?: boolean;
  onRespond: (id: string, input: ApprovalResponseInput) => Promise<void>;
}

export function ApprovalDrawer({
  requests,
  disabled,
  onRespond,
}: ApprovalDrawerProps) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const request = requests[index];

  useEffect(() => {
    if (index >= requests.length) setIndex(Math.max(0, requests.length - 1));
  }, [index, requests.length]);

  useEffect(() => {
    setAnswers({});
    setError("");
  }, [request?.id]);

  if (!request) return null;

  const respond = async (input: ApprovalResponseInput) => {
    setSubmitting(true);
    setError("");
    try {
      await onRespond(request.id, input);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "处理失败。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      className="approval-drawer"
      role="dialog"
      aria-modal="false"
      aria-label="待处理请求"
    >
      <header className="approval-header">
        <span className="approval-icon">
          {request.kind === "userInput" ? (
            <ShieldCheck size={20} />
          ) : (
            <AlertTriangle size={20} />
          )}
        </span>
        <div>
          <strong>{request.title}</strong>
          <span>{request.threadId.slice(0, 8)}</span>
        </div>
        {requests.length > 1 ? (
          <div className="approval-pagination">
            <button
              className="icon-button"
              aria-label="上一个请求"
              onClick={() => setIndex((value) => Math.max(0, value - 1))}
              disabled={index === 0}
            >
              <ChevronLeft size={17} />
            </button>
            <span>
              {index + 1}/{requests.length}
            </span>
            <button
              className="icon-button"
              aria-label="下一个请求"
              onClick={() =>
                setIndex((value) => Math.min(requests.length - 1, value + 1))
              }
              disabled={index === requests.length - 1}
            >
              <ChevronRight size={17} />
            </button>
          </div>
        ) : null}
      </header>

      <div className="approval-body">
        {request.reason ? (
          <p className="approval-reason">{request.reason}</p>
        ) : null}
        {request.command ? (
          <pre className="approval-command">$ {request.command}</pre>
        ) : null}
        {request.cwd ? <div className="approval-cwd">{request.cwd}</div> : null}
        {request.questions.map((question) => (
          <label className="approval-question" key={question.id}>
            <span>{question.header}</span>
            <small>{question.question}</small>
            {question.options ? (
              <select
                value={answers[question.id]?.[0] ?? ""}
                onChange={(event) =>
                  setAnswers((current) => ({
                    ...current,
                    [question.id]: event.target.value
                      ? [event.target.value]
                      : [],
                  }))
                }
              >
                <option value="">请选择</option>
                {question.options.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={question.isSecret ? "password" : "text"}
                value={answers[question.id]?.[0] ?? ""}
                onChange={(event) =>
                  setAnswers((current) => ({
                    ...current,
                    [question.id]: [event.target.value],
                  }))
                }
              />
            )}
          </label>
        ))}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <footer className="approval-actions">
        {request.kind === "userInput" ? (
          <button
            className="primary-button"
            disabled={submitting || disabled}
            onClick={() => void respond({ answers })}
          >
            提交
          </button>
        ) : (
          request.decisions.map((decision) => (
            <button
              key={decision.id}
              className={
                decision.tone === "primary"
                  ? "primary-button"
                  : decision.tone === "danger"
                    ? "danger-button"
                    : "secondary-button"
              }
              disabled={submitting || disabled}
              onClick={() => void respond({ decisionId: decision.id, answers })}
            >
              {decision.label}
            </button>
          ))
        )}
        <X size={1} aria-hidden="true" className="approval-spacer" />
      </footer>
    </section>
  );
}
