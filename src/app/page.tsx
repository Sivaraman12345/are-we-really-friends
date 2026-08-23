"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";

/* ── Static Data ────────────────────────────────────────────── */
const RELATIONSHIP_OPTIONS = [
  {
    value: "best_friend" as const,
    title: "Best Friend",
    description: "You share everything. Or so you think.",
    category: "WARM / FAMILIAR / PLAYFUL",
    image: "/card-best-friend.jpg",
  },
  {
    value: "close_friend" as const,
    title: "Close Friend",
    description: "Trusted, but how deeply?",
    category: "CALM / TRUSTWORTHY / INTIMATE",
    image: "/card-close-friend.jpg",
  },
  {
    value: "new_friend" as const,
    title: "New Friend",
    description: "Still figuring each other out.",
    category: "CURIOUS / FRESH / EXPLORATORY",
    image: "/card-new-friend.jpg",
  },
  {
    value: "crush" as const,
    title: "Crush / Special",
    description: "Something unspoken between you.",
    category: "SLIGHTLY MYSTERIOUS / ROMANTIC",
    image: "/card-crush.jpg",
  },
] as const;

type RelType = (typeof RELATIONSHIP_OPTIONS)[number]["value"];

/* ── Inner Page Component ───────────────────────────────────── */
function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const parentTestId =
    searchParams.get("parent_test_id") ||
    searchParams.get("from_test_id") ||
    null;
  const createdByParticipantId =
    searchParams.get("created_by_participant_id") ||
    searchParams.get("from_participant_id") ||
    null;

  const [selected, setSelected] = useState<RelType>("best_friend");
  const [displayName, setDisplayName] = useState<string>(() => {
    if (typeof window !== "undefined") {
      try {
        const raw = sessionStorage.getItem("awrf_session");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.displayName && typeof parsed.displayName === "string") {
            return parsed.displayName;
          }
        }
      } catch {}
    }
    return "";
  });
  const [nameError, setNameError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleBeginTest() {
    const trimmed = displayName.trim();
    if (!trimmed) {
      setNameError("Please enter your name to begin.");
      return;
    }

    if (isLoading) return;
    setIsLoading(true);
    setNameError(null);

    try {
      const res = await fetch("/api/tests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          relationship_type: selected,
          display_name: trimmed,
          parent_test_id: parentTestId,
          created_by_participant_id: createdByParticipantId,
        }),
      });

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }

      const data = await res.json();

      // Store session data for the play page
      if (typeof window !== "undefined") {
        sessionStorage.setItem(
          "awrf_session",
          JSON.stringify({
            testId: data.test_id,
            participantId: data.participant_id,
            role: data.role,
            displayName: data.display_name,
            totalScenarios: data.total_scenarios,
          })
        );
      }

      router.push(`/play/${data.participant_id}`);
    } catch (error) {
      console.error("Failed to create test:", error);
      setIsLoading(false);
    }
  }

  return (
    <div style={{ background: "var(--bg-primary)", minHeight: "100vh" }}>
      <div className="page-container">
        {/* ── Header ──────────────────────────────────────── */}
        <header className="site-header animate-fade-up">
          <span className="site-logo">A.W.R.F.</span>
          <span className="site-label">VOL. 01 / EXPERIENCE</span>
        </header>

        {/* ── Hero ────────────────────────────────────────── */}
        <section className="hero-section animate-fade-up animate-delay-1">
          <div style={{ position: "relative", zIndex: 1 }}>
            <span className="hero-watermark" aria-hidden="true">
              friend
            </span>
            <h1 className="hero-title">
              Are we
              <br />
              <em>really</em> friends?
            </h1>
          </div>

          <div className="hero-aside">
            <div className="hero-accent-line" />
            <p className="hero-subtext">
              You think you know your friend.
              <br />
              Let&apos;s find out.
            </p>
          </div>
        </section>

        <hr className="section-divider" />

        {/* ── Viral Chain Context Banner ──────────────────── */}
        {parentTestId && (
          <div className="viral-chain-badge animate-fade-up">
            <span className="viral-chain-dot" />
            <span>CHALLENGE ANOTHER FRIEND • NEW EXPERIMENT</span>
          </div>
        )}

        {/* ── Relationship Selection ──────────────────────── */}
        <div className="section-header animate-fade-up animate-delay-2">
          <span className="section-title">SELECT RELATIONSHIP</span>
          <span className="section-meta">4 Options</span>
        </div>

        <div className="cards-grid">
          {RELATIONSHIP_OPTIONS.map((option, i) => (
            <button
              key={option.value}
              type="button"
              className={`relationship-card animate-fade-up animate-delay-${i + 3} ${
                selected === option.value ? "selected" : ""
              }`}
              onClick={() => setSelected(option.value)}
              aria-pressed={selected === option.value}
              aria-label={`Select ${option.title}`}
            >
              <div className="card-image-container">
                <Image
                  src={option.image}
                  alt={option.title}
                  fill
                  sizes="(max-width: 768px) 50vw, 25vw"
                  style={{ objectFit: "cover" }}
                />
                <span className="card-category">{option.category}</span>
                <span className="card-indicator" />
              </div>
              <div className="card-body">
                <h3 className="card-title">{option.title}</h3>
                <p className="card-description">{option.description}</p>
              </div>
            </button>
          ))}
        </div>

        {/* ── Participant A Name Input ────────────────────── */}
        <div className="name-input-section animate-fade-up animate-delay-6">
          <div className="name-input-wrap">
            <label htmlFor="participant-name" className="name-input-label">
              WHAT SHOULD WE CALL YOU?
            </label>
            <input
              id="participant-name"
              type="text"
              className={`name-input-field ${nameError ? "has-error" : ""}`}
              placeholder="Your name or nickname"
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
                if (nameError) setNameError(null);
              }}
              maxLength={50}
              autoComplete="name"
            />
            {nameError ? (
              <span className="name-input-error">{nameError}</span>
            ) : (
              <span className="name-input-hint">
                This display name will appear on your final friendship matrix.
              </span>
            )}
          </div>
        </div>

        {/* ── CTA ─────────────────────────────────────────── */}
        <div className="cta-container animate-fade-up animate-delay-7">
          <button
            type="button"
            className={`cta-button ${isLoading ? "loading" : ""}`}
            onClick={handleBeginTest}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <span className="loading-spinner" />
                CREATING...
              </>
            ) : (
              <>
                BEGIN THE TEST
                <span className="cta-arrow">→</span>
              </>
            )}
          </button>
        </div>

        <hr className="section-divider" />

        {/* ── How It Works ────────────────────────────────── */}
        <section className="how-section">
          <div className="how-header">
            <h2 className="how-title">How the experiment works</h2>
            <span className="how-label">THE PROCESS</span>
          </div>

          <hr className="section-divider" />

          <div className="how-grid">
            <div className="how-step">
              <span className="step-number">01</span>
              <h3 className="step-heading">MAKE YOUR CHOICES</h3>
              <p className="step-description">
                Independently answer 8 situational dilemmas spanning trust,
                loyalty, and communication.
              </p>
            </div>

            <div className="how-step">
              <span className="step-number">02</span>
              <h3 className="step-heading">SEND THE LINK</h3>
              <p className="step-description">
                Share the experience. They won&apos;t see your answers until they
                complete theirs.
              </p>
            </div>

            <div className="how-step">
              <span className="step-number">03</span>
              <h3 className="step-heading">REVEAL YOUR MATRIX</h3>
              <p className="step-description">
                Discover where your minds align and where they differ through a
                unique visual pattern.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div style={{ background: "var(--bg-primary)", minHeight: "100vh" }} />}>
      <HomeContent />
    </Suspense>
  );
}
