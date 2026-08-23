import { ImageResponse } from "next/og";
import { getTest, getParticipantsByTestId } from "@/lib/db";

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id: testId } = await context.params;

    const test = await getTest(testId);
    const participants = test ? await getParticipantsByTestId(testId) : [];
    const participantA = participants.find((p) => p.role === "A");
    const rawCreatorName = participantA?.display_name?.trim();
    const creatorName = rawCreatorName
      ? truncateText(rawCreatorName, 26)
      : null;

    const challengeLine = creatorName
      ? `${creatorName.toUpperCase()} CHALLENGED YOU`
      : "YOUR FRIEND CHALLENGED YOU";

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
                "radial-gradient(ellipse at center, rgba(167, 139, 186, 0.09) 0%, rgba(11, 12, 20, 0) 70%)",
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
              VOL. 01 / INVITATION
            </div>
          </div>

          {/* Center Main Content */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              justifyContent: "center",
              zIndex: 1,
              marginTop: 10,
              marginBottom: 10,
            }}
          >
            {/* Tag / Challenge Callout */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginBottom: 14,
              }}
            >
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  backgroundColor: "#c9a84c",
                }}
              />
              <div
                style={{
                  fontSize: 13,
                  fontFamily: "sans-serif",
                  fontWeight: 600,
                  letterSpacing: "0.18em",
                  color: "#c9a84c",
                }}
              >
                {challengeLine}
              </div>
            </div>

            {/* Headline */}
            <div
              style={{
                fontSize: 66,
                lineHeight: 1.08,
                fontStyle: "italic",
                color: "#f0ece4",
                marginBottom: 18,
                letterSpacing: "-0.02em",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <span>Are we</span>
              <span style={{ color: "#ffffff" }}>really friends?</span>
            </div>

            {/* Supporting Copy */}
            <div
              style={{
                fontSize: 21,
                fontFamily: "sans-serif",
                color: "#9b968f",
                letterSpacing: "0.03em",
                lineHeight: 1.4,
              }}
            >
              8 situational dilemmas. Blind choices. One friendship matrix.
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
              ACCEPT CHALLENGE • REVEAL YOUR ALIGNMENT
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
    console.error("Error generating invite OG image:", error);
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
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                fontSize: 14,
                fontFamily: "sans-serif",
                color: "#c9a84c",
                letterSpacing: "0.16em",
                marginBottom: 12,
              }}
            >
              FRIENDSHIP CHALLENGE
            </div>
            <div
              style={{
                fontSize: 64,
                fontStyle: "italic",
                color: "#f0ece4",
                marginBottom: 16,
              }}
            >
              Are we really friends?
            </div>
            <div
              style={{
                fontSize: 20,
                fontFamily: "sans-serif",
                color: "#9b968f",
              }}
            >
              8 situations. One friendship matrix.
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
