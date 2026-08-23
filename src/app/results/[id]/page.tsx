import type { Metadata } from "next";
import { getTest, getParticipantsByTestId, getComparison } from "@/lib/db";
import ResultsClient from "./ResultsClient";

type Props = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const test = await getTest(id);
  const participants = test ? await getParticipantsByTestId(id) : [];
  const participantA = participants.find((p) => p.role === "A");
  const participantB = participants.find((p) => p.role === "B");
  const comparison = test ? await getComparison(id) : null;

  const nameA = participantA?.display_name?.trim() || "Participant A";
  const nameB = participantB?.display_name?.trim() || "Participant B";

  if (comparison) {
    const title = `${nameA} × ${nameB} — ${comparison.bond_score}%`;
    const description = `See how ${nameA} and ${nameB} scored on the A.W.R.F. friendship matrix (${comparison.friendship_type}).`;

    return {
      title,
      description,
      openGraph: {
        title: `${title} | A.W.R.F.`,
        description,
        type: "website",
        url: `/results/${id}`,
        images: [
          {
            url: `/api/og/result/${id}`,
            width: 1200,
            height: 630,
            alt: `${title} | A.W.R.F.`,
          },
        ],
      },
      twitter: {
        card: "summary_large_image",
        title: `${title} | A.W.R.F.`,
        description,
        images: [`/api/og/result/${id}`],
      },
      alternates: {
        canonical: `/results/${id}`,
      },
    };
  }

  const title = "Friendship Matrix";
  const description =
    "Discover where your instincts align and where they differ on the A.W.R.F. friendship matrix.";

  return {
    title,
    description,
    openGraph: {
      title: `${title} | A.W.R.F.`,
      description,
      type: "website",
      url: `/results/${id}`,
      images: [
        {
          url: `/api/og/result/${id}`,
          width: 1200,
          height: 630,
          alt: `${title} | A.W.R.F.`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} | A.W.R.F.`,
      description,
      images: [`/api/og/result/${id}`],
    },
    alternates: {
      canonical: `/results/${id}`,
    },
  };
}

export default function ResultsPage({ params }: Props) {
  return <ResultsClient params={params} />;
}
