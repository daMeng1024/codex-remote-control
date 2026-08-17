import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { LoginView } from "./components/LoginView";
import { Workbench } from "./components/Workbench";
import { api } from "./lib/api";

export function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    void api
      .session()
      .then((session) => setAuthenticated(session.authenticated))
      .catch(() => setAuthenticated(false));
  }, []);

  if (authenticated === null) {
    return (
      <div className="app-loading">
        <LoaderCircle className="spin" size={24} />
      </div>
    );
  }

  if (!authenticated) {
    return (
      <LoginView
        onLogin={async (password) => {
          await api.login(password);
          setAuthenticated(true);
        }}
      />
    );
  }

  return (
    <Workbench
      onLogout={async () => {
        await api.logout();
        sessionStorage.removeItem("event-sequence");
        setAuthenticated(false);
      }}
    />
  );
}
