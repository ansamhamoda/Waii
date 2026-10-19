import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { T } from "./i18n.js";

const hasArabic = (s) => /[\u0600-\u06FF]/.test(s || "");
let nextId = 1;
const uid = () => nextId++;

function Mark({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="18" fill="var(--plum)" />
      <path
        d="M32 11c-7.200 0-12.500 5-12.500 11.500 0 6.500 4.500 10.500 8.500 15.500l-8.500 15h6.200l6.300-9.500 6.300 9.500H44l-8.500-15c4-5 8.500-9 8.500-15.500C44 16 39.200 11 32 11zm0 6.500c3.500 0 6 2.200 6 5 0 3.200-2.600 6.200-6 10-3.400-3.800-6-6.800-6-10 0-2.800 2.500-5 6-5z"
        fill="var(--blush)"
      />
    </svg>
  );
}

function Bubble({ msg, onRetry, t }) {
  const isUser = msg.role === "user";
  const ar = hasArabic(msg.content);
  const tt = ar ? T.ar : T.en;
  return (
    <li className={`row ${isUser ? "row-user" : "row-bot"}`}>
      {!isUser && <Mark size={32} />}
      <div className={`bubble ${isUser ? "bubble-user" : "bubble-bot"} ${msg.error ? "bubble-error" : ""}`}>
        <span className="sr-only">{isUser ? t.youSaid : t.waiiSaid}: </span>
        {msg.urgency === "urgent" && (
          <p className="alert alert-urgent" role="alert" dir={tt.dir}><strong>{tt.urgent}</strong></p>
        )}
        {msg.urgency === "see_doctor" && (
          <p className="alert alert-doctor" dir={tt.dir}>{tt.seeDoctor}</p>
        )}
        <div className="md" dir="auto">
          {isUser || msg.error ? (
            <p>{msg.content}</p>
          ) : (
            <ReactMarkdown disallowedElements={["a", "img"]} unwrapDisallowed>{msg.content}</ReactMarkdown>
          )}
        </div>
        {msg.error && (
          <button className="btn-link" onClick={onRetry}>{t.retry}</button>
        )}
        {msg.sources?.length > 0 && (
          <div className="sources" dir={tt.dir}>
            <p className="sources-title">{tt.sources}</p>
            <ul>
              {msg.sources.map((s) => (
                <li key={s.id}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer">{s.org}</a>
                  <span className="src-title"> — {s.title}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </li>
  );
}

function Resources({ t, onClose, sources }) {
  const closeRef = useRef(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="overlay" onClick={onClose}>
      <section className="panel" role="dialog" aria-modal="true" aria-labelledby="res-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="res-title">{t.resources}</h2>
        <p>{t.resourcesIntro}</p>
        <ul className="res-list">
          {sources.map((s) => (
            <li key={s.id}>
              <a href={s.url} target="_blank" rel="noopener noreferrer">{s.org}</a>
              <span>{s.title}</span>
            </li>
          ))}
        </ul>
        <button ref={closeRef} className="btn-secondary" onClick={onClose}>{t.close}</button>
      </section>
    </div>
  );
}

export default function App() {
  const [lang, setLang] = useState(() => (navigator.language || "en").toLowerCase().startsWith("ar") ? "ar" : "en");
  const t = T[lang];
  const [messages, setMessages] = useState([]); // real conversation only (no welcome)
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showRes, setShowRes] = useState(false);
  const [sources, setSources] = useState([]);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = t.dir;
  }, [lang, t.dir]);

  useEffect(() => {
    fetch("/api/sources").then((r) => r.json()).then(setSources).catch(() => {});
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "end" });
  }, [messages, loading]);

  const started = messages.length > 0;

  async function ask(history) {
    setLoading(true);
    try {
      const payload = history.filter((m) => !m.error).map(({ role, content }) => ({ role, content }));
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payload })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message || t.offline);
      setMessages([...history, { id: uid(), role: "assistant", content: data.reply, urgency: data.urgency, sources: data.sources }]);
    } catch (e) {
      const msg = e instanceof TypeError ? t.offline : e.message;
      setMessages([...history, { id: uid(), role: "assistant", content: msg, error: true }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function send(text) {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    setInput("");
    const history = [...messages.filter((m) => !m.error), { id: uid(), role: "user", content }];
    setMessages(history);
    ask(history);
  }

  function retry() {
    const history = messages.filter((m) => !m.error);
    if (history.length) ask(history);
  }

  function newChat() {
    if (started && !window.confirm(t.newChatConfirm)) return;
    setMessages([]);
    setInput("");
    inputRef.current?.focus();
  }

  const welcome = useMemo(() => ({ id: 0, role: "assistant", content: t.welcome }), [t.welcome]);

  return (
    <div className="app">
      <a className="skip" href="#composer">Skip to message box</a>
      <header className="top">
        <div className="brand">
          <Mark />
          <div>
            <p className="brand-name"><span lang="en">Waii</span> <span className="brand-ar" lang="ar">| وَعي</span></p>
            <p className="brand-tag">{t.tagline}</p>
          </div>
        </div>
        <nav className="actions" aria-label="Tools">
          <button className="btn-ghost" onClick={() => setShowRes(true)}>{t.resources}</button>
          <button className="btn-ghost" onClick={newChat}>{t.newChat}</button>
          <button className="btn-ghost" onClick={() => setLang(lang === "en" ? "ar" : "en")} aria-label={t.langSwitchLabel} lang={lang === "en" ? "ar" : "en"}>
            {t.langSwitch}
          </button>
        </nav>
      </header>

      <main className="main">
        {!started && (
          <section className="hero">
            <p className="wordmark" lang="ar" aria-hidden="true">وَعي</p>
            <h1>{t.heroTitle}</h1>
            <p className="hero-text">{t.heroText}</p>
          </section>
        )}

        <ol className="log" aria-live="polite" aria-label="Conversation">
          <Bubble msg={welcome} t={t} />
          {messages.map((m) => (
            <Bubble key={m.id} msg={m} t={t} onRetry={retry} />
          ))}
          {loading && (
            <li className="row row-bot">
              <Mark size={32} />
              <div className="bubble bubble-bot typing" role="status" aria-label={t.thinking}><i /><i /><i /></div>
            </li>
          )}
        </ol>

        {!started && (
          <section className="starters" aria-labelledby="starters-title">
            <h2 id="starters-title">{t.startersTitle}</h2>
            <ul>
              {t.starters.map((s) => (
                <li key={s}><button onClick={() => send(s)} disabled={loading}>{s}</button></li>
              ))}
            </ul>
          </section>
        )}
        <div ref={endRef} />
      </main>

      <footer className="dock">
        <div className="composer" id="composer">
          <label htmlFor="msg" className="sr-only">{t.inputLabel}</label>
          <textarea
            id="msg"
            ref={inputRef}
            rows={1}
            value={input}
            maxLength={2000}
            placeholder={t.placeholder}
            dir="auto"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="btn-send" onClick={() => send()} disabled={loading || !input.trim()}>{t.send}</button>
        </div>
        <p className="foot">{t.footer}</p>
      </footer>

      {showRes && <Resources t={t} sources={sources} onClose={() => setShowRes(false)} />}
    </div>
  );
}
