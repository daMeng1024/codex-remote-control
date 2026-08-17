import type { CreateThreadInput, SelectOptionDto } from "@codex-remote/shared";
import { Folder, LoaderCircle, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

interface NewThreadDialogProps {
  open: boolean;
  workspaceRoot: string;
  models: SelectOptionDto[];
  onClose: () => void;
  onCreate: (input: CreateThreadInput) => Promise<void>;
}

export function NewThreadDialog(props: NewThreadDialogProps) {
  const [cwd, setCwd] = useState(props.workspaceRoot);
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => setCwd(props.workspaceRoot), [props.workspaceRoot]);
  if (!props.open) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await props.onCreate({ cwd, prompt, model: model || undefined });
      setPrompt("");
      props.onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建失败。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-thread-title"
        onSubmit={submit}
      >
        <header>
          <h2 id="new-thread-title">新建会话</h2>
          <button
            type="button"
            className="icon-button"
            onClick={props.onClose}
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </header>
        <label>
          <span>工作目录</span>
          <div className="input-with-icon">
            <Folder size={17} />
            <input
              value={cwd}
              onChange={(event) => setCwd(event.target.value)}
            />
          </div>
        </label>
        <label>
          <span>模型</span>
          <select
            value={model}
            onChange={(event) => setModel(event.target.value)}
          >
            <option value="">默认模型</option>
            {props.models.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>任务</span>
          <textarea
            rows={6}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            autoFocus
          />
        </label>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <footer>
          <button
            type="button"
            className="secondary-button"
            onClick={props.onClose}
          >
            取消
          </button>
          <button
            className="primary-button"
            type="submit"
            disabled={submitting || !prompt.trim()}
          >
            {submitting ? <LoaderCircle className="spin" size={17} /> : null}
            创建
          </button>
        </footer>
      </form>
    </div>
  );
}
