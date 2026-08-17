import { KeyRound, LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";

interface LoginViewProps {
  onLogin: (password: string) => Promise<void>;
}

export function LoginView({ onLogin }: LoginViewProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await onLogin(password);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-shell">
      <form className="login-panel" onSubmit={submit}>
        <div className="brand-mark" aria-hidden="true">
          <span>&gt;_</span>
        </div>
        <h1>Codex 工作台</h1>
        <label htmlFor="password">访问口令</label>
        <div className="password-field">
          <KeyRound size={18} aria-hidden="true" />
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
          />
        </div>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button
          className="primary-button login-button"
          type="submit"
          disabled={submitting}
        >
          {submitting ? <LoaderCircle className="spin" size={18} /> : null}
          登录
        </button>
      </form>
    </main>
  );
}
