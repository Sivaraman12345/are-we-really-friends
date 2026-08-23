"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

/* ── Types ──────────────────────────────────────────────────── */
interface TestJoinStatus {
  test_id: string;
  a_completed: boolean;
  b_exists: boolean;
  b_completed: boolean;
  b_participant_id: string | null;
}

type PageState =
  | { kind: "loading" }
  | { kind: "error"; message: string; notFound?: boolean }
  | { kind: "waiting_for_a"; status: TestJoinStatus }
  | { kind: "ready_to_join"; status: TestJoinStatus }
  | { kind: "b_in_progress"; status: TestJoinStatus }
  | { kind: "both_completed"; status: TestJoinStatus };

/* ── Component ──────────────────────────────────────────────── */
export default function FriendJoinPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: testId } = use(params);
  const router = useRouter();

  const [state, setState] = useState<PageState>({ kind: "loading" });
  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  /* ── Query test status (pure async fetch) ──────────────────── */
  const queryStatus = useCallback(async (): Promise<PageState> => {
    try {
      const res = await fetch(`/api/tests/${testId}/join`);

      if (!res.ok) {
        if (res.status === 404) {
          return {
            kind: "error",
            message: "This test link does not exist or has expired.",
            notFound: true,
          };
        }
        const errData = await res.json().catch(() => ({}));
        return {
          kind: "error",
          message: errData.error || `Unable to load test (Status ${res.status}).`,
        };
      }

      const status: TestJoinStatus = await res.json();

      if (!status.a_completed) {
        return { kind: "waiting_for_a", status };
      } else if (status.b_completed) {
        return { kind: "both_completed", status };
      } else if (status.b_exists && status.b_participant_id) {
        return { kind: "b_in_progress", status };
      } else {
        return { kind: "ready_to_join", status };
      }
    } catch (err) {
      console.error("Failed to load join status:", err);
      return {
        kind: "error",
        message: "Could not connect to the server. Please check your connection.",
      };
    }
  }, [testId]);

  /* ── Initial mount effect ──────────────────────────────────── */
  useEffect(() => {
    let ignore = false;

    queryStatus().then((result) => {
      if (!ignore) {
        setState(result);
      }
    });

    return () => {
      ignore = true;
    };
  }, [queryStatus]);

  /* ── Manual retry / refresh handler ────────────────────────── */
  const handleRefresh = async () => {
    setState({ kind: "loading" });
    setJoinError(null);
    const result = await queryStatus();
    setState(result);
  };

  /* ── Handle Joining as Participant B ───────────────────────── */
  async function handleJoinTest() {
    if (isJoining) return;
    setIsJoining(true);
    setJoinError(null);

    try {
      const res = await fetch(`/api/tests/${testId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setJoinError(errData.error || `Failed to join test (${res.status})`);
        setIsJoining(false);
        return;
      }

      const data = await res.json();

      // Store session data so play page can run without re-fetching
      if (typeof window !== "undefined") {
        sessionStorage.setItem(
          "awrf_session",
          JSON.stringify({
            testId: data.test_id,
            participantId: data.participant_id,
            role: data.role,
            totalScenarios: data.total_scenarios ?? 8,
          })
        );
      }

      router.push(`/play/${data.participant_id}`);
    } catch (err) {
      console.error("Error joining test:", err);
      setJoinError("A network error occurred. Please try again.");
      setIsJoining(false);
    }
  }

  /* ── Handle Resuming Participant B ─────────────────────────── */
  function handleResumeTest(participantId: string) {
    if (typeof window !== "undefined") {
      sessionStorage.setItem(
        "awrf_session",
        JSON.stringify({
          testId,
          participantId,
          role: "B",
          totalScenarios: 8,
        })
      );
    }
    router.push(`/play/${participantId}`);
  }

  /* ── View Results ─────────────────────────────────────────── */
  function handleViewResults() {
    router.push(`/results/${testId}`);
  }

  return (
    <div className="invite-page">
      <div className="invite-container">
        {/* Header */}
        <header className="invite-header animate-fade-up">
          <Link href="/" className="invite-logo">
            A.W.R.F.
          </Link>
          <span className="invite-label">VOL. 01 / INVITATION</span>
        </header>

        {/* ── State 1: Loading ── */}
        {state.kind === "loading" && (
          <div className="invite-content-center animate-fade-up animate-delay-1">
            <div className="invite-loading-spinner" />
            <p className="invite-loading-text">Verifying invitation...</p>
          </div>
        )}

        {/* ── State 2: Error / Not Found ── */}
        {state.kind === "error" && (
          <div className="invite-card animate-fade-up animate-delay-1">
            <span className="invite-card-tag">ERROR</span>
            <h1 className="invite-card-title">
              {state.notFound ? "Invitation Not Found" : "Something went wrong"}
            </h1>
            <p className="invite-card-description">{state.message}</p>
            <div className="invite-card-actions">
              <button
                type="button"
                className="invite-button-secondary"
                onClick={handleRefresh}
              >
                RETRY
              </button>
              <Link href="/" className="invite-button-primary">
                START A NEW TEST
                <span className="invite-cta-arrow">→</span>
              </Link>
            </div>
          </div>
        )}

        {/* ── State 3: Waiting for Participant A ── */}
        {state.kind === "waiting_for_a" && (
          <div className="invite-card animate-fade-up animate-delay-1">
            <span className="invite-card-tag">IN PROGRESS</span>
            <h1 className="invite-card-title">
              Your friend is still
              <br />
              <em>taking the test.</em>
            </h1>
            <p className="invite-card-description">
              They have created this test but have not finished answering their 8
              scenarios yet. As soon as they complete their choices, you will be able
              to accept the challenge.
            </p>

            <div className="invite-notice-box">
              <span className="invite-notice-dot" />
              <span>Waiting for Participant A to finish...</span>
            </div>

            <div className="invite-card-actions">
              <button
                type="button"
                className="invite-button-primary"
                onClick={handleRefresh}
              >
                CHECK AGAIN
                <span className="invite-cta-arrow">↻</span>
              </button>
              <Link href="/" className="invite-button-secondary">
                CREATE YOUR OWN TEST
              </Link>
            </div>
          </div>
        )}

        {/* ── State 4: Ready to Join (Invitation) ── */}
        {state.kind === "ready_to_join" && (
          <div className="invite-card animate-fade-up animate-delay-1">
            <div className="invite-watermark" aria-hidden="true">
              invited
            </div>
            <span className="invite-card-tag">FRIENDSHIP CHALLENGE</span>
            <h1 className="invite-card-title">
              You&apos;ve been
              <br />
              <em>invited.</em>
            </h1>
            <p className="invite-card-description">
              Your friend completed 8 situational dilemmas exploring trust, loyalty,
              and instincts. Answer the same scenarios independently to reveal your
              friendship matrix.
            </p>

            <div className="invite-features">
              <div className="invite-feature-item">
                <span className="invite-feature-num">01</span>
                <div>
                  <h3 className="invite-feature-title">8 SCENARIOS</h3>
                  <p className="invite-feature-desc">
                    Real situational dilemmas with no obvious right answers.
                  </p>
                </div>
              </div>

              <div className="invite-feature-item">
                <span className="invite-feature-num">02</span>
                <div>
                  <h3 className="invite-feature-title">BLIND ANSWERS</h3>
                  <p className="invite-feature-desc">
                    Neither of you will see each other&apos;s answers until both finish.
                  </p>
                </div>
              </div>

              <div className="invite-feature-item">
                <span className="invite-feature-num">03</span>
                <div>
                  <h3 className="invite-feature-title">THE MATRIX</h3>
                  <p className="invite-feature-desc">
                    Get an AI-narrated summary and full dimension-by-dimension alignment.
                  </p>
                </div>
              </div>
            </div>

            {joinError && (
              <div className="invite-error-banner">{joinError}</div>
            )}

            <div className="invite-card-actions">
              <button
                type="button"
                className={`invite-button-primary ${isJoining ? "invite-btn-loading" : ""}`}
                onClick={handleJoinTest}
                disabled={isJoining}
              >
                {isJoining ? (
                  <>
                    <span className="invite-spinner-sm" />
                    JOINING...
                  </>
                ) : (
                  <>
                    ACCEPT THE CHALLENGE
                    <span className="invite-cta-arrow">→</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ── State 5: B Already in Progress ── */}
        {state.kind === "b_in_progress" && (
          <div className="invite-card animate-fade-up animate-delay-1">
            <span className="invite-card-tag">IN PROGRESS</span>
            <h1 className="invite-card-title">
              Continue your
              <br />
              <em>test.</em>
            </h1>
            <p className="invite-card-description">
              You have already joined this test session. Finish your remaining
              scenarios to unlock your friendship comparison.
            </p>

            <div className="invite-card-actions">
              <button
                type="button"
                className="invite-button-primary"
                onClick={() =>
                  handleResumeTest(state.status.b_participant_id!)
                }
              >
                RESUME TEST
                <span className="invite-cta-arrow">→</span>
              </button>
            </div>
          </div>
        )}

        {/* ── State 6: Both Completed ── */}
        {state.kind === "both_completed" && (
          <div className="invite-card animate-fade-up animate-delay-1">
            <span className="invite-card-tag">COMPLETE</span>
            <h1 className="invite-card-title">
              The matrix is
              <br />
              <em>ready.</em>
            </h1>
            <p className="invite-card-description">
              Both of you have completed all 8 scenarios. Your friendship dynamics
              and scores have been calculated.
            </p>

            <div className="invite-card-actions">
              <button
                type="button"
                className="invite-button-primary"
                onClick={handleViewResults}
              >
                VIEW RESULTS
                <span className="invite-cta-arrow">→</span>
              </button>
              <Link href="/" className="invite-button-secondary">
                START A NEW TEST
              </Link>
            </div>
          </div>
        )}

        {/* Footer info */}
        <footer className="invite-footer animate-fade-up animate-delay-2">
          <p className="invite-footer-text">
            A social experiment in connection and perception.
          </p>
        </footer>
      </div>
    </div>
  );
}
