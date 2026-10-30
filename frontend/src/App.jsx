import { useEffect, useState } from 'react';
import { fetchMe } from './api';
import Login from './pages/Login';
import Home from './pages/Home';

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading

  useEffect(() => {
    fetchMe().then(setUser);
  }, []);

  if (user === undefined) return null;
  return user ? <Home user={user} onLogout={() => setUser(null)} /> : <Login onLogin={setUser} />;
}
