import { useState } from "react";
import MainMenu from "@/components/MainMenu";
import Game from "@/components/Game";
import Scene from "@/components/Scene";
import AuthPage, { type AuthUser } from "@/components/AuthPage";
import type { ModeId } from "@/config/modes";

export default function Home() {
  const [screen, setScreen] = useState<"menu" | "game">("menu");
  const [mode, setMode] = useState<ModeId>("regular");
  const [user, setUser] = useState<AuthUser | null>(null);

  return (
    <Scene interactive={screen === "menu" && Boolean(user)}>
      {!user ? (
        <AuthPage onAuthenticated={setUser} />
      ) : screen === "menu" ? (
        <MainMenu
          username={user.username}
          onSignOut={() => setUser(null)}
          onStart={(m) => {
            setMode(m);
            setScreen("game");
          }}
        />
      ) : (
        <Game mode={mode} onExit={() => setScreen("menu")} />
      )}
    </Scene>
  );
}
