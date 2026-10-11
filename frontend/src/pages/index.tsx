import { useEffect, useState } from "react";
import MainMenu from "@/components/MainMenu";
import Game from "@/components/Game";
import Scene from "@/components/Scene";
import AuthPage, { type AuthUser } from "@/components/AuthPage";
import type { ModeId } from "@/config/modes";
import type { CpuCount } from "@/config/layout";

export default function Home() {
  const [screen, setScreen] = useState<"menu" | "game">("menu");
  const [mode, setMode] = useState<ModeId>("regular");
  const [cpuCount, setCpuCount] = useState<CpuCount>(0);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/session")
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not restore session");
        return response.json();
      })
      .then((session: AuthUser | null) => {
        if (active) setUser(session);
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setAuthReady(true);
      });
    return () => { active = false; };
  }, []);

  async function signOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Clear the local UI even if the server cannot be reached.
    } finally {
      setUser(null);
      setScreen("menu");
    }
  }

  return (
    <Scene interactive={authReady && screen === "menu" && Boolean(user)}>
      {!authReady ? (
        <main className="auth-page"><p role="status">Restoring your session…</p></main>
      ) : !user ? (
        <AuthPage onAuthenticated={setUser} />
      ) : screen === "menu" ? (
        <MainMenu
          username={user.username}
          onSignOut={signOut}
          onStart={(m, cpus) => {
            setMode(m);
            setCpuCount(cpus);
            setScreen("game");
          }}
        />
      ) : (
        <Game mode={mode} cpuCount={cpuCount} userId={user.id} onExit={() => setScreen("menu")} />
      )}
    </Scene>
  );
}
