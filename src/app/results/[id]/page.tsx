"use client";

import { useState, useEffect, useCallback, use, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  DIMENSIONS,
  type Dimension,
  type DimensionScores,
} from "@/lib/types";

/* ── Types ──────────────────────────────────────────────────── */
interface ResultApiResponse {
  test_id: string;
  bond_score: number;
  strongest_dimension: Dimension;
  most_different_dimension: Dimension;
  friendship_type: string;
  narrative: string;
  names?: {
    a: string | null;
    b: string | null;
  };
  scores: {
    a: DimensionScores | null;
    b: DimensionScores | null;
  };
}

type ResultPageState =
  | { kind: "loading" }
  | { kind: "ready"; data: ResultApiResponse }
  | { kind: "incomplete"; aCompleted: boolean; bCompleted: boolean }
  | { kind: "error"; message: string; notFound?: boolean };

/* ── Dimension Display Meta ─────────────────────────────────── */
const DIMENSION_META: Record<
  Dimension,
  { label: string; description: string }
> = {
  trust: {
    label: "Trust",
    description: "Vulnerability, reliability, and emotional safety.",
  },
  loyalty: {
    label: "Loyalty",
    description: "Steadfast support when stakes and pressures are high.",
  },
  empathy: {
    label: "Empathy",
    description: "Understanding unspoken feelings and emotional cues.",
  },
  communication: {
    label: "Communication",
    description: "Clarity, honesty, and openness in dialogue.",
  },
  adventure: {
    label: "Adventure",
    description: "Spontaneity, shared exploration, and bold choices.",
  },
  conflict_handling: {
    label: "Conflict Handling",
    description: "Resolving friction constructively without resentment.",
  },
  humor: {
    label: "Humor",
    description: "Shared wavelength, playful banter, and levity.",
  },
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

/* ── Page Component ─────────────────────────────────────────── */
export default function ResultsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: testId } = use(params);

  const [state, setState] = useState<ResultPageState>({ kind: "loading" });
  const [copied, setCopied] = useState(false);

  // Subscribe to native share capability safely without effect setState
  const canNativeShare = useSyncExternalStore(
    subscribeToCapability,
    getShareSnapshot,
    getShareServerSnapshot
  );

  /* ── Share Event Analytics Logger ────────────────────────── */
  const logShareEvent = useCallback(async (tId: string) => {
    try {
      await fetch("/api/events/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test_id: tId }),
      });
    } catch (err) {
      console.error("Failed to log share event:", err);
    }
  }, []);

  /* ── Query Test Results (pure async fetch) ────────────────── */
  const queryResult = useCallback(async (): Promise<ResultPageState> => {
    try {
      const res = await fetch(`/api/tests/${testId}/result`);

      if (!res.ok) {
        if (res.status === 404) {
          return {
            kind: "error",
            message: "This test was not found or has expired.",
            notFound: true,
          };
        }
        if (res.status === 400) {
          const data = await res.json().catch(() => ({}));
          return {
            kind: "incomplete",
            aCompleted: !!data.a_completed,
            bCompleted: !!data.b_completed,
          };
        }
        const errData = await res.json().catch(() => ({}));
        return {
          kind: "error",
          message:
            errData.error || `Unable to load results (Status ${res.status}).`,
        };
      }

      const data: ResultApiResponse = await res.json();
      return { kind: "ready", data };
    } catch (err) {
      console.error("Failed to load result:", err);
      return {
        kind: "error",
        message:
          "Could not connect to the server. Please check your connection.",
      };
    }
  }, [testId]);

  /* ── Mount / Initial Load Effect ──────────────────────────── */
  useEffect(() => {
    let ignore = false;

    queryResult().then((result) => {
      if (!ignore) {
        setState(result);
      }
    });

    return () => {
      ignore = true;
    };
  }, [queryResult]);

  /* ── User-initiated Refresh Handler ────────────────────────── */
  const handleRefresh = async () => {
    setState({ kind: "loading" });
    const result = await queryResult();
    setState(result);
  };

  /* ── Copy Link Handler ────────────────────────────────────── */
  const handleCopyLink = async () => {
    const shareUrl =
      typeof window !== "undefined"
        ? window.location.href
        : `/results/${testId}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      logShareEvent(testId);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  /* ── Native Share Handler ─────────────────────────────────── */
  const handleNativeShare = async () => {
    const shareUrl =
      typeof window !== "undefined"
        ? window.location.href
        : `/results/${testId}`;
    logShareEvent(testId);

    if (
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function"
    ) {
      const nameA =
        state.kind === "ready" && state.data.names?.a?.trim()
          ? state.data.names.a.trim()
          : "Participant A";
      const nameB =
        state.kind === "ready" && state.data.names?.b?.trim()
          ? state.data.names.b.trim()
          : "Participant B";
      const friendshipType =
        state.kind === "ready" ? state.data.friendship_type : "Friendship Matrix";
      const bondScore = state.kind === "ready" ? state.data.bond_score : 0;

      try {
        await navigator.share({
          title: `Are We Really Friends? — ${nameA} × ${nameB}`,
          text: `${nameA} × ${nameB} scored ${bondScore}% on Are We Really Friends? (${friendshipType}). See our friendship matrix:`,
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

  /* ── State 1: Loading ─────────────────────────────────────── */
  if (state.kind === "loading") {
    return (
      <div className="results-page">
        <div className="results-container">
          <header className="results-header">
            <Link href="/" className="results-logo">
              A.W.R.F.
            </Link>
            <span className="results-label">VOL. 01 / RESULTS</span>
          </header>
          <div className="results-content-center animate-fade-up animate-delay-1">
            <div className="results-loading-spinner" />
            <p className="results-loading-text">
              Computing friendship matrix…
            </p>
          </div>
        </div>
      </div>
    );
  }

  /* ── State 2: Error / Not Found ───────────────────────────── */
  if (state.kind === "error") {
    return (
      <div className="results-page">
        <div className="results-container">
          <header className="results-header">
            <Link href="/" className="results-logo">
              A.W.R.F.
            </Link>
            <span className="results-label">VOL. 01 / RESULTS</span>
          </header>
          <div className="results-card animate-fade-up animate-delay-1">
            <span className="results-card-tag">STATUS</span>
            <h1 className="results-card-title">
              {state.notFound ? "Result Not Found" : "Unable to Load Matrix"}
            </h1>
            <p className="results-card-description">{state.message}</p>
            <div className="results-card-actions">
              <button
                type="button"
                className="results-btn-secondary"
                onClick={handleRefresh}
              >
                RETRY
              </button>
              <Link href="/" className="results-btn-primary">
                START A NEW TEST
                <span className="results-cta-arrow">→</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── State 3: Incomplete (One or both participants not done) ── */
  if (state.kind === "incomplete") {
    return (
      <div className="results-page">
        <div className="results-container">
          <header className="results-header">
            <Link href="/" className="results-logo">
              A.W.R.F.
            </Link>
            <span className="results-label">VOL. 01 / IN PROGRESS</span>
          </header>
          <div className="results-card animate-fade-up animate-delay-1">
            <span className="results-card-tag">IN PROGRESS</span>
            <h1 className="results-card-title">
              The experiment isn&apos;t
              <br />
              <em>complete yet.</em>
            </h1>
            <p className="results-card-description">
              Both friends need to finish all eight scenarios before the result
              and friendship matrix can be calculated.
            </p>

            <div className="results-incomplete-status">
              <div className="results-participant-row">
                <span className="results-participant-name">Participant A</span>
                <span
                  className={
                    state.aCompleted
                      ? "results-status-badge complete"
                      : "results-status-badge pending"
                  }
                >
                  {state.aCompleted ? "COMPLETED" : "IN PROGRESS"}
                </span>
              </div>
              <div className="results-participant-row">
                <span className="results-participant-name">Participant B</span>
                <span
                  className={
                    state.bCompleted
                      ? "results-status-badge complete"
                      : "results-status-badge pending"
                  }
                >
                  {state.bCompleted ? "COMPLETED" : "WAITING / IN PROGRESS"}
                </span>
              </div>
            </div>

            <div className="results-card-actions">
              <button
                type="button"
                className="results-btn-primary"
                onClick={handleRefresh}
              >
                CHECK AGAIN
                <span className="results-cta-arrow">↻</span>
              </button>
              <Link href={`/t/${testId}`} className="results-btn-secondary">
                OPEN INVITATION LINK
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── State 4: Ready (Results & Comparison Display) ─────────── */
  const result = state.data;
  const scoresA = result.scores.a ?? ({} as Partial<DimensionScores>);
  const scoresB = result.scores.b ?? ({} as Partial<DimensionScores>);
  const nameA = result.names?.a?.trim() || "Participant A";
  const nameB = result.names?.b?.trim() || "Participant B";

  const strongestMeta =
    DIMENSION_META[result.strongest_dimension] ?? {
      label: result.strongest_dimension,
      description: "Highest shared alignment across choices.",
    };

  const differentMeta =
    DIMENSION_META[result.most_different_dimension] ?? {
      label: result.most_different_dimension,
      description: "Complementary strengths and differing perspectives.",
    };

  return (
    <div className="results-page">
      <div className="results-container">
        {/* Header */}
        <header className="results-header animate-fade-up">
          <Link href="/" className="results-logo">
            A.W.R.F.
          </Link>
          <span className="results-label">VOL. 01 / RESULTS</span>
        </header>

        {/* ── 1. Hero Score & Archetype ── */}
        <section className="results-hero-card animate-fade-up animate-delay-1">
          <div className="results-watermark" aria-hidden="true">
            matrix
          </div>
          <span className="results-tag">FRIENDSHIP MATRIX</span>

          {/* ── Participant Names Headline ── */}
          <div className="results-names-headline">
            <span className="results-name-item">{nameA}</span>
            <span className="results-names-cross">×</span>
            <span className="results-name-item">{nameB}</span>
          </div>

          <div className="results-score-wrapper">
            <span className="results-score-num">{result.bond_score}</span>
            <span className="results-score-percent">%</span>
          </div>

          <h1 className="results-archetype-title">
            {result.friendship_type}
          </h1>

          <div className="results-hero-legend">
            <div className="results-legend-item">
              <span className="results-legend-swatch swatch-a" />
              <span>{nameA}</span>
            </div>
            <div className="results-legend-item">
              <span className="results-legend-swatch swatch-b" />
              <span>{nameB}</span>
            </div>
          </div>
        </section>

        {/* ── 2. Dimension Matrix Breakdown ── */}
        <section className="results-matrix-card animate-fade-up animate-delay-2">
          <div className="results-section-header">
            <span className="results-section-tag">ALIGNMENT BREAKDOWN</span>
            <h2 className="results-section-title">Your Friendship Dimensions</h2>
          </div>

          <div className="results-dimensions-list">
            {DIMENSIONS.map((dim) => {
              const meta = DIMENSION_META[dim];
              const valA = scoresA[dim] ?? 50;
              const valB = scoresB[dim] ?? 50;
              const isStrongest = dim === result.strongest_dimension;
              const isDifferent = dim === result.most_different_dimension;

              return (
                <div
                  key={dim}
                  className={`results-dim-row ${isStrongest ? "row-strongest" : ""} ${
                    isDifferent ? "row-different" : ""
                  }`}
                >
                  <div className="results-dim-info">
                    <div className="results-dim-name-wrap">
                      <span className="results-dim-name">{meta.label}</span>
                      {isStrongest && (
                        <span className="results-badge-strongest">
                          STRONGEST
                        </span>
                      )}
                      {isDifferent && (
                        <span className="results-badge-different">
                          DIVERGENT
                        </span>
                      )}
                    </div>
                    <span className="results-dim-desc">{meta.description}</span>
                  </div>

                  <div className="results-dim-bars">
                    {/* Participant A Bar */}
                    <div className="results-bar-row">
                      <span className="results-bar-role role-a" title={nameA}>
                        {nameA.charAt(0).toUpperCase()}
                      </span>
                      <div className="results-bar-track">
                        <div
                          className="results-bar-fill fill-a"
                          style={{ width: `${Math.max(8, valA)}%` }}
                        />
                      </div>
                      <span className="results-bar-value">{valA}</span>
                    </div>

                    {/* Participant B Bar */}
                    <div className="results-bar-row">
                      <span className="results-bar-role role-b" title={nameB}>
                        {nameB.charAt(0).toUpperCase()}
                      </span>
                      <div className="results-bar-track">
                        <div
                          className="results-bar-fill fill-b"
                          style={{ width: `${Math.max(8, valB)}%` }}
                        />
                      </div>
                      <span className="results-bar-value">{valB}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── 3. Highlights: Strongest vs Most Different ── */}
        <section className="results-highlights-grid animate-fade-up animate-delay-3">
          <div className="results-highlight-card highlight-strong">
            <span className="results-highlight-tag">STRONGEST CONNECTION</span>
            <h3 className="results-highlight-name">{strongestMeta.label}</h3>
            <p className="results-highlight-text">
              Your highest mutual instinct. You share an instinctive common
              ground in {strongestMeta.label.toLowerCase()}, creating the bedrock of
              your connection.
            </p>
          </div>

          <div className="results-highlight-card highlight-diff">
            <span className="results-highlight-tag">MOST DIFFERENT</span>
            <h3 className="results-highlight-name">{differentMeta.label}</h3>
            <p className="results-highlight-text">
              The area of greatest contrast between your responses. You navigate{" "}
              {differentMeta.label.toLowerCase()} from different vantage points,
              adding balance and perspective to your bond.
            </p>
          </div>
        </section>

        {/* ── 4. AI Narrative Analysis ── */}
        <section className="results-narrative-card animate-fade-up animate-delay-4">
          <div className="results-section-header">
            <span className="results-section-tag">SYNTHESIS</span>
            <h2 className="results-section-title">The Dynamic Analysis</h2>
          </div>

          <div className="results-narrative-body">
            {result.narrative
              .split("\n\n")
              .filter((p) => p.trim().length > 0)
              .map((paragraph, idx) => (
                <p key={idx} className="results-narrative-paragraph">
                  {paragraph}
                </p>
              ))}
          </div>
        </section>

        {/* ── 5. Viral Loop Actions ── */}
        <section className="results-viral-card animate-fade-up animate-delay-5">
          <div className="results-viral-share-block">
            <span className="results-tag">PRESERVE & SHARE</span>
            <h2 className="results-viral-title">
              Share your <em>matrix.</em>
            </h2>
            <p className="results-viral-desc">
              Send this result to your friend group or post your alignment score.
            </p>

            <div className="results-viral-actions">
              <button
                type="button"
                className="results-btn-primary"
                onClick={canNativeShare ? handleNativeShare : handleCopyLink}
              >
                {copied ? (
                  "LINK COPIED TO CLIPBOARD!"
                ) : (
                  <>
                    SHARE YOUR RESULT
                    <span className="results-cta-arrow">↗</span>
                  </>
                )}
              </button>

              <button
                type="button"
                className="results-btn-secondary"
                onClick={handleCopyLink}
              >
                {copied ? "COPIED!" : "COPY RESULT LINK"}
              </button>
            </div>
          </div>

          <div className="results-viral-divider" />

          <div className="results-viral-next-block">
            <span className="results-next-prompt">
              Think you know someone else?
            </span>
            <h3 className="results-next-heading">
              Test another <em>friend.</em>
            </h3>
            <p className="results-next-desc">
              Start a fresh experiment with a best friend, close friend, new
              acquaintance, or crush.
            </p>
            <Link href="/" className="results-btn-gold">
              TEST ANOTHER FRIEND
              <span className="results-cta-arrow">→</span>
            </Link>
          </div>
        </section>

        {/* Footer */}
        <footer className="results-footer animate-fade-up animate-delay-6">
          <p className="results-footer-text">
            A.W.R.F. • A social experiment in connection and perception.
          </p>
        </footer>
      </div>
    </div>
  );
}
