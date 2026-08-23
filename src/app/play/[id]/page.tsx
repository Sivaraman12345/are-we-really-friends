"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";

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

  /* ── Fetch a scenario given explicit IDs ────────────────── */
  const fetchScenario = useCallback(
    async (testId: string, pid: string) => {
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
          setState({ kind: "completed" });
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
    []
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
      await fetchScenario(s.testId, s.participantId);
    })();

    return () => {
      cancelled = true;
    };
  }, [participantId, fetchScenario]);


  /* ── Submit choice ─────────────────────────────────────── */
  async function submitChoice() {
    if (
      !session ||
      !selectedChoice ||
      state.kind !== "playing"
    )
      return;

    const scenario = state.scenario;
    setState({ kind: "submitting", scenario, chosenOption: selectedChoice });

    try {
      const res = await fetch(`/api/tests/${session.testId}/choice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participant_id: session.participantId,
          scenario_index: scenario.scenario_index,
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
        // Brief transition before showing completed state
        setIsTransitioning(true);
        setTimeout(() => {
          setState({ kind: "completed" });
          setIsTransitioning(false);
        }, 600);
        return;
      }

      // Transition to next scenario
      setIsTransitioning(true);
      setTimeout(() => {
        setIsTransitioning(false);
        fetchScenario(session.testId, session.participantId);
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

  // Loading
  if (state.kind === "loading") {
    return (
      <div className="play-page">
        <div className="play-container">
          <header className="play-header">
            <span className="play-logo">A.W.R.F.</span>
          </header>
          <div className="play-loading">
            <div className="play-loading-spinner" />
            <p className="play-loading-text">Preparing your scenario…</p>
          </div>
        </div>
      </div>
    );
  }

  // Error
  if (state.kind === "error") {
    return (
      <div className="play-page">
        <div className="play-container">
          <header className="play-header">
            <span className="play-logo">A.W.R.F.</span>
          </header>
          <div className="play-error">
            <h2 className="play-error-title">Something went wrong</h2>
            <p className="play-error-message">{state.message}</p>
            <button
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

  // Completed
  if (state.kind === "completed") {
    return (
      <div className="play-page">
        <div className="play-container">
          <header className="play-header">
            <span className="play-logo">A.W.R.F.</span>
            <span className="play-progress-label">COMPLETE</span>
          </header>
          <div className="play-completed">
            <span className="play-completed-number">08 / 08</span>
            <h2 className="play-completed-title">
              Your answers
              <br />
              have been <em>recorded.</em>
            </h2>
            <p className="play-completed-sub">
              The experiment is half over. Now send the link to your friend
              and wait for them to complete their side.
            </p>
            <button
              className="play-completed-cta"
              onClick={() => {
                // TODO: Navigate to result/share page once implemented
                router.push("/");
              }}
            >
              CONTINUE
              <span className="play-cta-arrow">→</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Playing or Submitting
  const scenario = state.scenario;
  const scenarioNum = String(scenario.scenario_index + 1).padStart(2, "0");
  const totalNum = String(scenario.total_scenarios).padStart(2, "0");
  const themeLabel =
    THEME_LABELS[scenario.scenario.theme] || scenario.scenario.theme.toUpperCase();
  const isSubmitting = state.kind === "submitting";

  return (
    <div className="play-page">
      <div className={`play-container ${isTransitioning ? "play-fade-out" : "play-fade-in"}`}>
        {/* Header */}
        <header className="play-header">
          <span className="play-logo">A.W.R.F.</span>
          <span className="play-progress-label">
            {scenarioNum} / {totalNum}
          </span>
        </header>

        {/* Progress Bar */}
        <div className="play-progress-bar">
          <div
            className="play-progress-fill"
            style={{
              width: `${((scenario.scenario_index) / scenario.total_scenarios) * 100}%`,
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
          {scenario.scenario.choices.map((choice, index) => (
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
          ))}
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
