import { useState } from "react";
import MainMenu from "@/components/MainMenu";
import Game from "@/components/Game";
import Scene from "@/components/Scene";

export default function Home() {
  const [screen, setScreen] = useState<"menu" | "game">("menu");

  return (
    <Scene>
      {screen === "menu" ? (
        <MainMenu onStart={() => setScreen("game")} />
      ) : (
        <Game onExit={() => setScreen("menu")} />
      )}
    </Scene>
  );
}
