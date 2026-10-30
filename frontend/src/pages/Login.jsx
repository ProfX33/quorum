import { useState } from 'react';
import { loginWithWallet } from '../api';

export default function Login({ onLogin }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleLogin() {
    setBusy(true);
    setError('');
    try {
      const { user } = await loginWithWallet();
      onLogin(user);
    } catch (e) {
      setError(e.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-xs text-center">
        <h1 className="text-xl font-medium tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-neutral-500">
          Use your BSV wallet. An account is created automatically.
        </p>
        <button
          onClick={handleLogin}
          disabled={busy}
          className="mt-8 w-full rounded-md bg-black py-2.5 text-sm text-white transition hover:bg-neutral-800 disabled:opacity-50"
        >
          {busy ? 'Waiting for wallet…' : 'Continue with BSV wallet'}
        </button>
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      </div>
    </main>
  );
}
