export default function MainMenu({ onStart }: { onStart: () => void }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-green-900 text-white">
      <h1 className="text-5xl font-bold">title pending</h1>
      <button
        onClick={onStart}
        className="rounded-lg bg-white px-8 py-3 text-lg font-semibold text-green-900 hover:bg-green-100"
      >
        Start Game
      </button>
    </main>
  );
}
