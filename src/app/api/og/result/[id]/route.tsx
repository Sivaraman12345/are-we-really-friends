import { ImageResponse } from "next/og";
import { getTest, getParticipantsByTestId, getComparison } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { isValidUuid, sanitizeDisplayName } from "@/lib/security";

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

export async function GET(request: Request, context: RouteContext) {
  // Rate limit
  const rateLimitResponse = await checkRateLimit(request, "og_result", {
    limit: 60,
    windowSeconds: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { id: testId } = await context.params;

    const test = isValidUuid(testId) ? await getTest(testId) : null;
    const participants = test ? await getParticipantsByTestId(testId) : [];
    const participantA = participants.find((p) => p.role === "A");
    const participantB = participants.find((p) => p.role === "B");
    const comparison = test ? await getComparison(testId) : null;

    const rawNameA =
      sanitizeDisplayName(participantA?.display_name) || "Participant A";
    const rawNameB =
      sanitizeDisplayName(participantB?.display_name) || "Participant B";
    const nameA = truncateText(rawNameA, 18);
    const nameB = truncateText(rawNameB, 18);

    const hasResult = !!comparison;
    const bondScore = comparison ? comparison.bond_score : null;
    const friendshipType = comparison
      ? comparison.friendship_type
      : "Friendship Matrix";

    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            backgroundColor: "#0b0c14",
            padding: "52px 64px",
            color: "#f0ece4",
            fontFamily: "serif",
            position: "relative",
            boxSizing: "border-box",
          }}
        >
          {/* Subtle Ambient Radial Background */}
          <div
            style={{
              position: "absolute",
              top: "-20%",
              left: "20%",
              width: "60%",
              height: "140%",
              backgroundImage:
                "radial-gradient(ellipse at center, rgba(201, 168, 76, 0.08) 0%, rgba(11, 12, 20, 0) 70%)",
            }}
          />

          {/* Border Frame */}
          <div
            style={{
              position: "absolute",
              top: 24,
              left: 24,
              right: 24,
              bottom: 24,
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: 6,
              pointerEvents: "none",
            }}
          />

          {/* Top Header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              width: "100%",
              zIndex: 1,
            }}
          >
            <div
              style={{
                fontSize: 26,
                fontStyle: "italic",
                letterSpacing: "0.08em",
                color: "#f0ece4",
              }}
            >
              A.W.R.F.
            </div>
            <div
              style={{
                fontSize: 12,
                fontFamily: "sans-serif",
                fontWeight: 600,
                letterSpacing: "0.18em",
                color: "#a78bba",
                textTransform: "uppercase",
              }}
            >
              VOL. 01 / RESULTS
            </div>
          </div>

          {/* Center Main Content */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              zIndex: 1,
              marginTop: 4,
              marginBottom: 4,
            }}
          >
            {/* Tag */}
            <div
              style={{
                fontSize: 12,
                fontFamily: "sans-serif",
                fontWeight: 600,
                letterSpacing: "0.22em",
                color: "#9b968f",
                textTransform: "uppercase",
                marginBottom: 8,
              }}
            >
              FRIENDSHIP MATRIX
            </div>

            {/* Names Headline */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 14,
                fontSize: 30,
                letterSpacing: "0.06em",
                color: "#f0ece4",
                textTransform: "uppercase",
                marginBottom: 8,
              }}
            >
              <span>{nameA}</span>
              <span style={{ color: "#c9a84c", fontWeight: 300 }}>×</span>
              <span>{nameB}</span>
            </div>

            {/* Big Score / Result Focus */}
            {hasResult && bondScore !== null ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "center",
                  lineHeight: 1,
                  margin: "4px 0",
                }}
              >
                <span
                  style={{
                    fontSize: 92,
                    fontStyle: "italic",
                    fontWeight: 400,
                    color: "#ffffff",
                    letterSpacing: "-0.03em",
                  }}
                >
                  {bondScore}
                </span>
                <span
                  style={{
                    fontSize: 42,
                    fontStyle: "italic",
                    color: "#a78bba",
                    marginLeft: 4,
                  }}
                >
                  %
                </span>
              </div>
            ) : (
              <div
                style={{
                  fontSize: 54,
                  fontStyle: "italic",
                  color: "#ffffff",
                  margin: "12px 0",
                }}
              >
                In Progress
              </div>
            )}

            {/* Archetype Title */}
            <div
              style={{
                fontSize: 22,
                fontFamily: "sans-serif",
                fontWeight: 600,
                letterSpacing: "0.14em",
                color: "#c9a84c",
                textTransform: "uppercase",
                marginTop: 4,
                marginBottom: 10,
              }}
            >
              {friendshipType}
            </div>

            {/* Supporting Subtext */}
            <div
              style={{
                fontSize: 16,
                fontFamily: "sans-serif",
                color: "#9b968f",
                letterSpacing: "0.03em",
              }}
            >
              8 situational dilemmas compared • Alignment synthesized
            </div>
          </div>

          {/* Bottom Footer */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              width: "100%",
              zIndex: 1,
              paddingTop: 16,
              borderTop: "1px solid rgba(255, 255, 255, 0.06)",
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontFamily: "sans-serif",
                letterSpacing: "0.14em",
                color: "#6b687c",
                textTransform: "uppercase",
              }}
            >
              SEE COMPLETE MATRIX & DYNAMIC ANALYSIS
            </div>
            <div
              style={{
                fontSize: 12,
                fontFamily: "sans-serif",
                letterSpacing: "0.14em",
                color: "#6b687c",
                textTransform: "uppercase",
              }}
            >
              A.W.R.F. EXPERIMENT
            </div>
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
        headers: {
          "Cache-Control":
            "public, max-age=3600, stale-while-revalidate=86400",
        },
      }
    );
  } catch (error) {
    console.error("Error generating result OG image:", error);
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            backgroundColor: "#0b0c14",
            padding: "52px 64px",
            color: "#f0ece4",
            fontFamily: "serif",
          }}
        >
          <div style={{ fontSize: 26, fontStyle: "italic" }}>A.W.R.F.</div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: 14,
                fontFamily: "sans-serif",
                color: "#c9a84c",
                letterSpacing: "0.16em",
                marginBottom: 12,
              }}
            >
              FRIENDSHIP MATRIX
            </div>
            <div
              style={{
                fontSize: 56,
                fontStyle: "italic",
                color: "#f0ece4",
                marginBottom: 16,
              }}
            >
              Are We Really Friends?
            </div>
            <div
              style={{
                fontSize: 20,
                fontFamily: "sans-serif",
                color: "#9b968f",
              }}
            >
              Discover your friendship alignment score.
            </div>
          </div>
          <div
            style={{
              fontSize: 12,
              fontFamily: "sans-serif",
              color: "#6b687c",
              letterSpacing: "0.14em",
            }}
          >
            A.W.R.F. EXPERIMENT
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
      }
    );
  }
}
