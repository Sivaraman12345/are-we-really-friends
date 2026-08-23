"use client";

import { useState, useEffect, useCallback, use, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

/* ── Types ──────────────────────────────────────────────────── */
interface ScenarioChoice {
  id: "A" | "B" | "C";
  text: string;
}

interface ScenarioData {
  scenario_instance_id: string;
  scenario_index: number;
  total_scenarios: number;
  scenario: {
    theme: string;
    situation: string;
    choices: ScenarioChoice[];
  };
}

interface SessionData {
  testId: string;
  participantId: string;
  role: string;
  totalScenarios: number;
}

type PageState =
  | { kind: "loading" }
  | { kind: "playing"; scenario: ScenarioData }
  | { kind: "submitting"; scenario: ScenarioData; chosenOption: string }
  | { kind: "completed" }
  | { kind: "error"; message: string };

/* ── Theme Labels ───────────────────────────────────────────── */
const THEME_LABELS: Record<string, string> = {
  trust: "TRUST",
  loyalty: "LOYALTY",
  empathy: "EMPATHY",
  communication: "COMMUNICATION",
  adventure: "ADVENTURE",
  conflict_handling: "CONFLICT",
  humor: "HUMOR",
};

/* ── Native Share capability subscriptions (React 18/19 safe) ─ */
function subscribeToCapability() {
  return () => {};
}

function getShareSnapshot(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function"
  );
}

function getShareServerSnapshot(): boolean {
  return false;
}

/* ── Helper: recover session ────────────────────────────────── */
async function recoverSession(
  participantId: string
): Promise<SessionData | null> {
  // Try sessionStorage first
  if (typeof window !== "undefined") {
    const stored = sessionStorage.getItem("awrf_session");
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as SessionData;
        if (parsed.participantId === participantId && parsed.testId) {
          return parsed;
        }
      } catch {
        /* ignore bad JSON */
      }
    }
  }

  // Fallback: look up via API
  try {
    const res = await fetch(`/api/participants/${participantId}`);
    if (!res.ok) return null;
    const data = await res.json();
    const session: SessionData = {
      testId: data.test_id,
      participantId: data.participant_id,
      role: data.role,
      totalScenarios: 8,
    };
    // Re-cache
    if (typeof window !== "undefined") {
      sessionStorage.setItem("awrf_session", JSON.stringify(session));
    }
    return session;
  } catch {
    return null;
  }
}

/* ── Page Component ─────────────────────────────────────────── */
export default function PlayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: participantId } = use(params);
  const router = useRouter();

  const [session, setSession] = useState<SessionData | null>(null);
  const [state, setState] = useState<PageState>({ kind: "loading" });
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [copied, setCopied] = useState(false);

  // Subscribe to native share capability safely without effect setState
  const canNativeShare = useSyncExternalStore(
    subscribeToCapability,
    getShareSnapshot,
    getShareServerSnapshot
  );

  /* ── Share Event Analytics Logger ────────────────────────── */
  const logShareEvent = useCallback(async (testId: string) => {
    try {
      await fetch("/api/events/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test_id: testId }),
      });
    } catch (err) {
      console.error("Failed to log share event:", err);
    }
  }, []);

  /* ── Fetch a scenario given explicit IDs ────────────────── */
  const fetchScenario = useCallback(
    async (testId: string, pid: string, role: string) => {
      setState({ kind: "loading" });
      setSelectedChoice(null);

      try {
        const res = await fetch(
          `/api/tests/${testId}/next-scenario?participant_id=${pid}`
        );

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setState({
            kind: "error",
            message: err.error || `Error ${res.status}`,
          });
          return;
        }

        const data = await res.json();

        if (data.completed) {
          if (role === "B") {
            router.push(`/results/${testId}`);
          } else {
            setState({ kind: "completed" });
          }
          return;
        }

        setState({ kind: "playing", scenario: data });
      } catch (err) {
        console.error("Failed to fetch scenario:", err);
        setState({
          kind: "error",
          message: "Could not load scenario. Check your connection.",
        });
      }
    },
    [router]
  );

  /* ── Initialize: recover session + load first scenario ──── */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const s = await recoverSession(participantId);
      if (cancelled) return;

      if (!s) {
        setState({
          kind: "error",
          message: "Session not found. Please start a new test.",
        });
        return;
      }

      setSession(s);

      try {
        const res = await fetch(
          `/api/tests/${s.testId}/next-scenario?participant_id=${s.participantId}`
        );
        if (cancelled) return;

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setState({
            kind: "error",
            message: err.error || `Error ${res.status}`,
          });
          return;
        }

        const data = await res.json();
        if (cancelled) return;

        if (data.completed) {
          if (s.role === "B") {
            router.push(`/results/${s.testId}`);
          } else {
            setState({ kind: "completed" });
          }
          return;
        }

        setState({ kind: "playing", scenario: data });
      } catch (err) {
        if (cancelled) return;
        console.error("Failed to fetch initial scenario:", err);
        setState({
          kind: "error",
          message: "Could not load scenario. Check your connection.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [participantId, router]);

  /* ── Polling for Participant B completion (Participant A only) ── */
  useEffect(() => {
    if (state.kind !== "completed" || !session || session.role !== "A") {
      return;
    }

    const testId = session.testId;
    let isSubscribed = true;

    async function checkPartnerStatus() {
      try {
        const res = await fetch(`/api/tests/${testId}/join`);
        if (!res.ok || !isSubscribed) return;
        const data = await res.json();
        if (data.b_completed && isSubscribed) {
          isSubscribed = false;
          router.push(`/results/${testId}`);
        }
      } catch (err) {
        console.error("Polling partner status error:", err);
      }
    }

    // Initial check
    checkPartnerStatus();

    // Poll every 4 seconds
    const intervalId = setInterval(checkPartnerStatus, 4000);

    return () => {
      isSubscribed = false;
      clearInterval(intervalId);
    };
  }, [state.kind, session, router]);

  /* ── Copy link handler ──────────────────────────────────── */
  const handleCopyLink = async () => {
    if (!session) return;
    const testId = session.testId;
    const shareUrl = `${window.location.origin}/t/${testId}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      logShareEvent(testId);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  /* ── Native share handler ───────────────────────────────── */
  const handleNativeShare = async () => {
    if (!session) return;
    const testId = session.testId;
    const shareUrl = `${window.location.origin}/t/${testId}`;
    logShareEvent(testId);

    if (
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function"
    ) {
      try {
        await navigator.share({
          title: "Are We Really Friends?",
          text: "I took the friendship test. Answer the same 8 scenarios to reveal our friendship matrix!",
          url: shareUrl,
        });
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          console.error("Native share error:", err);
        }
      }
    } else {
      handleCopyLink();
    }
  };

  /* ── Submit choice ─────────────────────────────────────── */
  async function submitChoice() {
    if (!session || !selectedChoice || state.kind !== "playing") return;

    const currentSession = session;
    const currentScenario = state.scenario;
    setState({
      kind: "submitting",
      scenario: currentScenario,
      chosenOption: selectedChoice,
    });

    try {
      const res = await fetch(`/api/tests/${currentSession.testId}/choice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participant_id: currentSession.participantId,
          scenario_index: currentScenario.scenario_index,
          chosen_option: selectedChoice,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setState({
          kind: "error",
          message: err.error || `Submission failed (${res.status})`,
        });
        return;
      }

      const result = await res.json();

      if (result.all_done) {
        if (currentSession.role === "B") {
          setIsTransitioning(true);
          setTimeout(() => {
            router.push(`/results/${currentSession.testId}`);
          }, 400);
          return;
        }

        // Brief transition before showing completed state for Participant A
        setIsTransitioning(true);
        setTimeout(() => {
          setState({ kind: "completed" });
          setIsTransitioning(false);
        }, 500);
        return;
      }

      // Transition to next scenario
      setIsTransitioning(true);
      setTimeout(() => {
        setIsTransitioning(false);
        fetchScenario(
          currentSession.testId,
          currentSession.participantId,
          currentSession.role
        );
      }, 400);
    } catch (err) {
      console.error("Failed to submit choice:", err);
      setState({
        kind: "error",
        message: "Submission failed. Please try again.",
      });
    }
  }

  /* ── Render ────────────────────────────────────────────── */

  // 1. Loading State
  if (state.kind === "loading") {
    return (
      <div className="play-page">
        <div className="play-container">
          <header className="play-header">
            <Link href="/" className="play-logo">
              A.W.R.F.
            </Link>
          </header>
          <div className="play-loading">
            <div className="play-loading-spinner" />
            <p className="play-loading-text">Preparing your scenario…</p>
          </div>
        </div>
      </div>
    );
  }

  // 2. Error State
  if (state.kind === "error") {
    return (
      <div className="play-page">
        <div className="play-container">
          <header className="play-header">
            <Link href="/" className="play-logo">
              A.W.R.F.
            </Link>
          </header>
          <div className="play-error">
            <h2 className="play-error-title">Something went wrong</h2>
            <p className="play-error-message">{state.message}</p>
            <button
              type="button"
              className="play-error-button"
              onClick={() => router.push("/")}
            >
              START OVER
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 3. Completed State (Participant A Completion, Share & Waiting State)
  if (state.kind === "completed") {
    if (!session) {
      return (
        <div className="play-page">
          <div className="play-container">
            <header className="play-header">
              <Link href="/" className="play-logo">
                A.W.R.F.
              </Link>
            </header>
            <div className="play-loading">
              <div className="play-loading-spinner" />
              <p className="play-loading-text">Loading session…</p>
            </div>
          </div>
        </div>
      );
    }

    const sharePath = `/t/${session.testId}`;
    const fullShareUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}${sharePath}`
        : sharePath;

    return (
      <div className="play-page">
        <div className="play-container animate-fade-up">
          <header className="play-header">
            <Link href="/" className="play-logo">
              A.W.R.F.
            </Link>
            <span className="play-progress-label">08 / 08 • COMPLETE</span>
          </header>

          <div className="play-share-card">
            <div className="play-watermark" aria-hidden="true">
              recorded
            </div>

            <span className="play-card-tag">A.W.R.F. / EXPERIMENT</span>

            <h1 className="play-share-title">
              Your answers are
              <br />
              <em>recorded.</em>
            </h1>

            <p className="play-share-desc">
              Now send this experiment to your friend. As soon as they complete
              their 8 scenarios independently, your friendship comparison matrix
              will be revealed.
            </p>

            <div className="play-share-box">
              <span className="play-share-url">{fullShareUrl}</span>
              <button
                type="button"
                className="play-share-copy-btn"
                onClick={handleCopyLink}
              >
                {copied ? "COPIED" : "COPY"}
              </button>
            </div>

            <div className="play-share-actions">
              <button
                type="button"
                className="play-btn-primary"
                onClick={handleCopyLink}
              >
                {copied ? "LINK COPIED!" : "COPY INVITATION LINK"}
                <span className="play-cta-arrow">→</span>
              </button>

              {canNativeShare && (
                <button
                  type="button"
                  className="play-btn-secondary"
                  onClick={handleNativeShare}
                >
                  SHARE VIA APPS
                  <span className="play-cta-arrow">↗</span>
                </button>
              )}
            </div>

            {/* Waiting for Friend Callout */}
            <div className="play-waiting-box">
              <div className="play-waiting-header">
                <span className="play-waiting-dot" />
                <span className="play-waiting-title">
                  WAITING FOR YOUR FRIEND
                </span>
              </div>
              <p className="play-waiting-desc">
                Your friend is completing their side of the experiment. This
                page will automatically update as soon as they finish.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 4. Playing or Submitting State (state is strictly narrowed here)
  const scenario = state.scenario;
  const scenarioNum = String(scenario.scenario_index + 1).padStart(2, "0");
  const totalNum = String(scenario.total_scenarios).padStart(2, "0");
  const themeLabel =
    THEME_LABELS[scenario.scenario.theme] ||
    scenario.scenario.theme.toUpperCase();
  const isSubmitting = state.kind === "submitting";

  return (
    <div className="play-page">
      <div
        className={`play-container ${isTransitioning ? "play-fade-out" : "play-fade-in"}`}
      >
        {/* Header */}
        <header className="play-header">
          <Link href="/" className="play-logo">
            A.W.R.F.
          </Link>
          <span className="play-progress-label">
            {scenarioNum} / {totalNum}
          </span>
        </header>

        {/* Progress Bar */}
        <div className="play-progress-bar">
          <div
            className="play-progress-fill"
            style={{
              width: `${(scenario.scenario_index / scenario.total_scenarios) * 100}%`,
            }}
          />
        </div>

        {/* Theme Tag */}
        <div className="play-theme-tag">{themeLabel}</div>

        {/* Scenario Question */}
        <div className="play-question-container">
          <h1 className="play-question">{scenario.scenario.situation}</h1>
        </div>

        {/* Choices */}
        <div className="play-choices">
          {scenario.scenario.choices.map(
            (choice: ScenarioChoice, index: number) => (
              <button
                key={choice.id}
                type="button"
                className={`play-choice ${
                  selectedChoice === choice.id ? "play-choice-selected" : ""
                } ${isSubmitting ? "play-choice-disabled" : ""}`}
                onClick={() => {
                  if (!isSubmitting) setSelectedChoice(choice.id);
                }}
                disabled={isSubmitting}
              >
                <span className="play-choice-letter">
                  {String.fromCharCode(65 + index)}
                </span>
                <span className="play-choice-text">{choice.text}</span>
              </button>
            )
          )}
        </div>

        {/* Next Button */}
        <div className="play-nav">
          <button
            type="button"
            className={`play-next-button ${!selectedChoice ? "play-next-disabled" : ""} ${
              isSubmitting ? "play-next-loading" : ""
            }`}
            onClick={submitChoice}
            disabled={!selectedChoice || isSubmitting}
          >
            {isSubmitting ? (
              <>
                <span className="play-loading-spinner-sm" />
                SUBMITTING…
              </>
            ) : scenario.scenario_index < scenario.total_scenarios - 1 ? (
              <>
                NEXT SCENARIO
                <span className="play-cta-arrow">→</span>
              </>
            ) : (
              <>
                FINISH
                <span className="play-cta-arrow">→</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
