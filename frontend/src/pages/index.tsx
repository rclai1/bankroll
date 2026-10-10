import { useState } from "react";
import MainMenu from "@/components/MainMenu";
import Game from "@/components/Game";
import Scene from "@/components/Scene";
import type { ModeId } from "@/config/modes";

export default function Home() {
  const [screen, setScreen] = useState<"menu" | "game">("menu");
  const [mode, setMode] = useState<ModeId>("regular");

  return (
    <Scene interactive={screen === "menu"}>
      {screen === "menu" ? (
        <MainMenu
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
