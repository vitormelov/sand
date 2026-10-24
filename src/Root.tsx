import { useEffect, useState } from 'react';
import { App } from './App';
import { AuthScreen } from './components/AuthScreen';
import { fetchMe, logout, type Me } from './services/account';
import { loadPrefs } from './services/storage';
import { useTheme } from './services/theme';

const query = new URLSearchParams(window.location.search);

/**
 * Entry point: login is required for the real site. The developer lab (?lab) and
 * the DEMO (?demo) use only fictitious data and skip it.
 */
export function Root() {
  const testMode = query.has('lab') || query.has('demo');
  const [me, setMe] = useState<Me | null | undefined>(testMode ? null : undefined);
  const [offline, setOffline] = useState(false);
  // Login and loading screens follow the saved theme too (the App takes over once mounted).
  useTheme(loadPrefs().theme);

  useEffect(() => {
    if (testMode) return;
    fetchMe()
      .then(setMe)
      .catch(() => {
        setOffline(true);
        setMe(null);
      });
  }, [testMode]);

  if (testMode) return <App />;
  if (me === undefined) return <p className="empty-state">Carregando…</p>;
  if (!me)
    return (
      <>
        {offline && <p className="auth__offline">Sem conexão com o servidor do SAND.</p>}
        <AuthScreen onAuthed={setMe} />
      </>
    );
  return (
    <App
      key={me.email}
      account={{
        email: me.email,
        profile: me.profile ?? { interests: [], affinity: {}, onboarded: false },
        viewed: me.viewed,
        saved: me.saved,
        onLogout: () => void logout().then(() => setMe(null)),
        onDeleted: () => setMe(null),
      }}
    />
  );
}
