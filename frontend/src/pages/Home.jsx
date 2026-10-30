import { logout } from '../api';

export default function Home({ user, onLogout }) {
  async function handleLogout() {
    await logout();
    onLogout();
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-xl font-medium tracking-tight">Signed in</h1>
        <p className="mt-2 break-all font-mono text-xs text-neutral-500">{user.identityKey}</p>
        <button
          onClick={handleLogout}
          className="mt-8 text-sm text-neutral-500 underline-offset-4 hover:text-black hover:underline"
        >
          Sign out
        </button>
      </div>
    </main>
  );
}
