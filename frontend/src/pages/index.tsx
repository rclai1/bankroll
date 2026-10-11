import { useEffect, useState } from "react";
import MainMenu from "@/components/MainMenu";
import Game from "@/components/Game";
import Scene from "@/components/Scene";
import AuthPage, { type AuthUser } from "@/components/AuthPage";
import type { ModeId } from "@/config/modes";
import type { CpuCount } from "@/config/layout";
import CardShop from "@/components/CardShop";
import type { CardSkin } from "@/components/Card";
import { apiFetch, clearAccessToken, getAccessToken } from "@/lib/api";

export default function Home() {
  const [screen, setScreen] = useState<"menu" | "game" | "shop">("menu");
  const [mode, setMode] = useState<ModeId>("regular");
  const [cpuCount, setCpuCount] = useState<CpuCount>(0);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [equippedSkin, setEquippedSkin] = useState<CardSkin>("default");

  useEffect(() => {
    let active = true;
    if (!getAccessToken()) {
      setAuthReady(true);
      return () => { active = false; };
    }
    apiFetch("/api/auth/session")
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not restore session");
        return response.json();
      })
      .then(async (session: AuthUser | null) => {
        if (active) setUser(session);
        if (!session) clearAccessToken();
        if (session) {
          try {
            const shop = await apiFetch("/api/shop").then((r) => r.json());
            if (active && shop.equipped_skin) setEquippedSkin(shop.equipped_skin);
          } catch {
            // Keep the account session if loading the equipped skin fails.
          }
        }
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
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Clear the local UI even if the server cannot be reached.
    } finally {
      clearAccessToken();
      setUser(null);
      setEquippedSkin("default");
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
          onShop={() => setScreen("shop")}
          onStart={(m, cpus) => {
            setMode(m);
            setCpuCount(cpus);
            setScreen("game");
          }}
        />
      ) : screen === "shop" ? (
        <CardShop onBack={() => setScreen("menu")} onSkinChange={setEquippedSkin} />
      ) : (
        <Game mode={mode} cpuCount={cpuCount} userId={user.id} equippedSkin={equippedSkin} onExit={() => setScreen("menu")} />
      )}
    </Scene>
  );
}
