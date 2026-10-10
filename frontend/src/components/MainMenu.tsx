export default function MainMenu({ onStart }: { onStart: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="glass fade-in flex flex-col items-center gap-10 px-12 py-14 sm:px-24">
        <h1 className="title-text text-5xl sm:text-7xl">title pending</h1>
        <button onClick={onStart} className="btn btn-green btn-lg">
          Start Game
        </button>
      </div>
    </main>
  );
}
