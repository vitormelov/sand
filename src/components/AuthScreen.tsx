import { useState } from 'react';
import { ApiError, ERROR_TEXT, login, register, resetPassword, type Me } from '../services/account';

interface Props {
  onAuthed: (me: Me) => void;
}

export function AuthScreen({ onAuthed }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const forgot = async () => {
    setError(null);
    setNotice(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Digite seu e-mail acima para receber o link.');
    setBusy(true);
    try {
      await resetPassword(email);
      setNotice('Se houver uma conta com este e-mail, enviamos um link para criar uma nova senha.');
    } catch (err) {
      setError(err instanceof ApiError ? (ERROR_TEXT[err.code] ?? 'Não foi possível enviar agora.') : 'Sem conexão com o servidor.');
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (mode === 'register' && password.length < 8) return setError(ERROR_TEXT.weak_password);
    setBusy(true);
    try {
      onAuthed(mode === 'login' ? await login(email, password) : await register(email, password));
    } catch (err) {
      setError(err instanceof ApiError ? (ERROR_TEXT[err.code] ?? 'Não foi possível entrar agora.') : 'Sem conexão com o servidor.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <form className="auth__inner" onSubmit={submit} noValidate>
        <p className="auth__brand">SAND</p>
        <h1 className="onboarding__title">{mode === 'login' ? 'Entrar' : 'Criar conta'}</h1>
        <p className="onboarding__text">Notícias reais caem como areia. O tamanho de cada grão estima o impacto do acontecimento na sua vida.</p>
        <label className="field">
          <span>E-mail</span>
          <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label className="field">
          <span>Senha{mode === 'register' ? ' (mínimo 8 caracteres)' : ''}</span>
          <input
            className="input"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === 'register' ? 8 : undefined}
          />
        </label>
        {error && (
          <p className="auth__error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="hint" role="status">
            {notice}
          </p>
        )}
        <button className="btn auth__submit" type="submit" disabled={busy}>
          {busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}
        </button>
        <p className="hint">
          {mode === 'login' ? 'Ainda não tem conta? ' : 'Já tem conta? '}
          <button
            type="button"
            className="link-btn link-btn--inline"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError(null);
            }}
          >
            {mode === 'login' ? 'Criar conta' : 'Entrar'}
          </button>
        </p>
        {mode === 'login' && (
          <p className="hint">
            <button type="button" className="link-btn link-btn--inline" onClick={() => void forgot()} disabled={busy}>
              Esqueci a senha
            </button>
          </p>
        )}
      </form>
    </div>
  );
}
