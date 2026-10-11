import { useState } from "react";
import MainMenu from "@/components/MainMenu";
import Game from "@/components/Game";
import Scene from "@/components/Scene";
import type { ModeId } from "@/config/modes";
import type { CpuCount } from "@/config/layout";

export default function Home() {
  const [screen, setScreen] = useState<"menu" | "game">("menu");
  const [mode, setMode] = useState<ModeId>("regular");
  const [cpuCount, setCpuCount] = useState<CpuCount>(0);

  return (
    <Scene interactive={screen === "menu"}>
      {screen === "menu" ? (
        <MainMenu
          onStart={(m, cpus) => {
            setMode(m);
            setCpuCount(cpus);
            setScreen("game");
          }}
        />
      ) : (
        <Game mode={mode} cpuCount={cpuCount} onExit={() => setScreen("menu")} />
      )}
    </Scene>
  );
}
