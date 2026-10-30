import { useState } from 'react';
import { loginWithWallet } from '../api';

export default function Login({ onLogin, onCancel }) {
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
      <div className="card card-border bg-base-200 card-body w-full max-w-xs text-center">
        <h1 className="card-title justify-center text-xl tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-white/70">
          Use your BSV wallet. An account is created automatically.
        </p>
        <button
          onClick={handleLogin}
          disabled={busy}
          className="btn btn-block btn-primary mt-6"
        >
          {busy && <span className="loading loading-spinner loading-xs" />}
          {busy ? 'Waiting for wallet…' : 'Continue with BSV wallet'}
        </button>
        {error && <div role="alert" className="alert alert-error alert-soft mt-4 text-sm"><span>{error}</span></div>}
        <button onClick={onCancel} className="btn btn-ghost btn-sm mt-2">
          Back to marketplace
        </button>
      </div>
    </main>
  );
}
